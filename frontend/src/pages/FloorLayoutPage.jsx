import React from "react";
import { LayoutGrid } from "lucide-react";

export default function FloorLayoutPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <LayoutGrid className="text-[#ec9324]" size={32} />
            <h1 className="text-3xl font-bold text-gray-900">Floor Layout</h1>
          </div>
          <p className="text-gray-600">
            Workspace floor layout management coming soon.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
              <LayoutGrid className="text-gray-400" size={32} />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Floor Layout Module
            </h2>
            <p className="text-gray-500 max-w-md mx-auto">
              This section will contain floor layout management features for workspace organization.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
