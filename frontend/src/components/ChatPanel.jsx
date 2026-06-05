import { useState, useRef, useEffect } from "react";

const SUGGESTED_QUESTIONS = [
  { icon: "A", label: "Architecture map", prompt: "Explain the architecture and key modules" },
  { icon: "API", label: "API routes", prompt: "Which files contain API route definitions?" },
  { icon: "FLOW", label: "Data flow", prompt: "How does data flow from frontend to backend?" },
  { icon: "SMELL", label: "Code smells", prompt: "Show me potential code smells in this repo" },
  { icon: "COUPLE", label: "Coupling hotspots", prompt: "Which components are most coupled?" },
  { icon: "SURF", label: "Quick overview", prompt: "Summarize the project architecture" },
];

// â”€â”€ Markdown-lite renderer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function MessageContent({ content, sources = [], onOpenSource }) {
  const parts = content.split(/(```[\w]*\n[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        const codeMatch = part.match(/```([\w]*)\n([\s\S]*?)```/);
        if (codeMatch) {
          const [, lang = "text", code] = codeMatch;
          return (
            <pre key={i} className="code-block">
              <code data-lang={lang}>{code.trim()}</code>
            </pre>
          );
        }
        return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{part}</span>;
      })}
      {sources.length > 0 && (
        <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
          <span style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: "0.62rem",
            color: "var(--muted)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginRight: "2px",
          }}>
            sources
          </span>
          {sources.map((s, i) => {
            const filename = s.file_path.split("/").pop();
            const hasLines = s.start_line && s.end_line;
            return (
              <button
                key={i}
                onClick={() => onOpenSource?.(s)}
                title={`${s.file_path}${hasLines ? ` - L${s.start_line}-${s.end_line}` : ""}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  border: "1px solid rgba(249,115,22,0.25)",
                  background: "rgba(249,115,22,0.08)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  fontFamily: "'DM Mono', monospace",
                  fontSize: "0.68rem",
                  color: "var(--brand)",
                }}
                onMouseOver={e => { e.currentTarget.style.background = "rgba(249,115,22,0.15)"; }}
                onMouseOut={e => { e.currentTarget.style.background = "rgba(249,115,22,0.08)"; }}
              >
                <span>Open in viewer</span>
                <span style={{ color: "var(--muted-2)" }}>-</span>
                <span style={{ color: "var(--ink)" }}>{filename}</span>
                {hasLines && (
                  <span style={{
                    background: "rgba(255,255,255,0.06)",
                    borderRadius: "4px",
                    padding: "1px 5px",
                    fontSize: "0.62rem",
                    color: "var(--muted)",
                  }}>
                    L{s.start_line}-{s.end_line}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// â”€â”€ Main ChatPanel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function ChatPanel({
  repoName,
  onClearRepo,
  messages,
  isLoading,
  error,
  sendQuestion,
  clearChat,
  onOpenCodeViewer,
}) {
  const [input, setInput]           = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendQuestion(input.trim());
    setInput("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const openSource = (source) => {
    if (!onOpenCodeViewer) return;
    onOpenCodeViewer({
      filePath:  source.file_path,
      language:  source.language,
      startLine: source.start_line,
      endLine:   source.end_line,
    });
  };

  return (
    <div className="chat-wrap">
      {/* Header */}
      <div className="chat-header">
        <div>
          <div className={`chat-title ${repoName ? "" : "no-repo"}`}>
            {repoName ? (
              <>
                <span className="repo-prefix">RG</span>
                <span className="repo-pill">{repoName}</span>
              </>
            ) : "Paste a GitHub URL to get started <-"}
          </div>
          <div className="chat-sub">{messages.length} messages</div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {repoName && (
            <button onClick={onClearRepo} className="ghost-btn" title="Exit current repo" style={{ fontSize: "0.75rem" }}>
              x Exit repo
            </button>
          )}
          {messages.length > 0 && (
            <button onClick={clearChat} className="ghost-btn">Clear Chat</button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <div className="empty-card">
              <div className="empty-logo" aria-hidden="true">
                <div className="empty-logo-core">RG</div>
              </div>
              <div className="empty-copy">
                <h2>Welcome to RepoRAG</h2>
                <p>Ingest a repository, then explore architecture, data flow, and code quality in seconds.</p>
              </div>
              <div className="suggestions">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button key={q.label} onClick={() => setInput(q.prompt)} className="suggestion-btn">
                    <span className="suggestion-icon">{q.icon}</span>
                    <span className="suggestion-label">{q.label}</span>
                    <span className="suggestion-sub">{q.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`bubble ${msg.role === "user" ? "user" : "assistant"}`}>
            <div className="role">{msg.role === "user" ? "You" : "RepoRAG"}</div>
            <div className="body">
              <MessageContent
                content={msg.content}
                sources={msg.role === "assistant" ? msg.sources : []}
                onOpenSource={openSource}
              />
              {isLoading && msg.role === "assistant" && msg === messages[messages.length - 1] && (
                <span className="cursor">|</span>
              )}
            </div>

          </div>
        ))}

        {error && <div className="error">! {error}</div>}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={repoName ? "Ask about architecture, bugs, data flow... (Enter to send)" : "Ingest a repository first"}
          disabled={!repoName || isLoading}
          rows={2}
        />
        <button onClick={handleSend} disabled={!repoName || isLoading || !input.trim()} className="send-btn">
          {isLoading ? "..." : "Send >"}
        </button>
      </div>

    </div>
  );
}

