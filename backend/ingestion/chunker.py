"""
ingestion/chunker.py
--------------------
Optimized chunker with:
  1. Content cleaning   — strips blank lines, comments, boilerplate
  2. Deduplication      — MD5 hash per chunk, skips exact duplicates
  3. Token-aware sizing — estimates tokens (chars/4)
  4. Smart overlap      — reduced overlap for short files
  5. LINE NUMBERS       — each chunk stores start_line + end_line for code viewer
"""

import re
import hashlib
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

PYTHON_SEPARATORS   = ["\nclass ", "\ndef ", "\n\n", "\n", " ", ""]
JS_SEPARATORS       = ["\nfunction ", "\nconst ", "\nclass ", "\n\n", "\n", " ", ""]
GENERIC_SEPARATORS  = ["\n\n", "\n", " ", ""]
NOTEBOOK_SEPARATORS = ["\n## [Code Cell", "\n## [Markdown Cell", "\n### Output:", "\n\n", "\n", " ", ""]

LANGUAGE_SEPARATORS = {
    "python":     PYTHON_SEPARATORS,
    "javascript": JS_SEPARATORS,
    "typescript": JS_SEPARATORS,
    "java":       ["\npublic ", "\nprivate ", "\nclass ", "\n\n", "\n", " ", ""],
    "go":         ["\nfunc ", "\n\n", "\n", " ", ""],
}

CHARS_PER_TOKEN = 4
TARGET_TOKENS   = 256
OVERLAP_TOKENS  = 40
NOTEBOOK_TOKENS = 350


def _estimate_tokens(text: str) -> int:
    return len(text) // CHARS_PER_TOKEN

def _chunk_hash(text: str) -> str:
    return hashlib.md5(text.strip().encode()).hexdigest()

def _clean_python(text: str) -> str:
    lines = text.splitlines()
    cleaned = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#") and not any(c in stripped for c in ["TODO", "FIXME", "NOTE", "type:", "noqa"]):
            continue
        cleaned.append(line)
    text = "\n".join(cleaned)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def _clean_generic(text: str) -> str:
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return text.strip()

def _clean_content(content: str, language: str) -> str:
    if language == "python":
        return _clean_python(content)
    return _clean_generic(content)


def _find_line_range(original_content: str, chunk_text: str) -> tuple[int, int]:
    """
    Find the start and end line numbers of a chunk within the original file content.
    Returns (start_line, end_line) as 1-indexed line numbers.
    """
    # Normalise both for searching (strip leading whitespace differences)
    chunk_stripped = chunk_text.strip()
    if not chunk_stripped:
        return (1, 1)

    # Search for the chunk text within original content
    idx = original_content.find(chunk_stripped[:min(120, len(chunk_stripped))])
    if idx == -1:
        # Fallback: search first 60 chars
        idx = original_content.find(chunk_stripped[:60].strip())
    if idx == -1:
        return (1, 1)

    start_line = original_content[:idx].count("\n") + 1
    end_line   = start_line + chunk_text.count("\n")
    return (start_line, end_line)


def chunk_documents(raw_docs: list[dict]) -> list[Document]:
    """
    Takes output of github_loader.fetch_repo_files().
    Returns deduplicated, cleaned LangChain Document chunks with line numbers.
    """
    all_chunks: list[Document] = []
    seen_hashes: set[str] = set()
    skipped_duplicates = 0

    for doc in raw_docs:
        language    = doc["metadata"].get("language", "text")
        file_path   = doc["metadata"].get("file_path", "")
        is_notebook = file_path.endswith(".ipynb")
        original_content = doc["content"]   # keep original for line tracking

        content = _clean_content(original_content, language)
        if not content.strip():
            continue

        if is_notebook:
            separators    = NOTEBOOK_SEPARATORS
            chunk_size    = NOTEBOOK_TOKENS * CHARS_PER_TOKEN
            chunk_overlap = OVERLAP_TOKENS  * CHARS_PER_TOKEN
        else:
            separators    = LANGUAGE_SEPARATORS.get(language, GENERIC_SEPARATORS)
            chunk_size    = TARGET_TOKENS * CHARS_PER_TOKEN
            chunk_overlap = 0 if len(content) < chunk_size * 2 else OVERLAP_TOKENS * CHARS_PER_TOKEN

        splitter = RecursiveCharacterTextSplitter(
            separators=separators,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len,
        )

        chunks = splitter.create_documents(
            texts=[content],
            metadatas=[doc["metadata"]]
        )

        for i, chunk in enumerate(chunks):
            h = _chunk_hash(chunk.page_content)
            if h in seen_hashes:
                skipped_duplicates += 1
                continue
            seen_hashes.add(h)

            # ── Compute line numbers against original content ──
            start_line, end_line = _find_line_range(original_content, chunk.page_content)

            chunk.metadata["chunk_index"]    = i
            chunk.metadata["total_chunks"]   = len(chunks)
            chunk.metadata["is_notebook"]    = is_notebook
            chunk.metadata["token_estimate"] = _estimate_tokens(chunk.page_content)
            chunk.metadata["start_line"]     = start_line
            chunk.metadata["end_line"]       = end_line

            all_chunks.append(chunk)

    total_tokens = sum(c.metadata["token_estimate"] for c in all_chunks)
    print(f"[chunker] {len(raw_docs)} files → {len(all_chunks)} chunks "
          f"(~{total_tokens:,} tokens, {skipped_duplicates} duplicates removed)")
    return all_chunks