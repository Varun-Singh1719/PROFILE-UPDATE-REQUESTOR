/**
 * Local inline-SVG copy of MUI's `@mui/icons-material/Workspaces` (filled).
 * Kept as a component to avoid pulling the whole `@mui/material` runtime.
 * Path data is the verbatim SVG that ships with MUI v5.
 */
import React from "react";

const WorkspacesIcon = ({ size = 14, color = "currentColor", className = "", ...rest }) => (
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
    <circle cx="6" cy="9" r="4"/>
    <circle cx="18" cy="9" r="4"/>
    <circle cx="12" cy="18" r="4"/>
  </svg>
);

export default WorkspacesIcon;
