/**
 * Local copy of MUI's `@mui/icons-material/EventSeatRounded` icon, rendered
 * as an inline SVG so we don't pull the entire MUI runtime into the bundle.
 *
 * Path data is the verbatim SVG that ships with MUI v5's Rounded variant.
 * Used for the "Request Workstation" sidebar entry per UX request.
 */
import React from "react";

const EventSeatRoundedIcon = ({ size = 18, color = "currentColor", className = "", ...rest }) => (
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
    <path d="M4 18v2c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h10v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-2H4zM19 10h-1V6c0-1.66-1.34-3-3-3H9C7.34 3 6 4.34 6 6v4H5c-1.66 0-3 1.34-3 3v3c0 .55.45 1 1 1h18c.55 0 1-.45 1-1v-3c0-1.66-1.34-3-3-3zM8 6c0-.55.45-1 1-1h6c.55 0 1 .45 1 1v4H8V6z" />
  </svg>
);

export default EventSeatRoundedIcon;
