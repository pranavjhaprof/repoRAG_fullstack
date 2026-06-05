# RepoRAG — Frontend

React + Vite frontend for [RepoRAG](https://github.com/pranavjhaprof/github-RAG-assistant-backend) — an AI assistant that lets you chat with any GitHub repository.

> The backend repo lives here: [github-RAG-assistant-backend](https://github.com/pranavjhaprof/github-RAG-assistant-backend)

## What This UI Does

- Google OAuth login flow
- Paste a GitHub repo URL → triggers ingestion
- Chat panel with real-time streamed answers (SSE)
- File tree browser for the ingested repo
- Raw file viewer fetched live from GitHub
- Chat history per session

## Tech Stack

React · Vite · Google OAuth (via backend session)

## Local Setup
```bash
npm install
npm run dev
```

## Environment Variables

Create a `frontend/.env` file:

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend base URL for auth (e.g. `http://localhost:8000`) |
| `VITE_API_BASE_URL` | Backend base URL for API calls (e.g. `http://localhost:8000`) |

## Project Structure
```
src/
├── components/
│   ├── ChatPanel.jsx    — Chat UI + SSE streaming
│   ├── IngestPanel.jsx  — Repo ingestion form
│   ├── FileTree.jsx     — Repo tree browser
│   └── CodeViewer.jsx   — Raw file viewer
├── hooks/
│   └── useChat.js       — Chat state, history, SSE handling
└── App.jsx              — Layout, auth gate, panels
```

## Related

- Backend: [github-RAG-assistant-backend](https://github.com/pranavjhaprof/github-RAG-assistant-backend)
- Full architecture and deployment guide are in the backend README
