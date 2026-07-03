/**
 * Local inline-SVG copy of MUI's `@mui/icons-material/Person` (filled).
 * Kept as a component to avoid pulling the whole `@mui/material` runtime.
 * Path data is the verbatim SVG that ships with MUI v5.
 */
import React from "react";

const PersonIcon = ({ size = 14, color = "currentColor", className = "", ...rest }) => (
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
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
  </svg>
);

export default PersonIcon;
