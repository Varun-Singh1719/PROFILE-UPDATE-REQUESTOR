import React, { useEffect, useState } from "react";
import api from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from "../components/ui/dialog";
import { toast } from "sonner";
import { Search, UserPlus } from "lucide-react";

function fmt(iso) { if (!iso) return "Never"; try { return new Date(iso).toLocaleString(); } catch { return iso; } }

export default function ContactListPage() {
  const [contacts, setContacts] = useState([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", phone: "", type: "DQ Team", password: "Test@123" });

  const load = async () => {
    const r = await api.get("/contacts", {
      params: { q: q || undefined, type: type === "all" ? undefined : type, status: status === "all" ? undefined : status }
    });
    setContacts(r.data);
  };
  useEffect(() => { load(); }, [q, type, status]);

  const toggleStatus = async (c) => {
    const next = c.status === "Active" ? "Inactive" : "Active";
    try {
      await api.patch(`/contacts/${c.id}`, { status: next });
      toast.success(`${c.name} is now ${next}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const createContact = async (e) => {
    e.preventDefault();
    try {
      await api.post("/contacts", form);
      toast.success("Contact created");
      setOpen(false); setForm({ email: "", name: "", phone: "", type: "DQ Team", password: "Test@123" });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <Layout>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Contact List</h1>
          <p className="text-gray-500 mt-1">Manage all users in the system.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="add-contact-btn">
              <UserPlus size={16} className="mr-2"/> Add Contact
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add New Contact</DialogTitle></DialogHeader>
            <form onSubmit={createContact} className="space-y-4">
              <div><Label>Email *</Label><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="contact-email"/></div>
              <div><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="contact-name"/></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="contact-phone"/></div>
              <div>
                <Label>Type *</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger data-testid="contact-type"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Admin">Admin</SelectItem>
                    <SelectItem value="Research Associate">Research Associate</SelectItem>
                    <SelectItem value="DQ Team">DQ Team</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Password *</Label><Input type="text" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="contact-password"/></div>
              <DialogFooter>
                <Button type="submit" className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="submit-contact-btn">Create</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mt-6 flex gap-3 flex-wrap items-center bg-white p-4 rounded-xl shadow-soft border border-gray-100">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
          <Input placeholder="Search name or email..." className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} data-testid="contact-search"/>
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Type"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="Admin">Admin</SelectItem>
            <SelectItem value="Research Associate">Research Associate</SelectItem>
            <SelectItem value="DQ Team">DQ Team</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-6 bg-white rounded-xl shadow-soft border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-left">Last Login</th>
                <th className="px-4 py-3 text-left">Active</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50/80" data-testid={`contact-row-${c.email}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">{c.email}</td>
                  <td className="px-4 py-3 text-gray-600">{c.phone || "-"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex text-xs font-semibold rounded-full px-2 py-1 bg-[#ec9324]/10 text-[#ec9324]">{c.type}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{fmt(c.created_on)}</td>
                  <td className="px-4 py-3 text-gray-500">{fmt(c.last_login)}</td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={c.status === "Active"}
                      onCheckedChange={() => toggleStatus(c)}
                      data-testid={`toggle-${c.email}`}
                    />
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-gray-400">No contacts</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
