import { useState } from "react";

const LANG_ICON = {
  python: "🐍", javascript: "🟨", typescript: "🔷", markdown: "📝",
  json: "📋", yaml: "⚙️", html: "🌐", css: "🎨", bash: "💻",
  java: "☕", go: "🐹", rust: "🦀", r: "📊", text: "📄",
};

function FileIcon({ language, type }) {
  if (type === "dir") return <span style={{ fontSize: "0.85rem" }}>📁</span>;
  return <span style={{ fontSize: "0.85rem" }}>{LANG_ICON[language] || "📄"}</span>;
}

function TreeNode({ node, depth = 0, onFileClick, activeFile }) {
  const [open, setOpen] = useState(depth < 2);
  const isDir  = node.type === "dir";
  const isActive = activeFile === node.path;

  const handleClick = () => {
    if (isDir) setOpen(o => !o);
    else onFileClick(node);
  };

  return (
    <div>
      <div
        onClick={handleClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "3px 8px 3px " + (8 + depth * 14) + "px",
          cursor: "pointer",
          borderRadius: "6px",
          background: isActive ? "rgba(249,115,22,0.12)" : "transparent",
          border: isActive ? "1px solid rgba(249,115,22,0.3)" : "1px solid transparent",
          transition: "background 0.12s",
          userSelect: "none",
        }}
        onMouseOver={e => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
        onMouseOut={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
      >
        {isDir && (
          <span style={{ fontSize: "0.6rem", color: "var(--muted)", width: "10px", flexShrink: 0 }}>
            {open ? "▾" : "▸"}
          </span>
        )}
        {!isDir && <span style={{ width: "10px", flexShrink: 0 }} />}
        <FileIcon language={node.language} type={node.type} />
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: "0.72rem",
          color: isActive ? "var(--brand)" : isDir ? "var(--ink)" : "var(--muted-2)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "180px",
        }}>
          {node.name}
        </span>
      </div>
      {isDir && open && node.children?.map((child, i) => (
        <TreeNode
          key={child.path + i}
          node={child}
          depth={depth + 1}
          onFileClick={onFileClick}
          activeFile={activeFile}
        />
      ))}
    </div>
  );
}

export default function FileTree({ tree, onFileClick, activeFile, repoName }) {
  const [expanded, setExpanded] = useState(false);

  if (!tree) return null;

  return (
    <div style={{ borderTop: "1px solid var(--line-soft)", borderBottom: "1px solid var(--line-soft)" }}>
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--muted-2)",
          transition: "background 0.15s",
        }}
        onMouseOver={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
        onMouseOut={e => e.currentTarget.style.background = "transparent"}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "0.75rem" }}>📁</span>
          <span style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: "0.68rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--brand)",
          }}>
            File Structure
          </span>
        </div>
        <span style={{
          fontSize: "0.7rem",
          color: "var(--muted)",
          transition: "transform 0.2s",
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          display: "inline-block",
        }}>▼</span>
      </button>

      {/* Slide-down tree */}
      <div style={{
        maxHeight: expanded ? "none" : "0px",
        overflow: "hidden",
        transition: "max-height 0.3s cubic-bezier(0.4,0,0.2,1)",
      }}>
        <div style={{
          padding: "4px 6px 10px",
        }}>
          {tree.children?.map((node, i) => (
            <TreeNode
              key={node.path + i}
              node={node}
              depth={0}
              onFileClick={onFileClick}
              activeFile={activeFile}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
