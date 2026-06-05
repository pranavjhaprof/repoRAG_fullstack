import { useState, useCallback, useMemo, useRef } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// ── Axios instance ───────────────────────────────────────────────
const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// ── Helpers ──────────────────────────────────────────────────────
function newSession(repoName = null) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    repoName,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function clampTitle(text) {
  return text.length > 48 ? `${text.slice(0, 48)}...` : text;
}

// ── Save session to backend (debounced) ──────────────────────────
async function persistSession(session) {
  // Don't save empty sessions — only persist once user has sent a message
  if (!session.messages || session.messages.length === 0) return;
  try {
    await api.post("/history", session);
  } catch (e) {
    console.warn("[history] save failed:", e.message);
  }
}

// ── useChat ──────────────────────────────────────────────────────
export function useChat(repoName) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Debounce timer ref per session
  const saveTimers = useRef({});

  // ── Persist with 800ms debounce so we don't hammer the API ──
  const scheduleSave = useCallback((session) => {
    if (saveTimers.current[session.id]) {
      clearTimeout(saveTimers.current[session.id]);
    }
    saveTimers.current[session.id] = setTimeout(() => {
      persistSession(session);
    }, 800);
  }, []);

  // ── Load history for a user (called on login) ────────────────
  const loadHistory = useCallback(async () => {
    try {
      const res = await api.get("/history");
      const loaded = res.data.sessions || [];

      // Always open a FRESH empty chat on login.
      // Past sessions go into the sidebar for access, but nothing is auto-opened.
      const fresh = newSession(null);

      if (loaded.length > 0) {
        // Prepend fresh session — history is accessible but not active
        setSessions([fresh, ...loaded]);
      } else {
        setSessions([fresh]);
      }
      setActiveSessionId(fresh.id);   // ← always land on blank chat
    } catch (e) {
      console.warn("[history] load failed:", e.message);
      const fresh = newSession(null);
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
    } finally {
      setHistoryLoaded(true);
    }
  }, []);

  // ── Clear all local state (called on logout) ─────────────────
  const clearLocalState = useCallback(() => {
    setSessions([]);
    setActiveSessionId(null);
    setHistoryLoaded(false);
    setError(null);
    // Clear any pending save timers
    Object.values(saveTimers.current).forEach(clearTimeout);
    saveTimers.current = {};
  }, []);

  // ── Core state updater — saves to backend after every change ──
  const safeSetSessions = useCallback((updater, sessionToSave = null) => {
    setSessions((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // If a specific session was modified, persist it
      if (sessionToSave) {
        const updated = next.find((s) => s.id === sessionToSave);
        if (updated) scheduleSave(updated);
      }
      return next;
    });
  }, [scheduleSave]);

  // ── Derived ──────────────────────────────────────────────────
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || sessions[0] || null,
    [sessions, activeSessionId]
  );
  const messages = activeSession?.messages || [];

  // ── Actions ──────────────────────────────────────────────────
  const startNewChat = useCallback((repoOverride = null) => {
    const session = newSession(repoOverride || repoName || null);
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setError(null);
    scheduleSave(session);
  }, [repoName, scheduleSave]);

  const clearAllChats = useCallback(async (repoOverride = null) => {
    // Delete all from backend
    try { await api.delete("/history"); } catch (e) { console.warn(e); }
    const session = newSession(repoOverride || repoName || null);
    setSessions([session]);
    setActiveSessionId(session.id);
    setError(null);
    scheduleSave(session);
  }, [repoName, scheduleSave]);

  const resetForRepo = useCallback((nextRepoName) => {
    clearAllChats(nextRepoName);
  }, [clearAllChats]);

  const selectSession = useCallback((sessionId) => {
    setActiveSessionId(sessionId);
    setError(null);
  }, []);

  const deleteSession = useCallback(async (sessionId) => {
    // Delete from backend
    try { await api.delete(`/history/${sessionId}`); } catch (e) { console.warn(e); }
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== sessionId);
      if (filtered.length === 0) {
        const created = newSession(repoName || null);
        setActiveSessionId(created.id);
        scheduleSave(created);
        return [created];
      }
      if (sessionId === activeSessionId) {
        setActiveSessionId(filtered[0].id);
      }
      return filtered;
    });
  }, [activeSessionId, repoName, scheduleSave]);

  const updateActiveSession = useCallback((updater) => {
    if (!activeSessionId) return;
    setSessions((prev) => {
      const next = prev.map((session) => {
        if (session.id !== activeSessionId) return session;
        const updated = updater(session);
        return { ...updated, updatedAt: new Date().toISOString() };
      });
      const changed = next.find((s) => s.id === activeSessionId);
      if (changed) scheduleSave(changed);
      return next;
    });
  }, [activeSessionId, scheduleSave]);

  const addMessage = useCallback((role, content, sources = []) => {
    const message = {
      id: crypto.randomUUID(),
      role,
      content,
      sources,
      timestamp: new Date().toISOString(),
    };
    updateActiveSession((session) => {
      const nextMessages = [...session.messages, message];
      const shouldUpdateTitle = session.title === "New chat" && role === "user";
      return {
        ...session,
        repoName: session.repoName || repoName || null,
        messages: nextMessages,
        title: shouldUpdateTitle ? clampTitle(content) : session.title,
      };
    });
  }, [updateActiveSession, repoName]);

  const updateLastMessage = useCallback((token) => {
    updateActiveSession((session) => {
      const next = [...session.messages];
      const last = next[next.length - 1];
      if (!last || last.role !== "assistant") return session;
      next[next.length - 1] = { ...last, content: `${last.content}${token}` };
      return { ...session, messages: next };
    });
  }, [updateActiveSession]);

  const sendQuestion = useCallback(async (question) => {
    const effectiveRepo = activeSession?.repoName || repoName;
    if (!effectiveRepo) {
      setError("Please ingest a repository first.");
      return;
    }

    setError(null);
    setIsLoading(true);
    addMessage("user", question);
    addMessage("assistant", "");

    try {
      const response = await fetch(`${API_BASE}/ask/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_name: effectiveRepo, question }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Streaming body unavailable.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.replace("data: ", "").trim();
          if (data === "[DONE]") break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.token) updateLastMessage(parsed.token);
            if (parsed.error) setError(parsed.error);
            if (parsed.sources?.length) {
              updateActiveSession((session) => {
                const next = [...session.messages];
                const last = next[next.length - 1];
                if (!last || last.role !== "assistant") return session;
                next[next.length - 1] = { ...last, sources: parsed.sources };
                return { ...session, messages: next };
              });
            }
          } catch { /* ignore malformed */ }
        }
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }, [activeSession, repoName, addMessage, updateLastMessage, updateActiveSession]);

  const clearChat = useCallback(() => {
    updateActiveSession((session) => ({
      ...session,
      messages: [],
      title: "New chat",
      repoName: session.repoName || repoName || null,
    }));
    setError(null);
  }, [updateActiveSession, repoName]);

  return {
    sessions,
    activeSession,
    activeSessionId,
    messages,
    isLoading,
    error,
    historyLoaded,
    sendQuestion,
    clearChat,
    startNewChat,
    clearAllChats,
    resetForRepo,
    selectSession,
    deleteSession,
    loadHistory,
    clearLocalState,
  };
}

// ── useIngest ────────────────────────────────────────────────────
export function useIngest() {
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const ingestRepo = useCallback(async (repoUrl) => {
    setStatus("loading");
    setError(null);
    try {
      const res = await api.post("/ingest", { repo_url: repoUrl });
      setResult(res.data);
      setStatus("success");
      // Return both repoName and file_tree
      return { repoName: res.data.repo_name, tree: res.data.file_tree || null };
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || "Ingestion failed";
      setError(msg);
      setStatus("error");
      return { repoName: null, tree: null };
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return { status, result, error, ingestRepo, reset };
}