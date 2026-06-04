import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

/**
 * Breadcrumb — pass an array of crumbs: [{label, to?}].
 * The last crumb is rendered as the current page (no link).
 */
export default function Breadcrumbs({ items = [], className = "" }) {
  if (!items.length) return null;
  return (
    <nav data-testid="breadcrumbs" aria-label="Breadcrumb" className={`flex items-center text-sm text-gray-500 ${className}`}>
      <Link to="/admin" className="hover:text-[#ec9324] flex items-center" data-testid="breadcrumb-home">
        <Home size={13}/>
      </Link>
      {items.map((c, i) => (
        <React.Fragment key={`${c.label}-${i}`}>
          <ChevronRight size={13} className="mx-1.5 text-gray-300"/>
          {c.to && i < items.length - 1 ? (
            <Link to={c.to} className="hover:text-[#ec9324]" data-testid={`breadcrumb-${c.label.toLowerCase().replace(/\s+/g, "-")}`}>{c.label}</Link>
          ) : (
            <span className="text-gray-900 font-semibold" data-testid={`breadcrumb-current`}>{c.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
