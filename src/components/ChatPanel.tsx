import { useEffect, useRef, useState } from "react";
import type { ChatTurn } from "../hooks/useChat";
import { IconClose, IconRefresh, IconSend } from "./icons/Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  turns: ChatTurn[];
  busy: boolean;
  onSend: (text: string) => void;
  onClear: () => void;
  /** Retry the last user message after an error. */
  onRetry?: () => void;
  /** Whether an API key is configured (drives the empty-state CTA). */
  hasKey?: boolean;
  /** Open onboarding / settings so the user can add a key. */
  onSetupKey?: () => void;
}

export function ChatPanel({
  open,
  onClose,
  turns,
  busy,
  onSend,
  onClear,
  onRetry,
  hasKey = true,
  onSetupKey,
}: Props) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [turns]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className={`panel chat-panel ${open ? "open" : ""}`}>
      <div className="panel-header">
        <span className="panel-title">Chat</span>
        <button
          className="icon-btn"
          onClick={onClear}
          title="Clear conversation"
          disabled={turns.length === 0}
          aria-label="Clear"
        >
          <IconRefresh width={14} height={14} />
        </button>
        <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">
          <IconClose width={14} height={14} />
        </button>
      </div>

      <div className="chat-list" ref={listRef}>
        {turns.length === 0 ? (
          hasKey ? (
            <div className="chat-empty">
              Say hi to Lumi 🌸 — or ask for a Pomodoro.
            </div>
          ) : (
            <div className="chat-cta">
              <div className="chat-cta-emoji">🔌</div>
              <div className="chat-cta-title">Give Lumi a brain to chat</div>
              <div className="chat-cta-sub">
                Add a <strong>free</strong> AI key (~60s, no card) and I'll start talking.
              </div>
              {onSetupKey ? (
                <button className="chat-cta-btn" onClick={onSetupKey}>
                  ✨ Set up AI chat
                </button>
              ) : null}
            </div>
          )
        ) : (
          turns.map((t, i) => {
            const isLast = i === turns.length - 1;
            return (
              <div key={t.id} className={`chat-bubble ${t.role}`}>
                <div className="chat-bubble-text">
                  {t.content || (t.streaming ? "…" : "")}
                </div>
                {t.error ? (
                  <div className="chat-error">
                    ⚠ {t.error}
                    {isLast && onRetry ? (
                      <button className="chat-retry" onClick={onRetry} disabled={busy}>
                        Retry
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={busy ? "thinking…" : "type a message"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy}
        />
        <button
          className="chat-send"
          onClick={submit}
          disabled={busy || !draft.trim()}
          aria-label="Send"
        >
          <IconSend width={16} height={16} />
        </button>
      </div>
    </div>
  );
}
