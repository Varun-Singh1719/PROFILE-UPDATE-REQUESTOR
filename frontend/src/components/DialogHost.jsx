/**
 * DialogHost — single mount point that renders confirm / prompt / alert
 * dialogs emitted by the `/lib/dialog.js` event bus.
 *
 * Mount once at the app root (inside <GlobalToaster>) so any module can
 * call `await confirm({...})` from anywhere.
 *
 * Visual design:
 *   • Rounded 2xl card with soft shadow, subtle backdrop blur.
 *   • Icon badge in the header — chooses a color/shape from `confirmVariant`:
 *       destructive → red AlertTriangle in a red-tinted circle
 *       primary     → orange HelpCircle in an orange-tinted circle
 *       info/other  → gray Info in a gray-tinted circle
 *     Callers may override with `icon: <ReactNode>` and `tone: "red"|"orange"|"gray"`.
 *   • Title + message with clear hierarchy, message uses relaxed leading.
 *   • Footer is a plain white row (no ugly gray band) with a hairline top border.
 *   • Buttons have consistent h-9 sizing, focus rings, and hover states.
 */
import React, { useEffect, useState, useRef } from "react";
import AlertTriangle from "@mui/icons-material/WarningAmber";
import HelpCircle from "@mui/icons-material/HelpOutlined";
import Info from "@mui/icons-material/InfoOutlined";
import X from "@mui/icons-material/Close";
import { _subscribe, _resolve } from "../lib/dialog";

const TONE_STYLES = {
  red:    { bg: "bg-red-50",    fg: "text-red-600",    ring: "ring-red-100"    },
  orange: { bg: "bg-[#ec9324]/10", fg: "text-[#ec9324]", ring: "ring-[#ec9324]/10" },
  gray:   { bg: "bg-gray-100",  fg: "text-gray-600",  ring: "ring-gray-100"    },
};

function pickTone(opts, kind) {
  if (opts.tone && TONE_STYLES[opts.tone]) return opts.tone;
  if (opts.confirmVariant === "destructive") return "red";
  if (kind === "confirm") return "orange";
  return "gray";
}

function pickIcon(opts, kind) {
  if (opts.icon) return opts.icon;
  if (opts.confirmVariant === "destructive") return <AlertTriangle sx={{ fontSize: 20 }}/>;
  if (kind === "confirm" || kind === "prompt") return <HelpCircle sx={{ fontSize: 20 }}/>;
  return <Info sx={{ fontSize: 20 }}/>;
}

export default function DialogHost() {
  // The full queue lives here so multiple back-to-back confirms don't stomp
  // on each other. We only render the head of the queue at any time.
  const [queue, setQueue] = useState([]);
  const inputRef = useRef(null);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    const unsub = _subscribe((payload) => {
      setQueue((q) => [...q, payload]);
    });
    return unsub;
  }, []);

  const current = queue[0] || null;

  // Reset input when a new prompt becomes the head of the queue.
  useEffect(() => {
    if (current?.kind === "prompt") {
      setInputValue(current.opts.defaultValue ?? "");
      // Autofocus the field after the dialog mounts.
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [current]);

  // ESC closes (cancel) — Enter confirms.
  useEffect(() => {
    if (!current) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(current.kind === "confirm" ? false : null);
      } else if (e.key === "Enter" && current.kind !== "prompt") {
        // Prompt has its own Enter handler inside the input.
        e.preventDefault();
        finish(current.kind === "confirm" ? true : undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!current) return null;

  const finish = (value) => {
    _resolve(current.id, value);
    setQueue((q) => q.slice(1));
  };

  const { kind, opts } = current;
  const tone = pickTone(opts, kind);
  const toneClasses = TONE_STYLES[tone];
  const iconNode = pickIcon(opts, kind);
  const isDestructive = opts.confirmVariant === "destructive";

  const confirmBtnClass = isDestructive
    ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-200 text-white"
    : "bg-[#ec9324] hover:bg-[#d4811f] focus-visible:ring-[#ec9324]/30 text-white";

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-4 animate-[dialogFade_120ms_ease-out]"
      data-testid="dialog-host"
      onMouseDown={(e) => {
        // Click on backdrop = cancel
        if (e.target === e.currentTarget) {
          finish(kind === "confirm" ? false : null);
        }
      }}
    >
      <style>{`@keyframes dialogFade { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: translateY(0);} }`}</style>

      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden border border-gray-100"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        {/* Header — icon + title, plus a small close button */}
        <div className="flex items-start gap-4 px-6 pt-6 pb-4">
          <div
            className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${toneClasses.bg} ${toneClasses.fg} ring-4 ${toneClasses.ring}`}
            aria-hidden="true"
          >
            {iconNode}
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id="dialog-title"
              className="text-[15px] font-semibold text-gray-900 leading-6"
              data-testid="dialog-title"
            >
              {opts.title}
            </h3>
            {opts.message && (
              <p
                className="mt-1.5 text-sm text-gray-600 leading-relaxed whitespace-pre-line"
                data-testid="dialog-message"
              >
                {opts.message}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => finish(kind === "confirm" ? false : null)}
            className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
            aria-label="Close"
            data-testid="dialog-close-btn"
          >
            <X sx={{ fontSize: 16 }}/>
          </button>
        </div>

        {/* Prompt input body */}
        {kind === "prompt" && (
          <div className="px-6 pb-2 -mt-1">
            <input
              ref={inputRef}
              type={opts.inputType}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  finish(inputValue);
                }
              }}
              placeholder={opts.placeholder}
              className="w-full h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:border-[#ec9324] focus:ring-2 focus:ring-[#ec9324]/25"
              data-testid="dialog-prompt-input"
            />
          </div>
        )}

        {/* Footer — plain white, hairline separator, right-aligned actions */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          {kind !== "alert" && (
            <button
              type="button"
              onClick={() => finish(kind === "confirm" ? false : null)}
              className="h-9 px-4 text-sm font-medium rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-200"
              data-testid="dialog-cancel-btn"
            >
              {opts.cancelLabel || "Cancel"}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              finish(kind === "confirm" ? true : kind === "prompt" ? inputValue : undefined)
            }
            className={`h-9 px-4 text-sm font-semibold rounded-md focus:outline-none focus-visible:ring-4 ${confirmBtnClass}`}
            data-testid="dialog-confirm-btn"
            autoFocus={kind !== "prompt"}
          >
            {opts.confirmLabel || "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
