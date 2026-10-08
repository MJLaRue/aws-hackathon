/**
 * AIPage.jsx
 * Bedrock-powered financial AI assistant.
 * Calls POST /api/chat → chatbot.py → Amazon Bedrock Converse API.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { api } from "../api.js";
import { C, fmtUsd, fmtPct } from "../utils.js";

// ── Suggested prompts ─────────────────────────────────────────────────────────
const SUGGESTIONS = [
  "Which department exceeded its budget the most this year?",
  "Summarize the top anomalies and what might be causing them.",
  "What is the overall budget vs actual variance?",
  "Which categories are consistently underspent?",
  "What does the forecast say about spending for the next 6 months?",
  "What if salaries increase by 5%?",
];

// ── Markdown-lite renderer (bold, code, bullets) ─────────────────────────────
function RenderMessage({ text }) {
  if (!text) return null;
  const lines = text.split("\n");
  return (
    <div style={{ lineHeight: 1.65, fontSize: 14 }}>
      {lines.map((line, i) => {
        // Bullet lines
        if (line.startsWith("• ") || line.startsWith("- ")) {
          return (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
              <span style={{ color: C.blue, flexShrink: 0 }}>•</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          );
        }
        // Numbered lines
        if (/^\d+\./.test(line)) {
          return <div key={i} style={{ marginBottom: 3 }}>{renderInline(line)}</div>;
        }
        // Empty line → spacer
        if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
        // Heading lines (##)
        if (line.startsWith("## ")) {
          return <div key={i} style={{ fontWeight: 700, fontSize: 15, marginTop: 10, marginBottom: 4, color: C.navy }}>{line.slice(3)}</div>;
        }
        return <div key={i}>{renderInline(line)}</div>;
      })}
    </div>
  );
}

function renderInline(text) {
  // Bold **text**, inline `code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={i} style={{ fontWeight: 700 }}>{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code key={i} style={{
          background: "#F1F5F9", padding: "1px 5px", borderRadius: 4,
          fontFamily: "monospace", fontSize: 12, color: C.navy,
        }}>
          {p.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

// ── Message bubble ────────────────────────────────────────────────────────────
function Bubble({ role, text, model, bedrockAvailable, isLoading }) {
  const isUser = role === "user";
  return (
    <div style={{
      display: "flex",
      flexDirection: isUser ? "row-reverse" : "row",
      gap: 10,
      alignItems: "flex-start",
      marginBottom: 16,
    }}>
      {/* Avatar */}
      <div style={{
        width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
        background: isUser ? C.navy : C.teal,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: 14, fontWeight: 700,
      }}>
        {isUser ? "U" : "✦"}
      </div>

      {/* Bubble */}
      <div style={{
        maxWidth: "72%",
        background: isUser ? C.navy : C.surface,
        color: isUser ? "#fff" : C.text,
        border: isUser ? "none" : `1px solid ${C.border}`,
        borderRadius: isUser ? "18px 4px 18px 18px" : "4px 18px 18px 18px",
        padding: "12px 16px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      }}>
        {isLoading ? (
          <TypingIndicator />
        ) : (
          <RenderMessage text={text} />
        )}

        {/* Footer — model tag + Bedrock status */}
        {!isUser && !isLoading && (
          <div style={{
            marginTop: 10, paddingTop: 8,
            borderTop: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 11, color: C.textMuted,
          }}>
            {bedrockAvailable === false ? (
              <span style={{
                background: C.amberLight, color: C.amber,
                padding: "1px 7px", borderRadius: 10, fontWeight: 600,
              }}>
                ⚠ Bedrock unavailable — rule-based fallback
              </span>
            ) : model ? (
              <span style={{
                background: C.tealLight, color: C.teal,
                padding: "1px 7px", borderRadius: 10, fontWeight: 600,
              }}>
                ✦ {model.split(".").pop().replace(/-v\d.*/, "")}
              </span>
            ) : null}
            <span style={{ marginLeft: "auto" }}>Amazon Bedrock</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "4px 0" }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: "50%",
          background: C.teal, opacity: 0.7,
          animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}

// ── Main AIPage ────────────────────────────────────────────────────────────────
export default function AIPage({ filters = {} }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async (question) => {
    const q = (question ?? input).trim();
    if (!q || loading) return;

    setInput("");
    setError(null);

    // Build history from existing messages
    const history = messages.map(m => ({ role: m.role, text: m.text }));

    // Add user message immediately
    setMessages(prev => [...prev, { role: "user", text: q }]);
    setLoading(true);

    try {
      const result = await api.chat(q, filters, history);
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          text: result.answer,
          model: result.model,
          bedrockAvailable: result.bedrock_available,
        },
      ]);
    } catch (err) {
      setError(err.message);
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          text: "Sorry, I couldn't reach the backend. Make sure the Python server is running on port 8000.",
          model: null,
          bedrockAvailable: false,
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, messages, filters]);

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  };

  const isEmpty = messages.length === 0;

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "calc(100vh - 112px)", /* shell header + tab nav */
      maxWidth: 900, margin: "0 auto", padding: "0 20px",
    }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 0 12px",
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 12,
            background: `linear-gradient(135deg, ${C.teal}, ${C.navy})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 18,
          }}>✦</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>
              AI Financial Assistant
            </div>
            <div style={{ fontSize: 11, color: C.textMuted }}>
              Powered by Amazon Bedrock · Grounded in your budget data
            </div>
          </div>
        </div>
        {messages.length > 0 && (
          <button onClick={clearChat} style={{
            border: `1px solid ${C.border}`, background: C.surface,
            borderRadius: 8, padding: "6px 12px", fontSize: 12,
            color: C.textMuted, cursor: "pointer",
          }}>
            Clear chat
          </button>
        )}
      </div>

      {/* ── Messages area ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 0" }}>
        {isEmpty ? (
          <div style={{ textAlign: "center", paddingTop: 32 }}>
            {/* Empty state */}
            <div style={{ fontSize: 40, marginBottom: 12 }}>✦</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 6 }}>
              Ask anything about your budget data
            </div>
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 28, maxWidth: 480, margin: "0 auto 28px" }}>
              I have access to KPIs, department breakdowns, anomalies, forecasts,
              and scenario analysis — all grounded in the actual dataset.
            </div>
            {/* Suggestion chips */}
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 8,
              justifyContent: "center", maxWidth: 680, margin: "0 auto",
            }}>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)} style={{
                  border: `1px solid ${C.border}`,
                  background: C.surface, borderRadius: 20,
                  padding: "8px 14px", fontSize: 12.5, color: C.navy,
                  cursor: "pointer", textAlign: "left",
                  transition: "border-color 0.15s, background 0.15s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.background = C.tealLight; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.surface; }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <Bubble
                key={i}
                role={m.role}
                text={m.text}
                model={m.model}
                bedrockAvailable={m.bedrockAvailable}
              />
            ))}
            {loading && (
              <Bubble role="assistant" isLoading />
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{
          background: C.redLight, color: C.red,
          borderRadius: 8, padding: "8px 14px", fontSize: 12,
          marginBottom: 8, flexShrink: 0,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Input bar ── */}
      <div style={{
        flexShrink: 0, paddingBottom: 16,
        borderTop: `1px solid ${C.border}`, paddingTop: 12,
      }}>
        <div style={{
          display: "flex", gap: 10, alignItems: "flex-end",
          background: C.surface, border: `1.5px solid ${loading ? C.teal : C.border}`,
          borderRadius: 14, padding: "10px 10px 10px 16px",
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          transition: "border-color 0.2s",
        }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              // Auto-grow
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={handleKey}
            placeholder="Ask about budgets, anomalies, forecasts… (Enter to send)"
            style={{
              flex: 1, border: "none", outline: "none", resize: "none",
              fontSize: 14, color: C.text, background: "transparent",
              fontFamily: "inherit", lineHeight: 1.5,
              minHeight: 24, maxHeight: 120, overflowY: "auto",
            }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            style={{
              width: 38, height: 38, borderRadius: 10, border: "none",
              background: (!input.trim() || loading) ? C.border : C.teal,
              color: "#fff", cursor: (!input.trim() || loading) ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, flexShrink: 0, transition: "background 0.15s",
            }}
          >
            {loading ? "⟳" : "↑"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, paddingLeft: 4 }}>
          Answers are grounded in the active dashboard filters · Never invents financial figures
        </div>
      </div>
    </div>
  );
}
