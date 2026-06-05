import { useState, useEffect, useRef } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

function getLineClass(lineNum, highlightStart, highlightEnd) {
  if (!highlightStart || !highlightEnd) return {};
  if (lineNum >= highlightStart && lineNum <= highlightEnd) {
    return {
      background: "rgba(249,115,22,0.18)",
      borderLeft: "3px solid var(--brand)",
      paddingLeft: "5px",
      marginLeft: "-8px",
    };
  }
  return {};
}

export default function CodeViewer({ repoName, filePath, language, startLine, endLine, onClose }) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const highlightRef = useRef(null);

  useEffect(() => {
    if (!filePath || !repoName) return;
    setLoading(true);
    setContent(null);
    setError(null);

    fetch(`${API_BASE}/repo/${repoName}/file?path=${encodeURIComponent(filePath)}`,
      { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (data.content) setContent(data.content);
        else setError("Could not load file.");
      })
      .catch(() => setError("Failed to fetch file."))
      .finally(() => setLoading(false));
  }, [repoName, filePath]);

  // Scroll to highlighted lines after content loads
  useEffect(() => {
    if (content && startLine && highlightRef.current) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [content, startLine]);

  const lines = content ? content.split("\n") : [];

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 200,
      background: "rgba(7,9,15,0.85)",
      backdropFilter: "blur(6px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      animation: "fadeUp 0.18s ease",
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "100%",
        maxWidth: "860px",
        maxHeight: "85vh",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "16px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(249,115,22,0.1)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 18px",
          borderBottom: "1px solid var(--line)",
          background: "rgba(249,115,22,0.04)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "0.9rem" }}>📄</span>
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: "0.78rem",
              color: "var(--ink)",
            }}>{filePath}</span>
            {startLine && (
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: "0.68rem",
                color: "var(--brand)",
                background: "rgba(249,115,22,0.12)",
                border: "1px solid rgba(249,115,22,0.3)",
                borderRadius: "6px",
                padding: "2px 8px",
              }}>
                L{startLine}–{endLine}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--line)",
              color: "var(--muted)",
              borderRadius: "8px",
              padding: "4px 10px",
              cursor: "pointer",
              fontFamily: "'DM Mono', monospace",
              fontSize: "0.7rem",
            }}
          >✕ close</button>
        </div>

        {/* Code area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 0" }}>
          {loading && (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)",
              fontFamily: "'DM Mono', monospace", fontSize: "0.8rem" }}>
              loading file...
            </div>
          )}
          {error && (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--danger)",
              fontFamily: "'DM Mono', monospace", fontSize: "0.8rem" }}>
              {error}
            </div>
          )}
          {content && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'DM Mono', monospace", fontSize: "0.76rem", lineHeight: "1.6" }}>
              <tbody>
                {lines.map((line, i) => {
                  const lineNum = i + 1;
                  const isHighlighted = startLine && endLine && lineNum >= startLine && lineNum <= endLine;
                  return (
                    <tr
                      key={i}
                      ref={isHighlighted && lineNum === startLine ? highlightRef : null}
                      style={{
                        background: isHighlighted ? "rgba(249,115,22,0.12)" : "transparent",
                        transition: "background 0.1s",
                      }}
                    >
                      {/* Line number */}
                      <td style={{
                        width: "52px",
                        padding: "0 12px",
                        textAlign: "right",
                        color: isHighlighted ? "var(--brand)" : "var(--muted)",
                        userSelect: "none",
                        borderLeft: isHighlighted ? "3px solid var(--brand)" : "3px solid transparent",
                        fontVariantNumeric: "tabular-nums",
                        flexShrink: 0,
                      }}>
                        {lineNum}
                      </td>
                      {/* Code */}
                      <td style={{
                        padding: "0 20px 0 12px",
                        color: "var(--ink)",
                        whiteSpace: "pre",
                        overflowX: "auto",
                      }}>
                        {line || " "}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
