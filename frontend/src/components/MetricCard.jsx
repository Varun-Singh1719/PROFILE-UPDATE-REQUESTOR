import React from "react";

export default function MetricCard({ label, value, color = "#ec9324", icon: Icon, onClick, active }) {
  return (
    <button
      onClick={onClick}
      data-testid={`metric-card-${label.toLowerCase().replace(/\s/g, "-")}`}
      className={`text-left bg-white rounded-xl p-6 border transition-all duration-200 shadow-soft hover:shadow-soft-hover ${
        active ? "border-[#ec9324]" : "border-gray-100"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</div>
          <div className="mt-3 text-4xl font-bold text-gray-900 tracking-tight">{value ?? 0}</div>
        </div>
        {Icon && (
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}1a`, color }}>
            <Icon size={20} />
          </div>
        )}
      </div>
    </button>
  );
}
