import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

/**
 * Default landing route for section/parent labels. Used when a breadcrumb item is
 * passed in without an explicit `to` field — keeps crumbs clickable app-wide.
 * Add new section labels here as the app grows.
 */
const DEFAULT_SECTION_ROUTES = {
  "Dashboard": "/admin",
  "Workspace Manager": "/workspace-manager/floor-layout",
  "Floor Layout": "/workspace-manager/floor-layout",
  "Floor Calibration": "/workspace-manager/floor-plans",
  "Floor Plans": "/workspace-manager/floor-plans",
  "Bookings": "/workspace-manager/bookings",
  "Meeting Room Booking": "/workspace-manager/meeting-room-booking",
  "Manage": "/admin/teams",
  "Teams": "/admin/teams",
  "Permissions": "/admin/permissions",
  "Email Templates": "/admin/email-templates",
  "Notifications": "/admin/notifications",
  "Employee List": "/admin/contacts",
  "Tickets": "/admin/open-tickets",
  "Open Requests": "/admin/open-tickets",
  "All Requests": "/admin/open-tickets",
  "Unassigned": "/admin/unassigned",
};

/**
 * Breadcrumb — pass an array of crumbs: [{label, to?}].
 * The last crumb is always rendered as the current page (no link). Intermediate
 * crumbs become links to their `to` value, falling back to DEFAULT_SECTION_ROUTES.
 */
export default function Breadcrumbs({ items = [], className = "" }) {
  if (!items.length) return null;
  return (
    <nav data-testid="breadcrumbs" aria-label="Breadcrumb" className={`flex items-center text-sm text-gray-500 ${className}`}>
      <Link to="/admin" className="hover:text-[#ec9324] flex items-center" data-testid="breadcrumb-home" aria-label="Home">
        <Home size={13}/>
      </Link>
      {items.map((c, i) => {
        const isLast = i === items.length - 1;
        const target = c.to || DEFAULT_SECTION_ROUTES[c.label];
        const slug = `breadcrumb-${c.label.toLowerCase().replace(/\s+/g, "-")}`;
        return (
          <React.Fragment key={`${c.label}-${i}`}>
            <ChevronRight size={13} className="mx-1.5 text-gray-300"/>
            {!isLast && target ? (
              <Link
                to={target}
                className="hover:text-[#ec9324] hover:underline underline-offset-2 transition-colors"
                data-testid={slug}
              >{c.label}</Link>
            ) : (
              <span
                className={isLast ? "text-gray-900 font-semibold" : "text-gray-500"}
                data-testid={isLast ? "breadcrumb-current" : slug}
              >{c.label}</span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
