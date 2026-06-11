/**
 * Local copy of MUI's `@mui/icons-material/AddTask` icon, rendered as an inline
 * SVG so we don't pull the entire MUI runtime (@mui/material + emotion) into
 * the bundle just for one icon.
 *
 * Path data is the verbatim SVG that ships with MUI v5 — used for the
 * "Pending Approvals" sidebar entry per UX request.
 */
import React from "react";

const AddTaskIcon = ({ size = 18, color = "currentColor", className = "", ...rest }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill={color}
    className={className}
    aria-hidden="true"
    {...rest}
  >
    <path d="M22 5.18 10.59 16.6l-4.24-4.24 1.41-1.41 2.83 2.83 10-10L22 5.18zM12 20c-4.41 0-8-3.59-8-8s3.59-8 8-8c1.57 0 3.04.46 4.28 1.25l1.45-1.45C16.1 2.67 14.13 2 12 2 6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10h-2c0 4.41-3.59 8-8 8z" />
  </svg>
);

export default AddTaskIcon;
