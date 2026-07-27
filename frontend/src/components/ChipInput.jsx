import React, { useEffect, useRef, useState } from "react";
import SendIcon from "@mui/icons-material/Send";
import X from "@mui/icons-material/Close";

/**
 * ChipInput
 * ---------
 * A chip / token input where the user can type or paste multiple values
 * separated by commas (or newlines). Each value becomes a removable chip.
 *
 * • Types / pastes "A, B,C"  → chips [A][B][C]
 * • Enter or the trailing Search button  → commits the array to parent via
 *   `onCommit(chips)`. Removing a chip via the ✕ button is *also* an
 *   immediate commit (so the results update as chips are dropped).
 * • Typing a "," or Tab absorbs the current buffer as a chip *without*
 *   triggering a parent commit — keeping the "search only on Enter"
 *   contract for adding new chips.
 * • Backspace on an empty buffer pops the last chip (no commit — the user
 *   still needs Enter to run the search).
 * • Trim whitespace, drop blank tokens, prevent duplicates, preserve order.
 *
 * Props:
 *   value             — string[] currently committed (from parent)
 *   onCommit(chips)   — called with the new array on Enter / click / remove
 *   placeholder?      — shown only when there are no chips
 *   testId?           — data-testid for the input; chips get `${testId}-chip-<value>`
 *   className?        — outer wrapper classes
 *   ariaLabel?        — a11y label for the input
 *   transform?        — optional (v: string) => string normalizer (e.g. toLowerCase)
 */
export default function ChipInput({
  value = [],
  onCommit,
  placeholder = "",
  testId,
  className = "",
  ariaLabel,
  transform,
}) {
  const [chips, setChips] = useState(Array.isArray(value) ? value : []);
  const [buffer, setBuffer] = useState("");
  const inputRef = useRef(null);

  // Keep local chips in sync when the parent-committed value changes
  // externally (e.g. "Clear filters" from the toolbar).
  useEffect(() => {
    setChips(Array.isArray(value) ? value : []);
  }, [value]);

  const parseTokens = (text) => {
    if (!text) return [];
    return text
      .split(/[,\n]+/)
      .map((p) => (p || "").trim())
      .map((p) => (transform ? transform(p) : p))
      .filter(Boolean);
  };

  const mergeChips = (existing, tokens) => {
    const merged = [...existing];
    for (const t of tokens) {
      if (!merged.includes(t)) merged.push(t);
    }
    return merged;
  };

  const arraysEqual = (a, b) => {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  const commit = () => {
    // Consume buffer as new chips (if any) and push the final list to parent.
    const tokens = parseTokens(buffer);
    const next = tokens.length ? mergeChips(chips, tokens) : chips;
    setChips(next);
    setBuffer("");
    if (!arraysEqual(next, value || [])) {
      onCommit?.(next);
    }
  };

  const absorbBuffer = () => {
    // Convert the current buffer into chips without triggering a parent
    // commit — used when the user types a comma to separate values while
    // still typing more.
    const tokens = parseTokens(buffer);
    if (tokens.length === 0) return;
    setChips((prev) => mergeChips(prev, tokens));
    setBuffer("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === ",") {
      if (buffer.trim()) {
        e.preventDefault();
        absorbBuffer();
      }
    } else if (e.key === "Tab" && buffer.trim()) {
      // Absorb without swallowing focus movement
      absorbBuffer();
    } else if (e.key === "Backspace" && !buffer && chips.length > 0) {
      // Pop the last chip locally; parent stays until Enter/Search click
      setChips((prev) => prev.slice(0, -1));
    }
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData("text");
    if (/[,\n]/.test(pasted)) {
      e.preventDefault();
      const tokens = parseTokens(pasted);
      if (tokens.length) {
        setChips((prev) => mergeChips(prev, tokens));
        setBuffer("");
      }
    }
  };

  const removeChip = (v) => {
    const next = chips.filter((c) => c !== v);
    setChips(next);
    // Removing a chip IS a commit — results should immediately reflect the
    // narrower filter.
    if (!arraysEqual(next, value || [])) {
      onCommit?.(next);
    }
  };

  const focusInput = () => inputRef.current?.focus();

  const chipId = (v) =>
    testId ? `${testId}-chip-${String(v).replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined;

  return (
    <div className={`relative ${className}`}>
      <div
        onClick={focusInput}
        data-testid={testId ? `${testId}-container` : undefined}
        className="min-h-9 flex flex-wrap items-center gap-1.5 rounded-md border border-gray-300 bg-white pl-2 pr-10 py-1 cursor-text transition-colors focus-within:border-[#ec9324] focus-within:ring-2 focus-within:ring-[#ec9324]/25"
      >
        {chips.map((c) => (
          <span
            key={c}
            data-testid={chipId(c)}
            className="inline-flex items-center gap-1 rounded-md bg-gray-100 border border-gray-200 pl-2 pr-1 py-0.5 text-[12px] text-gray-700 leading-none"
          >
            <span className="max-w-[220px] truncate">{c}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeChip(c);
              }}
              className="rounded-full hover:bg-gray-200 p-0.5 text-gray-500 hover:text-gray-700"
              aria-label={`Remove ${c}`}
              data-testid={testId ? `${testId}-chip-remove-${String(c).replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined}
            >
              <X sx={{ fontSize: 12 }} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={buffer}
          onChange={(e) => setBuffer(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => {
            // Auto-absorb whatever the user typed on blur (no parent commit)
            if (buffer.trim()) absorbBuffer();
          }}
          placeholder={chips.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm h-7 px-1 placeholder:text-gray-400"
          data-testid={testId}
          aria-label={ariaLabel || placeholder}
        />
      </div>
      <button
        type="button"
        onClick={commit}
        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-gray-100 hover:bg-gray-200 active:bg-gray-300 flex items-center justify-center text-gray-600"
        aria-label="Search"
        title="Search"
        data-testid={testId ? `${testId}-btn` : undefined}
      >
        <SendIcon sx={{ fontSize: 14 }} />
      </button>
    </div>
  );
}
