import React from "react";

/**
 * FloatingField — renders a form control with its header/label "notched" onto
 * the control's top border (Material-UI outlined style). The label stays
 * visible whether the field is blank or filled.
 *
 * The child control is expected to render its own bordered box (Input,
 * Textarea, SearchSelect, ISDPicker, etc.). The label punches through that
 * border using a solid background (`labelBg`), so pass a matching background
 * when the field sits on a non-white surface (e.g. "bg-gray-50").
 *
 * Props:
 *   label    – header text or node (may include a required "*" marker)
 *   htmlFor  – optional id of the control, for label association
 *   labelBg  – tailwind bg class behind the label notch (default "bg-white")
 *   className– extra classes for the relative wrapper
 */
export function FloatingField({ label, htmlFor, labelBg = "bg-white", className = "", children }) {
  return (
    <div className={`relative ${className}`}>
      {label != null && label !== "" && (
        <label
          htmlFor={htmlFor}
          className={`absolute -top-2 left-3 px-1.5 ${labelBg} text-[11px] font-medium text-gray-500 leading-none z-10 pointer-events-none`}
        >
          {label}
        </label>
      )}
      {children}
    </div>
  );
}

export default FloatingField;
