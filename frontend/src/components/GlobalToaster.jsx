import React from "react";
import { Toaster } from "sonner";
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";

/**
 * GlobalToaster — single mount point for all sonner toasts.
 *
 *   • Positioned bottom-left across the app.
 *   • Orange-on-white card with a coloured left accent strip — matches the
 *     "New Request" primary button design language.
 *   • Includes a manual close button.
 *   • Auto-dismiss (success ~3.5s, error ~6s — set per-call in lib/notify.js).
 *   • Smooth slide-in animation provided by sonner.
 *
 * Use the `notify` helper from `lib/notify.js` for all app toasts.
 */
export default function GlobalToaster() {
  return (
    <Toaster
      position="bottom-left"
      closeButton
      expand={false}
      offset={20}
      gap={10}
      visibleToasts={5}
      icons={{
        success: <CheckCircle2 size={18} className="text-[#ec9324]" />,
        error: <AlertCircle size={18} className="text-red-500" />,
        warning: <AlertTriangle size={18} className="text-amber-500" />,
        info: <Info size={18} className="text-blue-500" />,
      }}
      toastOptions={{
        duration: 4000,
        unstyled: false,
        classNames: {
          toast:
            "!bg-white !text-gray-900 !border-l-4 !border-[#ec9324] !shadow-2xl !rounded-xl !px-4 !py-3 !min-h-0",
          title: "!font-semibold !text-gray-900 !text-sm",
          description: "!text-gray-600 !text-xs !mt-0.5 !whitespace-pre-line",
          actionButton:
            "!bg-[#ec9324] !text-white !rounded-md !px-3 !py-1 !text-xs !font-medium hover:!bg-[#d8851f]",
          cancelButton: "!bg-gray-100 !text-gray-700 !rounded-md !px-3 !py-1 !text-xs",
          closeButton:
            "!bg-white !border !border-gray-200 !text-gray-500 hover:!bg-gray-100 !left-auto !right-2 !top-2",
          success: "!border-[#ec9324]",
          error: "!border-red-500",
          warning: "!border-amber-500",
          info: "!border-blue-500",
        },
      }}
    />
  );
}
