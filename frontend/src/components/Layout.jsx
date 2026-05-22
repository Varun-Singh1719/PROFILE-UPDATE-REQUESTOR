import React from "react";
import Sidebar from "./Sidebar";

/**
 * Layout — admin shell. The global Toaster + BusyOverlay live at the App level
 * (see App.js) so they cover both authed and pre-auth screens.
 */
export default function Layout({ children }) {
  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar />
      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-[1400px] mx-auto px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
