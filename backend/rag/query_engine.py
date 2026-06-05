"""
rag/query_engine.py
-------------------
Optimized for token efficiency and scalability:
  1. Query result cache    — identical questions skip Groq entirely
  2. Chunk trimming        — strips chunks to only their most relevant lines
  3. Tighter prompt        — no fluff, minimal system overhead tokens
  4. Adaptive k            — short questions get fewer chunks, complex get more
  5. Re-ingestion guard    — hash-based skip in vector_store (see vector_store.py)
"""

import os
import hashlib
import json
import time
from functools import lru_cache
from langchain_groq import ChatGroq
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate
from langchain_community.vectorstores import Chroma
from dotenv import load_dotenv

load_dotenv()

# ── In-memory query cache ─────────────────────────────────────────
# key: hash(repo_name + question), value: {answer, sources, ts}
_query_cache: dict[str, dict] = {}
CACHE_TTL_SECONDS = 3600  # 1 hour


def _cache_key(repo_name: str, question: str) -> str:
    return hashlib.md5(f"{repo_name}::{question.strip().lower()}".encode()).hexdigest()


def _get_cached(repo_name: str, question: str) -> dict | None:
    key = _cache_key(repo_name, question)
    entry = _query_cache.get(key)
    if entry and (time.time() - entry["ts"]) < CACHE_TTL_SECONDS:
        print(f"[cache] HIT for: {question[:60]}")
        return entry["data"]
    return None


def _set_cached(repo_name: str, question: str, data: dict):
    key = _cache_key(repo_name, question)
    _query_cache[key] = {"data": data, "ts": time.time()}


def _invalidate_cache(repo_name: str):
    """Call this when a repo is re-ingested."""
    to_delete = [k for k, v in _query_cache.items()
                 if repo_name in v.get("data", {}).get("repo_name", "")]
    for k in to_delete:
        del _query_cache[k]
    print(f"[cache] Invalidated {len(to_delete)} entries for {repo_name}")


# ── Adaptive chunk count ──────────────────────────────────────────

def _adaptive_k(question: str) -> dict:
    """
    Short factual questions need fewer chunks.
    Complex multi-part questions need more.
    """
    word_count = len(question.split())
    has_multiple = any(q in question.lower() for q in ["and", "also", "compare", "difference", "how does", "explain all"])

    if word_count <= 8 and not has_multiple:
        return {"k": 4, "fetch_k": 12}   # simple question
    elif word_count <= 15:
        return {"k": 6, "fetch_k": 16}   # medium question
    else:
        return {"k": 8, "fetch_k": 24}   # complex / multi-part


# ── Chunk trimmer ─────────────────────────────────────────────────

def _trim_chunk(text: str, max_chars: int = 600) -> str:
    """
    Trim a chunk to its most content-dense lines.
    Removes leading/trailing blank lines and caps at max_chars.
    """
    lines = [l for l in text.splitlines() if l.strip()]
    trimmed = "\n".join(lines)
    if len(trimmed) > max_chars:
        trimmed = trimmed[:max_chars] + "…"
    return trimmed


# ── Prompt — tight and token-efficient ───────────────────────────

SYSTEM_PROMPT = PromptTemplate(
    input_variables=["context", "question"],
    template="""You are a senior software engineer and data scientist explaining a codebase to a colleague.
Answer in clear, natural language as if having a conversation — no bullet points of file paths, no bracket citations.
Use the context to give a confident, well-explained answer.
Only mention a specific file name if it is genuinely essential to the answer (e.g. "the entry point is app.py").
Include exact values (accuracy scores, model names, parameters) when present in the context.
If the context does not contain the answer, briefly say so and describe what the context does cover.

CONTEXT:
{context}

QUESTION: {question}
ANSWER:"""
)


# ── QA chain builder ─────────────────────────────────────────────

def _build_retriever(vectorstore: Chroma, question: str):
    k_config = _adaptive_k(question)
    return vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={
            "k":           k_config["k"],
            "fetch_k":     k_config["fetch_k"],
            "lambda_mult": 0.65,
        }
    )


def _build_llm(streaming=False, callbacks=None):
    return ChatGroq(
        model="llama-3.3-70b-versatile",
        temperature=0,
        streaming=streaming,
        callbacks=callbacks or [],
        groq_api_key=os.getenv("GROQ_API_KEY"),
        max_tokens=1024,   # cap output tokens — answers rarely need more
    )


# ── ask (non-streaming) ───────────────────────────────────────────

def ask(vectorstore: Chroma, question: str, repo_name: str = "") -> dict:
    # Check cache first
    cached = _get_cached(repo_name, question)
    if cached:
        return cached

    retriever = _build_retriever(vectorstore, question)
    llm       = _build_llm()

    chain = RetrievalQA.from_chain_type(
        llm=llm,
        chain_type="stuff",
        retriever=retriever,
        return_source_documents=True,
        chain_type_kwargs={"prompt": SYSTEM_PROMPT}
    )

    # Trim chunks before sending to reduce tokens
    docs = retriever.invoke(question)
    trimmed_context = "\n\n---\n\n".join(
        f"[{d.metadata.get('file_path','?')}]\n{_trim_chunk(d.page_content)}"
        for d in docs
    )

    # Manually invoke with trimmed context
    result = llm.invoke(
        SYSTEM_PROMPT.format(context=trimmed_context, question=question)
    )
    answer_text = result.content if hasattr(result, "content") else str(result)

    seen = set()
    sources = []
    for doc in docs:
        path = doc.metadata.get("file_path", "unknown")
        if path not in seen:
            seen.add(path)
            sources.append({
                "file_path":  path,
                "source_url": doc.metadata.get("source", ""),
                "language":   doc.metadata.get("language", ""),
                "preview":    doc.page_content[:120].strip()
            })

    data = {"answer": answer_text, "sources": sources, "repo_name": repo_name}
    _set_cached(repo_name, question, data)
    return data


# ── ask_stream (streaming) ────────────────────────────────────────

async def ask_stream(vectorstore: Chroma, question: str, repo_name: str = ""):
    """Streaming via async generator for SSE endpoint."""
    from langchain.callbacks import AsyncIteratorCallbackHandler
    import asyncio

    # Retrieve and trim chunks upfront
    retriever = _build_retriever(vectorstore, question)
    docs = retriever.invoke(question)
    trimmed_context = "\n\n---\n\n".join(
        f"[{d.metadata.get('file_path','?')}]\n{_trim_chunk(d.page_content)}"
        for d in docs
    )
    prompt_text = SYSTEM_PROMPT.format(context=trimmed_context, question=question)

    callback = AsyncIteratorCallbackHandler()
    llm = _build_llm(streaming=True, callbacks=[callback])

    task = asyncio.create_task(llm.ainvoke(prompt_text))

    async for token in callback.aiter():
        yield token

    await task


if __name__ == "__main__":
    from rag.vector_store import load_vectorstore
    vs = load_vectorstore("pranavjhaprof/Red-wine")
    result = ask(vs, "What machine learning model is used?", "pranavjhaprof/Red-wine")
    print("\nAnswer:", result["answer"])
    print("\nSources:", [s["file_path"] for s in result["sources"]])