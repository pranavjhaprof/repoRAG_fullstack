import { useMemo, useState, useCallback, useEffect } from "react";
import IngestPanel from "./components/IngestPanel";
import FileTree from "./components/FileTree";
import ChatPanel from "./components/ChatPanel";
import CodeViewer from "./components/CodeViewer";
import { useChat } from "./hooks/useChat";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

function formatRelative(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// â”€â”€ Login Screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function LoginScreen() {
  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">RG</div>
        <h1 className="login-title">RepoRAG</h1>
        <p className="login-sub">
          Ask questions about any GitHub repository.<br />
          Powered by RAG + vector search.
        </p>
        <a href={`${API_BASE}/auth/login`} className="login-btn">
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </a>
        <p className="login-footer">Your session is secured via Google OAuth 2.0</p>
      </div>
    </div>
  );
}

// â”€â”€ Collapse Toggle Button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CollapseBtn({ collapsed, onClick }) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      style={{
        position: "relative",
        zIndex: 10,
        width: "26px",
        height: "26px",
        borderRadius: "7px",
        border: "1px solid var(--line)",
        background: "var(--panel-2)",
        color: "var(--muted-2)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.65rem",
        transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
        flexShrink: 0,
      }}
      onMouseOver={e => {
        e.currentTarget.style.background = "var(--brand)";
        e.currentTarget.style.color = "var(--bg)";
        e.currentTarget.style.boxShadow = "0 0 10px var(--brand-glow)";
      }}
      onMouseOut={e => {
        e.currentTarget.style.background = "var(--panel-2)";
        e.currentTarget.style.color = "var(--muted-2)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {collapsed ? ">" : "<"}
    </button>
  );
}

