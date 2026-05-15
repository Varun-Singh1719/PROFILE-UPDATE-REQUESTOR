import React from "react";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Armchair, MapPin, CalendarCheck, Users, Sparkles, ArrowRight } from "lucide-react";

const FEATURES = [
  {
    icon: CalendarCheck,
    title: "Seat Requests",
    description: "Request a desk for any day or recurring slot. Track approvals in real-time.",
    color: "#3b82f6",
  },
  {
    icon: Users,
    title: "Team Allocations",
    description: "Managers can request seats for the entire team in one go. HR can approve in bulk.",
    color: "#a855f7",
  },
  {
    icon: MapPin,
    title: "Interactive Floor Plan",
    description: "Visualize zones, hot desks, fixed seats and live occupancy on the floor map.",
    color: "#22c55e",
  },
];

export default function DeskBookingPage() {
  return (
    <Layout>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <Armchair className="text-blue-500" size={28}/> Desk Booking
          </h1>
          <p className="text-gray-500 mt-1">Smart seat allocation for hybrid teams.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 text-xs font-semibold">
          <Sparkles size={12}/> Coming Soon
        </span>
      </div>

      <div className="mt-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-8 text-white relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full bg-white/10"></div>
        <div className="absolute -right-8 -bottom-16 w-72 h-72 rounded-full bg-white/5"></div>
        <div className="relative">
          <h2 className="text-2xl font-bold">Book your spot in seconds.</h2>
          <p className="mt-2 text-white/85 max-w-xl">
            A modern desk-booking experience designed for distributed and hybrid teams. Find your team, book a zone, and check in — all from one place.
          </p>
          <Button disabled className="mt-5 bg-white text-blue-700 hover:bg-white/90 font-semibold cursor-not-allowed">
            Request Early Access <ArrowRight size={14} className="ml-1.5"/>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-8">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="bg-white rounded-xl border border-gray-100 shadow-soft p-6 hover:shadow-soft-hover transition-shadow">
              <div
                className="w-11 h-11 rounded-lg flex items-center justify-center mb-4"
                style={{ backgroundColor: `${f.color}15`, color: f.color }}
              >
                <Icon size={22}/>
              </div>
              <div className="font-bold text-gray-900">{f.title}</div>
              <div className="text-sm text-gray-600 mt-2 leading-relaxed">{f.description}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-10 bg-white rounded-xl border border-gray-100 shadow-soft p-6">
        <h3 className="font-bold text-gray-900">What you'll be able to do</h3>
        <ul className="mt-4 space-y-3 text-sm text-gray-700">
          <li className="flex gap-3"><span className="text-blue-500 font-bold">•</span> <span><strong>Staff:</strong> request a desk for yourself, switch zones, cancel anytime.</span></li>
          <li className="flex gap-3"><span className="text-purple-500 font-bold">•</span> <span><strong>Managers:</strong> raise team requests, see the team's booking calendar.</span></li>
          <li className="flex gap-3"><span className="text-green-500 font-bold">•</span> <span><strong>HR:</strong> allocate seats, approve requests, manage zones and floor plans.</span></li>
        </ul>
        <p className="text-xs text-gray-500 mt-5">
          Permissions for Desk Booking can already be configured today from <strong>Admin → Manage → Permissions</strong>. Rules will start applying when the module goes live.
        </p>
      </div>
    </Layout>
  );
}
