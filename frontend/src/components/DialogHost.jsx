/**
 * DialogHost — single mount point that renders confirm / prompt / alert
 * dialogs emitted by the `/lib/dialog.js` event bus.
 *
 * Mount once at the app root (inside <GlobalToaster>) so any module can
 * call `await confirm({...})` from anywhere.
 */
import React, { useEffect, useState, useRef } from "react";
import { _subscribe, _resolve } from "../lib/dialog";

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
  const isDestructive = opts.confirmVariant === "destructive";
  const confirmBtnClass = isDestructive
    ? "bg-red-600 hover:bg-red-700 text-white"
    : "bg-[#ec9324] hover:bg-[#d4811f] text-white";

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      data-testid="dialog-host"
      onMouseDown={(e) => {
        // Click on backdrop = cancel
        if (e.target === e.currentTarget) {
          finish(kind === "confirm" ? false : null);
        }
      }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="px-5 pt-5 pb-2">
          <h3 id="dialog-title" className="text-base font-semibold text-gray-900">
            {opts.title}
          </h3>
        </div>
        {opts.message && (
          <div className="px-5 pb-3 text-sm text-gray-700 whitespace-pre-line">
            {opts.message}
          </div>
        )}
        {kind === "prompt" && (
          <div className="px-5 pb-3">
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
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-[#ec9324] focus:ring-1 focus:ring-[#ec9324]"
              data-testid="dialog-prompt-input"
            />
          </div>
        )}
        <div className="px-5 py-3 bg-gray-50 rounded-b-xl flex items-center justify-end gap-2 border-t border-gray-100">
          {kind !== "alert" && (
            <button
              type="button"
              onClick={() => finish(kind === "confirm" ? false : null)}
              className="px-4 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
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
            className={`px-4 py-2 text-sm font-medium rounded-md ${confirmBtnClass}`}
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
