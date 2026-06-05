import { useState, useEffect } from "react";
import { useIngest } from "../hooks/useChat";

// ── Animated loader ──────────────────────────────────────────────
function IndexingAnimation() {
  return (
    <div style={{
      marginTop: "10px",
      padding: "10px 12px",
      borderRadius: "8px",
      border: "1px solid rgba(249,115,22,0.25)",
      background: "rgba(249,115,22,0.06)",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{
          display: "inline-block",
          width: "8px", height: "8px",
          borderRadius: "50%",
          background: "var(--brand)",
          boxShadow: "0 0 8px var(--brand-glow)",
          animation: "pulse 1.2s ease-in-out infinite",
        }} />
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: "0.72rem",
          color: "var(--brand)",
          letterSpacing: "0.04em",
        }}>
          Indexing files and embeddings...
        </span>
      </div>
      <div style={{
        height: "3px",
        borderRadius: "99px",
        background: "rgba(249,115,22,0.15)",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: "40%",
          borderRadius: "99px",
          background: "linear-gradient(90deg, var(--brand), #fbbf24)",
          animation: "scanline 1.6s ease-in-out infinite",
        }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
        {[
          "⟳ Fetching repository files...",
          "⟳ Chunking documents...",
          "⟳ Generating embeddings...",
          "⟳ Storing in vector database...",
        ].map((line, i) => (
          <span key={i} style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: "0.68rem",
            color: "var(--muted)",
            animation: `fadeStep 2.4s ease ${i * 0.6}s infinite`,
            opacity: 0,
          }}>
            {line}
          </span>
        ))}
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.7); }
        }
        @keyframes scanline {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        @keyframes fadeStep {
          0%   { opacity: 0; }
          10%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────
export default function IngestPanel({ onRepoIngested, activeRepo }) {
  const [url, setUrl] = useState("");
  const { status, result, error, ingestRepo, reset } = useIngest();

  // When activeRepo is cleared (exit repo), reset the panel
  useEffect(() => {
    if (!activeRepo) {
      setUrl("");
      reset();
    }
  }, [activeRepo]);

  const handleSubmit = async () => {
    if (!url.trim()) return;
    const { repoName, tree } = await ingestRepo(url.trim());
    if (repoName) onRepoIngested(repoName, tree);
  };

  return (
    <div className="ingest-card">
      <label className="ingest-label">Repository URL</label>
      <div className="ingest-row">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="https://github.com/owner/repo"
          disabled={status === "loading"}
        />
        <button onClick={handleSubmit} disabled={status === "loading" || !url.trim()}>
          {status === "loading" ? "···" : "Ingest"}
        </button>
      </div>

      <p className="ingest-hint">
        Ingesting a new repo will auto-clear previous chat history.
      </p>

      {status === "loading" && <IndexingAnimation />}

      {status === "success" && result && (
        <p className="ingest-success">
          ✓ {result.files_indexed} files · {result.chunks_created} chunks indexed
        </p>
      )}
      {status === "error" && (
        <p className="ingest-error">✗ {error}</p>
      )}
    </div>
  );
}
