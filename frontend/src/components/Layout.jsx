import React, { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import Breadcrumbs from "./Breadcrumbs";

/**
 * Layout — global app shell.
 *
 * Props:
 *   title?: string                  — page title rendered in the sticky top bar
 *   actions?: ReactNode             — action buttons rendered in the top bar, just before the user dropdown
 *   breadcrumbs?: [{label, to?}]    — shown at top of content area
 *   fullBleed?: bool                — remove the centered max-w wrapper (for canvas-heavy pages)
 *   contentClassName?: string       — escape hatch for full-screen pages
 *   hideTopBar?: bool               — for screens that need a full-height canvas
 *
 * The Sidebar is fixed-position; we add a left margin equal to its current width
 * so the content never gets covered. We detect sidebar width via a CSS attribute
 * that the Sidebar component sets (data-collapsed).
 */
export default function Layout({
  children,
  title,
  actions,
  breadcrumbs,
  fullBleed = false,
  contentClassName = "",
  hideTopBar = false,
}) {
  const [sidebarOffset, setSidebarOffset] = useState(0);

  useEffect(() => {
    const update = () => {
      // Mobile: sidebar is a drawer overlay (no offset)
      if (window.innerWidth < 768) { setSidebarOffset(0); return; }
      const el = document.querySelector('[data-testid="sidebar"]');
      if (!el) { setSidebarOffset(64); return; }
      setSidebarOffset(el.getAttribute("data-collapsed") === "true" ? 64 : 256);
    };
    update();
    // Watch for collapse changes via attribute mutations
    const observer = new MutationObserver(update);
    const el = document.querySelector('[data-testid="sidebar"]');
    if (el) observer.observe(el, { attributes: true, attributeFilter: ["data-collapsed"] });
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <Sidebar />
      <main
        className="flex-1 overflow-x-hidden transition-[margin] duration-200"
        style={{ marginLeft: sidebarOffset }}
      >
        {!hideTopBar && <TopBar title={title} actions={actions} />}
        {fullBleed ? (
          <div className={contentClassName}>
            {breadcrumbs && (
              <div className="px-4 py-2 border-b border-gray-100 bg-white">
                <Breadcrumbs items={breadcrumbs}/>
              </div>
            )}
            {children}
          </div>
        ) : (
          <div className={contentClassName || "w-full px-4 pt-4 pb-3 flex flex-col min-h-[calc(100vh-56px)]"}>
            {breadcrumbs && <Breadcrumbs items={breadcrumbs} className="mb-3"/>}
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
