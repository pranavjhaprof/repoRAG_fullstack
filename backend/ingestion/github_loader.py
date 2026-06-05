"""
ingestion/github_loader.py
--------------------------
Fetches all code files from a public or private GitHub repository.
Returns a list of document dicts ready for chunking.
"""

import os
import json
from github import Github
from dotenv import load_dotenv

load_dotenv()

# File extensions we want to index
ALLOWED_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx",
    ".java", ".go", ".rs", ".cpp", ".c",
    ".md", ".txt", ".json", ".yaml", ".yml",
    ".html", ".css", ".sh", ".env.example",
    ".ipynb",   # ← Jupyter notebooks
    ".csv",     # ← small CSVs (description/sample)
    ".r", ".R", # ← R scripts
}

# Skip these folders entirely
SKIP_DIRS = {
    "node_modules", ".git", "__pycache__",
    "dist", "build", ".next", "venv", ".venv",
    ".ipynb_checkpoints",   # ← skip notebook checkpoints
}

# Skip files larger than this (bytes) to avoid token explosion
MAX_FILE_SIZE = 500_000  # 500 KB


def fetch_repo_files(repo_url: str) -> list[dict]:
    """
    Given a GitHub URL like 'https://github.com/owner/repo',
    returns a list of:
        {
            "content": str,
            "metadata": {
                "file_path": str,
                "language": str,
                "repo_name": str,
                "source": str
            }
        }
    """
    github_token = os.getenv("GITHUB_TOKEN")
    g = Github(github_token)

    repo_path = repo_url.rstrip("/").replace("https://github.com/", "")
    repo = g.get_repo(repo_path)

    documents = []
    _fetch_contents(repo, "", documents, repo_path)

    print(f"[loader] Fetched {len(documents)} files from {repo_path}")
    return documents


def _fetch_contents(repo, path: str, documents: list, repo_name: str):
    """Recursively walk repo contents."""
    contents = repo.get_contents(path)

    for item in contents:
        if item.type == "dir":
            if item.name not in SKIP_DIRS:
                _fetch_contents(repo, item.path, documents, repo_name)
            continue

        ext = _get_extension(item.name)
        if ext not in ALLOWED_EXTENSIONS:
            continue

        # Skip very large files
        if item.size > MAX_FILE_SIZE:
            print(f"[loader] Skipping large file: {item.path} ({item.size} bytes)")
            continue

        try:
            raw = item.decoded_content.decode("utf-8", errors="ignore")
        except Exception:
            continue

        if not raw.strip():
            continue

        # ── Special handling for Jupyter notebooks ──
        if ext == ".ipynb":
            content = _extract_notebook_text(raw, item.path)
        else:
            content = raw

        if not content.strip():
            continue

        documents.append({
            "content": content,
            "metadata": {
                "file_path": item.path,
                "language": _ext_to_language(ext),
                "repo_name": repo_name,
                "source": item.html_url,
            }
        })


def _extract_notebook_text(raw_json: str, file_path: str) -> str:
    """
    Extracts readable text from a Jupyter notebook.
    Concatenates all markdown and code cells into a single string
    so the RAG pipeline can understand what the notebook does.
    """
    try:
        nb = json.loads(raw_json)
        cells = nb.get("cells", [])
        parts = [f"# Jupyter Notebook: {file_path}\n"]

        for i, cell in enumerate(cells):
            cell_type = cell.get("cell_type", "")
            source = cell.get("source", [])

            # source can be a list of lines or a single string
            if isinstance(source, list):
                text = "".join(source)
            else:
                text = source

            if not text.strip():
                continue

            if cell_type == "markdown":
                parts.append(f"\n## [Markdown Cell {i+1}]\n{text}")
            elif cell_type == "code":
                parts.append(f"\n## [Code Cell {i+1}]\n```python\n{text}\n```")

                # Also include text outputs (printed results, model scores etc.)
                outputs = cell.get("outputs", [])
                output_texts = []
                for out in outputs:
                    if out.get("output_type") in ("stream", "execute_result", "display_data"):
                        out_text = out.get("text", out.get("data", {}).get("text/plain", ""))
                        if isinstance(out_text, list):
                            out_text = "".join(out_text)
                        if out_text.strip():
                            output_texts.append(out_text.strip())

                if output_texts:
                    parts.append(f"\n### Output:\n{''.join(output_texts)}")

        return "\n".join(parts)

    except Exception as e:
        print(f"[loader] Failed to parse notebook {file_path}: {e}")
        return ""


def _get_extension(filename: str) -> str:
    _, ext = os.path.splitext(filename)
    return ext.lower()


def _ext_to_language(ext: str) -> str:
    mapping = {
        ".py":    "python",
        ".ipynb": "python",   # notebooks are python
        ".js":    "javascript",
        ".ts":    "typescript",
        ".tsx":   "typescript",
        ".jsx":   "javascript",
        ".java":  "java",
        ".go":    "go",
        ".rs":    "rust",
        ".cpp":   "cpp",
        ".c":     "c",
        ".md":    "markdown",
        ".json":  "json",
        ".yaml":  "yaml",
        ".yml":   "yaml",
        ".html":  "html",
        ".css":   "css",
        ".sh":    "bash",
        ".csv":   "text",
        ".r":     "r",
        ".R":     "r",
    }
    return mapping.get(ext, "text")


if __name__ == "__main__":
    docs = fetch_repo_files("https://github.com/pranavjhaprof/Red-wine")
    print(f"Total files: {len(docs)}")
    for d in docs:
        print(f"  {d['metadata']['file_path']} ({len(d['content'])} chars)")


def build_file_tree(raw_docs: list[dict]) -> dict:
    """
    Build a nested tree structure from a flat list of file docs.
    Returns a dict tree like:
      { name, type, path, children[] }
    """
    root = {"name": "root", "type": "dir", "path": "", "children": []}

    for doc in raw_docs:
        file_path = doc["metadata"].get("file_path", "")
        language  = doc["metadata"].get("language", "text")
        parts     = file_path.split("/")
        node      = root

        for i, part in enumerate(parts):
            is_last = (i == len(parts) - 1)
            if is_last:
                node["children"].append({
                    "name":     part,
                    "type":     "file",
                    "path":     file_path,
                    "language": language,
                })
            else:
                existing = next((c for c in node["children"] if c["name"] == part and c["type"] == "dir"), None)
                if existing:
                    node = existing
                else:
                    new_dir = {"name": part, "type": "dir", "path": "/".join(parts[:i+1]), "children": []}
                    node["children"].append(new_dir)
                    node = new_dir

    # Sort: dirs first, then files, alphabetically
    def sort_node(n):
        if n["type"] == "dir":
            n["children"] = sorted(n["children"], key=lambda x: (0 if x["type"]=="dir" else 1, x["name"].lower()))
            for child in n["children"]:
                if child["type"] == "dir":
                    sort_node(child)
    sort_node(root)
    return root


def fetch_single_file(repo_name: str, file_path: str) -> str:
    """Fetch the raw content of a single file from a GitHub repo."""
    github_token = os.getenv("GITHUB_TOKEN")
    g = Github(github_token)
    repo = g.get_repo(repo_name)
    try:
        file_content = repo.get_contents(file_path)
        if isinstance(file_content, list):
            raise ValueError(f"{file_path} is a directory")
        raw = file_content.decoded_content.decode("utf-8", errors="replace")
        return raw
    except Exception as e:
        raise ValueError(f"Could not fetch {file_path}: {e}")