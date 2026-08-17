import React, { useEffect, useState } from "react";
import { Input } from "./ui/input";
import Search from "@mui/icons-material/SearchOutlined";
import SendIcon from "@mui/icons-material/Send";
import X from "@mui/icons-material/Close";

/**
 * DeferredSearchInput
 * -------------------
 * A search text field that does NOT fire on every keystroke. It only commits
 * a new search value when:
 *   • the user presses Enter, or
 *   • the user clicks the trailing "Search Arrow" button.
 *
 * Props:
 *   value              — currently committed value (from parent)
 *   onCommit(next)     — called with the new committed value on Enter / click
 *   placeholder?       — input placeholder
 *   testId?            — data-testid for the input; the button gets `${testId}-btn`
 *   className?         — outer wrapper classes
 *   inputClassName?    — extra classes on the <input>
 *   showLeftIcon?      — default true, hides the magnifier icon on the left
 *   numericOnly?       — if true, strips non-digits from input
 *   ariaLabel?         — a11y label for the input
 *
 * The component is fully controlled from OUTSIDE for the *committed* value,
 * but keeps a small local buffer for the "in-progress" typed text so that
 * parent re-renders are not triggered on each keystroke.
 */
export default function DeferredSearchInput({
  value = "",
  onCommit,
  placeholder = "Search...",
  testId,
  className = "",
  inputClassName = "",
  showLeftIcon = true,
  numericOnly = false,
  ariaLabel,
  disabled = false,
}) {
  // Local buffer for the text the user is currently typing.
  const [buffer, setBuffer] = useState(value ?? "");

  // Keep buffer in sync when the parent-committed value changes externally
  // (e.g. "Clear all" resets it, or a URL-driven change flips it).
  useEffect(() => { setBuffer(value ?? ""); }, [value]);

  const commit = () => {
    if (disabled) return;
    const next = (buffer ?? "").trim();
    if ((value ?? "") === next) return;   // no-op if unchanged
    onCommit?.(next);
  };

  const handleChange = (e) => {
    let v = e.target.value;
    if (numericOnly) v = v.replace(/[^0-9]/g, "");
    setBuffer(v);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  };

  // Clear ONLY this field: wipe the local buffer and clear the committed value
  // so the applied filter for this box is removed (other filters untouched).
  const clear = () => {
    if (disabled) return;
    setBuffer("");
    if ((value ?? "") !== "") onCommit?.("");
  };

  // Show the clear (✕) affordance only when there is text in the box.
  const showClear = !disabled && (buffer ?? "").length > 0;

  return (
    <div className={`relative ${className} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
      {showLeftIcon && (
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" sx={{ fontSize: 16 }}/>
      )}
      <Input
        placeholder={placeholder}
        data-testid={testId}
        aria-label={ariaLabel || placeholder}
        disabled={disabled}
        className={`${showLeftIcon ? "pl-9" : "pl-3"} ${showClear ? "pr-16" : "pr-9"} h-9 ${inputClassName} disabled:cursor-not-allowed`}
        value={buffer}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        inputMode={numericOnly ? "numeric" : undefined}
      />
      {showClear && (
        <button
          type="button"
          onClick={clear}
          data-testid={testId ? `${testId}-clear` : undefined}
          aria-label="Clear search"
          title="Clear"
          className="absolute right-9 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700"
        >
          <X sx={{ fontSize: 14 }}/>
        </button>
      )}
      <button
        type="button"
        onClick={commit}
        disabled={disabled}
        data-testid={testId ? `${testId}-btn` : undefined}
        aria-label="Search"
        title="Search"
        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-gray-100 hover:bg-gray-200 active:bg-gray-300 flex items-center justify-center text-gray-600 disabled:cursor-not-allowed disabled:hover:bg-gray-100"
      >
        <SendIcon sx={{ fontSize: 14 }}/>
      </button>
    </div>
  );
}
