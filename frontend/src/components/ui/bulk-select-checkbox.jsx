import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cn } from "@/lib/utils";

/**
 * BulkSelectCheckbox — the circle-style selector used across every list /
 * card that supports bulk actions (Pending Approvals, All Requests, Contacts,
 * Bookings, …).
 *
 * Visuals:
 *   • Unchecked → thin gray ring, white background, empty inside
 *   • Checked   → thick orange ring, white gap, orange filled dot inside
 *
 * Behaviourally it's still a Radix checkbox (multi-select, keyboard a11y,
 * aria state) — we only change the paint.
 */
const BulkSelectCheckbox = React.forwardRef(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer relative inline-flex items-center justify-center h-5 w-5 shrink-0",
      "rounded-full border-2 border-gray-300 bg-white shadow-sm transition-colors",
      "hover:border-gray-400",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec9324]/40",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:border-[#ec9324]",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      <span className="block h-2.5 w-2.5 rounded-full bg-[#ec9324]" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
BulkSelectCheckbox.displayName = "BulkSelectCheckbox";

export { BulkSelectCheckbox };
