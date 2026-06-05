"""
rag/vector_store.py
-------------------
Uses FREE local sentence-transformers for embeddings.
No API key needed for embeddings at all.
Groq handles the LLM side in query_engine.py
"""

import os
import re
import chromadb
from langchain.schema import Document
from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from dotenv import load_dotenv

load_dotenv()

CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")

# Free local embedding model — downloads once (~90MB), runs offline after
EMBEDDING_MODEL = "all-MiniLM-L6-v2"


def _get_embeddings():
    return HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True}
    )


def _collection_name(repo_name: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9-]", "-", repo_name)
    return name[:63]


def ingest_chunks(repo_name: str, chunks: list[Document]) -> Chroma:
    embeddings = _get_embeddings()
    collection = _collection_name(repo_name)

    print(f"[vector_store] Embedding {len(chunks)} chunks into '{collection}'...")
    print(f"[vector_store] Using local model: {EMBEDDING_MODEL} (no API needed)")

    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        collection_name=collection,
        persist_directory=CHROMA_PERSIST_DIR,
    )

    print(f"[vector_store] Done. Stored in {CHROMA_PERSIST_DIR}")
    return vectorstore


def load_vectorstore(repo_name: str) -> Chroma:
    embeddings = _get_embeddings()
    collection = _collection_name(repo_name)

    vectorstore = Chroma(
        collection_name=collection,
        embedding_function=embeddings,
        persist_directory=CHROMA_PERSIST_DIR,
    )

    count = vectorstore._collection.count()
    print(f"[vector_store] Loaded '{collection}' — {count} chunks")
    return vectorstore


def list_ingested_repos() -> list[str]:
    client = chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)
    return [col.name for col in client.list_collections()]