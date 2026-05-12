import React from "react";
import Sidebar from "./Sidebar";
import { Toaster } from "../components/ui/sonner";

export default function Layout({ children }) {
  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar />
      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-[1400px] mx-auto px-8 py-8">{children}</div>
      </main>
      <Toaster position="top-right" richColors />
    </div>
  );
}
