import React from "react";
import Check from "@mui/icons-material/Check";

/**
 * OrangeCheckbox — always-orange box with white tick, browser-independent.
 *
 * Props:
 *  - checked:   boolean
 *  - onChange:  (checked: boolean) => void
 *  - disabled?: boolean
 *  - size?:     number (px, default 16)
 *  - testId?:   string
 *  - ariaLabel?: string
 *  - className?: string (applied to outer label)
 */
export default function OrangeCheckbox({
  checked = false,
  onChange,
  disabled = false,
  size = 16,
  testId,
  ariaLabel,
  className = "",
}) {
  return (
    <label
      className={`relative inline-flex items-center justify-center cursor-pointer select-none ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      } ${className}`}
      style={{ width: size, height: size }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        data-testid={testId}
        aria-label={ariaLabel}
        className="sr-only peer"
      />
      <span
        aria-hidden="true"
        className={`inline-flex items-center justify-center rounded-[3px] border transition-colors ${
          checked
            ? "bg-[#ec9324] border-[#ec9324]"
            : "bg-white border-gray-300 peer-hover:border-gray-400"
        } peer-focus-visible:ring-2 peer-focus-visible:ring-[#ec9324]/40`}
        style={{ width: size, height: size }}
      >
        {checked && (
          <Check size={Math.max(10, size - 4)} className="text-white"/>
        )}
      </span>
    </label>
  );
}