// â”€â”€ Main App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeRepo, setActiveRepo] = useState(null);
  const [autoClearOnRepoSwitch, setAutoClearOnRepoSwitch] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fileTree, setFileTree] = useState(null);
  const [activeFile, setActiveFile] = useState(null);
  const [codeViewer, setCodeViewer] = useState(null); // { filePath, language, startLine, endLine }

  const {
    sessions, activeSession, activeSessionId,
    messages, isLoading, error, historyLoaded,
    sendQuestion, clearChat, startNewChat,
    clearAllChats, resetForRepo, selectSession, deleteSession,
    loadHistory, clearLocalState,
  } = useChat(activeRepo);

  useEffect(() => {
    fetch(`${API_BASE}/auth/user`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.logged_in) {
          setUser(data);
          loadHistory();
        } else {
          setUser(null);
        }
      })
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogout = () => { clearLocalState(); setUser(null); window.location.href = `${API_BASE}/auth/logout`; };

  const handleRepoIngested = useCallback((repoName, tree = null) => {
    const currentRepo = activeSession?.repoName || activeRepo;
    const isDifferentRepo = Boolean(currentRepo && currentRepo !== repoName);
    setActiveRepo(repoName);
    setFileTree(tree);
    setActiveFile(null);
    if (autoClearOnRepoSwitch && isDifferentRepo) { resetForRepo(repoName); return; }
    startNewChat(repoName);
  }, [activeSession, activeRepo, autoClearOnRepoSwitch, resetForRepo, startNewChat]);

  const handleSelectSession = useCallback((sessionId) => {
    selectSession(sessionId);
    const selected = sessions.find((s) => s.id === sessionId);
    if (selected?.repoName) setActiveRepo(selected.repoName);
  }, [selectSession, sessions]);

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    [sessions]
  );

  if (authLoading) {
    return (
      <div className="login-screen">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
          <div style={{
            width: "44px", height: "44px", borderRadius: "12px",
            background: "var(--brand)", display: "flex", alignItems: "center",
            justifyContent: "center", fontFamily: "'Syne', sans-serif",
            fontWeight: 800, fontSize: "0.9rem", color: "var(--bg)",
            animation: "pulse 1.4s ease-in-out infinite",
            boxShadow: "0 0 24px var(--brand-glow)"
          }}>RG</div>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.75rem", color: "var(--muted)", letterSpacing: "0.1em" }}>
            checking session<span style={{ animation: "blink 1s step-end infinite" }}>...</span>
          </span>
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <>
      {/* Inline styles for sidebar transition */}
      <style>{`
        .app-shell {
          display: grid;
          grid-template-columns: ${sidebarCollapsed ? "52px" : "min(310px, 28%)"} 1fr;
          grid-template-rows: 1fr;
          gap: 10px;
          height: 100dvh;
          width: 100%;
          padding: 10px;
          overflow: hidden;
          transition: grid-template-columns 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .sidebar {
          position: relative;
          overflow: hidden;
          height: 100%;
          min-width: 0;
          transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .main-panel {
          min-width: 0;
          height: 100%;
        }
        .sidebar-inner {
          opacity: ${sidebarCollapsed ? "0" : "1"};
          pointer-events: ${sidebarCollapsed ? "none" : "auto"};
          transition: opacity 0.2s ease;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          height: 100%;
          overflow: hidden;
        }
        .sidebar-collapsed-icons {
          display: ${sidebarCollapsed ? "flex" : "none"};
          flex-direction: column;
          align-items: center;
          gap: 14px;
          padding-top: 16px;
          position: absolute;
          inset: 0;
        }
        .sidebar-icon-btn {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid var(--line);
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.85rem;
          transition: background 0.15s, color 0.15s;
        }
        .sidebar-icon-btn:hover {
          background: var(--brand-dim);
          color: var(--brand);
          border-color: var(--brand);
        }
      `}</style>

      <div className="app-shell">
        <aside className="sidebar">
          {/* Collapsed icon strip */}
          <div className="sidebar-collapsed-icons">
            <button
              className="sidebar-icon-btn"
              title="Expand sidebar"
              onClick={() => setSidebarCollapsed(false)}
              style={{ fontSize: "0.75rem" }}
            >{">"}</button>
            <div style={{
              width: "28px", height: "28px",
              borderRadius: "8px",
              background: "var(--brand)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "'Syne', sans-serif",
              fontWeight: 800,
              fontSize: "0.65rem",
              color: "var(--bg)",
              boxShadow: "0 0 12px var(--brand-glow)",
            }}>RG</div>
            <button
              className="sidebar-icon-btn"
              title="New Chat"
              onClick={() => { startNewChat(activeRepo); setSidebarCollapsed(false); }}
            >+</button>
            <button
              className="sidebar-icon-btn"
              title="Chat History"
              onClick={() => setSidebarCollapsed(false)}
            >{"≡"}</button>
            <div style={{ flex: 1 }} />
            {user.picture && (
              <img
                src={user.picture}
                alt={user.name}
                title={user.name}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  border: "1px solid var(--brand)",
                  cursor: "pointer",
                  position: "absolute",
                  left: "50%",
                  bottom: "14px",
                  transform: "translateX(-50%)",
                }}
                onClick={() => setSidebarCollapsed(false)}
              />
            )}
          </div>

          {/* Full sidebar content */}
          <div className="sidebar-inner">
            <div className="sidebar-content">
            {/* Brand */}
            <div className="brand" style={{ justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div className="brand-mark">RG</div>
                <div>
                  <h1 className="brand-title">RepoRAG</h1>
                  <p className="brand-sub">Codebase Assistant</p>
                </div>
              </div>
              <CollapseBtn
                collapsed={sidebarCollapsed}
                onClick={() => setSidebarCollapsed(c => !c)}
              />
            </div>

            <button className="new-chat-btn" onClick={() => startNewChat(activeRepo)}>
              + New Chat
            </button>

            <div className="sidebar-controls">
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={autoClearOnRepoSwitch}
                  onChange={(e) => setAutoClearOnRepoSwitch(e.target.checked)}
                />
                <span>Auto-clear when new repo is ingested</span>
              </label>
              <button className="clear-all-btn" onClick={() => clearAllChats(activeRepo)}>
                Clear All Chats
              </button>
            </div>

            <IngestPanel onRepoIngested={handleRepoIngested} activeRepo={activeRepo} />

            {/* File Structure Tree */}
            <FileTree
              tree={fileTree}
              repoName={activeRepo}
              activeFile={activeFile}
              onFileClick={(node) => {
                setActiveFile(node.path);
                setCodeViewer({
                  filePath: node.path,
                  language: node.language,
                  startLine: null,
                  endLine: null,
                });
              }}
            />

            {/* History */}
            <div className="sidebar-section">
              <div className="section-title">History</div>
              <div className="history-list">
                {orderedSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`history-item ${activeSessionId === session.id ? "active" : ""}`}
                    onClick={() => handleSelectSession(session.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && handleSelectSession(session.id)}
                  >
                    <div className="history-top">
                      <span className="history-title">{session.title}</span>
                      <button
                        className="history-delete"
                        onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                        title="Delete chat"
            >x</button>
                    </div>
                    {session.repoName && (
  <div className="history-repo-badge">
    <span className="history-repo-icon">RG</span>
    <span className="history-repo-text">{session.repoName}</span>
  </div>
)}
                    <div className="history-meta" style={{ marginTop: "4px" }}>
                      <span>{formatRelative(session.updatedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            </div>

            {/* Footer */}
            <div className="sidebar-footer">
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                {user.picture && (
                  <img src={user.picture} alt={user.name}
                    style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid var(--brand)" }} />
                )}
                <span style={{ fontSize: "0.78rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.name}
                </span>
              </div>
              <button onClick={handleLogout} style={{
                background: "transparent",
                border: "1px solid var(--line)",
                color: "var(--muted)",
                borderRadius: "7px",
                padding: "4px 10px",
                cursor: "pointer",
                fontSize: "0.72rem",
                fontFamily: "'DM Mono', monospace",
                transition: "color 0.15s, border-color 0.15s",
                width: "100%",
                textAlign: "left",
              }}
                onMouseOver={e => { e.currentTarget.style.color = "var(--danger)"; e.currentTarget.style.borderColor = "var(--danger)"; }}
                onMouseOut={e => { e.currentTarget.style.color = "var(--muted)"; e.currentTarget.style.borderColor = "var(--line)"; }}
              >
                x Sign out
              </button>
            </div>
          </div>
        </aside>

        <main className="main-panel">
          <ChatPanel
            repoName={activeSession?.repoName || activeRepo}
            onClearRepo={() => {
              setActiveRepo(null);
              setFileTree(null);
              setActiveFile(null);
              setCodeViewer(null);
              startNewChat(null);
            }}
            messages={messages}
            isLoading={isLoading}
            error={error}
            sendQuestion={sendQuestion}
            clearChat={clearChat}
            onOpenCodeViewer={(payload) => setCodeViewer(payload)}
          />
        </main>
      </div>

      {/* Code Viewer overlay */}
      {codeViewer && (
        <CodeViewer
          repoName={activeSession?.repoName || activeRepo}
          filePath={codeViewer.filePath}
          language={codeViewer.language}
          startLine={codeViewer.startLine}
          endLine={codeViewer.endLine}
          onClose={() => setCodeViewer(null)}
        />
      )}
    </>
  );
}

