"""
api/main.py — with file tree + file content + source line endpoints
New endpoints:
  GET  /repo/{repo_name}/tree         — file tree structure
  GET  /repo/{repo_name}/file         — raw file content (?path=...)
"""

import asyncio
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, RedirectResponse
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware
from authlib.integrations.starlette_client import OAuth
from dotenv import load_dotenv

from ingestion.github_loader import fetch_repo_files, fetch_single_file, build_file_tree
from ingestion.chunker import chunk_documents
from rag.vector_store import ingest_chunks, load_vectorstore, list_ingested_repos
from rag.query_engine import ask, ask_stream, _invalidate_cache

load_dotenv()

app = FastAPI(title="GitHub RAG Assistant", version="1.0.0")

app.add_middleware(SessionMiddleware,
    secret_key=os.getenv("SECRET_KEY", "fallback-secret-change-me"))

app.add_middleware(CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── OAuth ────────────────────────────────────────────────────────
oauth = OAuth()
oauth.register(
    name="google",
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)

# ── Chat history storage ─────────────────────────────────────────
CHAT_DATA_DIR = Path(__file__).parent.parent / "chat_data"
CHAT_DATA_DIR.mkdir(exist_ok=True)

# ── Repo tree cache (memory) ─────────────────────────────────────
_tree_cache: dict[str, dict] = {}

def _user_history_path(user_id: str) -> Path:
    safe_id = "".join(c for c in user_id if c.isalnum() or c in "-_")
    return CHAT_DATA_DIR / f"{safe_id}.json"

def _read_history(user_id: str) -> list:
    path = _user_history_path(user_id)
    if not path.exists(): return []
    try: return json.loads(path.read_text())
    except: return []

def _write_history(user_id: str, sessions: list):
    _user_history_path(user_id).write_text(
        json.dumps(sessions, ensure_ascii=False, indent=2))

def get_current_user(request: Request):
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return user

# ── Models ───────────────────────────────────────────────────────
class IngestRequest(BaseModel):
    repo_url: str

class IngestResponse(BaseModel):
    repo_name: str
    files_indexed: int
    chunks_created: int
    message: str
    file_tree: dict   # ← NEW: tree structure returned on ingest

class AskRequest(BaseModel):
    repo_name: str
    question: str

class AskResponse(BaseModel):
    answer: str
    sources: list[dict]

class ChatSession(BaseModel):
    id: str
    title: str
    repoName: str | None = None
    messages: list[dict] = []
    createdAt: str
    updatedAt: str

# ── Auth endpoints ───────────────────────────────────────────────
@app.get("/health")
def health(): return {"status": "ok"}

@app.get("/auth/login")
async def login(request: Request):
    redirect_uri = os.getenv("OAUTH_REDIRECT_URI", "http://localhost:8000/auth/callback")
    return await oauth.google.authorize_redirect(request, redirect_uri)

@app.get("/auth/callback")
async def auth_callback(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
        request.session["user"] = dict(token.get("userinfo"))
        return RedirectResponse(url=os.getenv("FRONTEND_URL", "http://localhost:5173"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OAuth callback failed: {str(e)}")

@app.get("/auth/user")
def get_user(request: Request):
    user = request.session.get("user")
    if not user: return {"logged_in": False}
    return {"logged_in": True, "name": user.get("name"),
            "email": user.get("email"), "picture": user.get("picture"), "sub": user.get("sub")}

@app.get("/auth/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url=os.getenv("FRONTEND_URL", "http://localhost:5173"))

# ── History endpoints ────────────────────────────────────────────
@app.get("/history")
def get_history(user=Depends(get_current_user)):
    return {"sessions": _read_history(user["sub"])}

@app.post("/history")
def save_session(session: ChatSession, user=Depends(get_current_user)):
    sessions = _read_history(user["sub"])
    idx = next((i for i, s in enumerate(sessions) if s["id"] == session.id), None)
    sd  = session.model_dump()
    if idx is not None: sessions[idx] = sd
    else: sessions.insert(0, sd)
    _write_history(user["sub"], sessions)
    return {"saved": True}

@app.delete("/history/{session_id}")
def delete_session(session_id: str, user=Depends(get_current_user)):
    sessions = [s for s in _read_history(user["sub"]) if s["id"] != session_id]
    _write_history(user["sub"], sessions)
    return {"deleted": True}

@app.delete("/history")
def delete_all_history(user=Depends(get_current_user)):
    _write_history(user["sub"], [])
    return {"deleted": True}

# ── Repo endpoints ───────────────────────────────────────────────
@app.get("/repos")
def get_repos(user=Depends(get_current_user)):
    return {"repos": list_ingested_repos()}

@app.post("/ingest", response_model=IngestResponse)
def ingest_repo(req: IngestRequest, user=Depends(get_current_user)):
    try:
        raw_docs = fetch_repo_files(req.repo_url)
        if not raw_docs:
            raise HTTPException(status_code=400, detail="No indexable files found.")
        chunks   = chunk_documents(raw_docs)
        repo_name = req.repo_url.rstrip("/").replace("https://github.com/", "")
        ingest_chunks(repo_name, chunks)
        _invalidate_cache(repo_name)

        # Build + cache file tree
        tree = build_file_tree(raw_docs)
        _tree_cache[repo_name] = tree

        return IngestResponse(
            repo_name=repo_name,
            files_indexed=len(raw_docs),
            chunks_created=len(chunks),
            message=f"Indexed {len(raw_docs)} files ({len(chunks)} chunks).",
            file_tree=tree,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── File Tree endpoint ───────────────────────────────────────────
@app.get("/repo/{repo_name:path}/tree")
def get_tree(repo_name: str, user=Depends(get_current_user)):
    """Return cached file tree. Rebuilds from GitHub if not cached."""
    if repo_name in _tree_cache:
        return {"tree": _tree_cache[repo_name]}
    # Not cached — rebuild (happens after server restart)
    try:
        repo_url = f"https://github.com/{repo_name}"
        raw_docs = fetch_repo_files(repo_url)
        tree = build_file_tree(raw_docs)
        _tree_cache[repo_name] = tree
        return {"tree": tree}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── File Content endpoint ────────────────────────────────────────
@app.get("/repo/{repo_name:path}/file")
def get_file(repo_name: str, path: str = Query(...), user=Depends(get_current_user)):
    """Return raw content of a single file from GitHub."""
    try:
        content = fetch_single_file(repo_name, path)
        return {"path": path, "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── RAG endpoints ────────────────────────────────────────────────
@app.post("/ask", response_model=AskResponse)
def ask_question(req: AskRequest, user=Depends(get_current_user)):
    try:
        vs = load_vectorstore(req.repo_name)
        result = ask(vs, req.question, repo_name=req.repo_name)
        return AskResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ask/stream")
async def ask_question_stream(req: AskRequest, user=Depends(get_current_user)):
    try:
        vs = load_vectorstore(req.repo_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    async def event_generator():
        try:
            async for token in ask_stream(vs, req.question, repo_name=req.repo_name):
                yield f"data: {json.dumps({'token': token})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.main:app", host="0.0.0.0", port=8000, reload=True)