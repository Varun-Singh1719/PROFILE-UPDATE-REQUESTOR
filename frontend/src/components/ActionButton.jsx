import React from "react";
import { Loader2 } from "lucide-react";
import { useAction } from "../hooks/useAction";

/**
 * ActionButton — primary action button with built-in async handling.
 *
 *   <ActionButton
 *     onClick={async () => api.post(...)}
 *     what="Save Permission Set"
 *     successMessage="Saved"
 *     icon={Save}
 *     variant="primary"
 *   >
 *     Save Changes
 *   </ActionButton>
 *
 * The button auto-disables and shows an inline spinner while the click handler's
 * promise is pending; the global BusyOverlay handles screen-wide freeze.
 */

const VARIANTS = {
  primary: "bg-[#ec9324] text-white hover:bg-[#d8851f] focus:ring-[#ec9324]/40",
  danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-300",
  secondary: "bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 focus:ring-gray-300",
  ghost: "text-gray-700 hover:bg-gray-100 focus:ring-gray-200",
  outline: "bg-white text-[#ec9324] border border-[#ec9324]/40 hover:bg-[#ec9324]/5 focus:ring-[#ec9324]/40",
};

const SIZES = {
  xs: "px-2.5 py-1 text-xs",
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-base",
};

export default function ActionButton({
  children,
  onClick,
  variant = "primary",
  size = "md",
  className = "",
  disabled = false,
  icon: Icon,
  loadingText,
  successMessage,
  successDescription,
  what,
  onError,
  onSuccess,
  type = "button",
  fullWidth = false,
  "data-testid": testId,
  ...rest
}) {
  const { run, loading } = useAction(
    onClick || (() => Promise.resolve()),
    { what, successMessage, successDescription, onError, onSuccess }
  );

  const isDisabled = disabled || loading;
  const base = "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2";
  const iconSize = size === "xs" || size === "sm" ? 12 : 14;

  return (
    <button
      type={type}
      {...rest}
      data-testid={testId}
      disabled={isDisabled}
      onClick={(e) => {
        if (isDisabled) return;
        // Don't pass the synthetic event to the handler (avoid serialization concerns);
        // pass any extra args via the click invocation if needed.
        run(e);
      }}
      className={`${base} ${SIZES[size]} ${VARIANTS[variant] || VARIANTS.primary} ${fullWidth ? "w-full" : ""} ${className}`}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" size={iconSize} />
          <span>{loadingText || "Processing…"}</span>
        </>
      ) : (
        <>
          {Icon && <Icon size={iconSize} />}
          {children}
        </>
      )}
    </button>
  );
}
