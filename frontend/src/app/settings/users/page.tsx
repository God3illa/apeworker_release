"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../AuthProvider";
import {
  UserPlus,
  Pencil,
  Trash2,
  X,
  Loader2,
  Mail,
  Send,
} from "lucide-react";

interface User {
  id: number;
  clerk_user_id: string;
  email: string;
  name: string;
  role_name: string;
  role_id: number;
  status: string;
  created_at: string;
}

interface Role {
  id: number;
  name: string;
}

export default function UsersSettings() {
  const { getToken } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite modal form
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState("");

  // Edit role states
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editRoleId, setEditRoleId] = useState("");
  const [editStatus, setEditStatus] = useState("");

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const loadData = async () => {
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };

      const [resUsers, resRoles] = await Promise.all([
        fetch(`${API_URL}/api/users`, { headers }).then(r => r.ok ? r.json() : []),
        fetch(`${API_URL}/api/roles`, { headers }).then(r => r.ok ? r.json() : []),
      ]);

      setUsers(resUsers);
      setRoles(resRoles);
      if (resRoles && resRoles.length > 0) {
        setInviteRoleId(resRoles[resRoles.length - 1].id.toString());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleEditClick = (user: User) => {
    setEditingUser(user);
    setEditRoleId(user.role_id?.toString() || "");
    setEditStatus(user.status);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/users/${editingUser.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          role_id: parseInt(editRoleId),
          status: editStatus
        })
      });

      if (res.ok) {
        setEditingUser(null);
        loadData();
      }
    } catch (e) {
      console.error("Error updating user settings", e);
    }
  };

  const handleDeleteUser = async (id: number) => {
    if (!confirm("Are you sure you want to delete this user from the workspace database?")) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setUsers(users.filter(u => u.id !== id));
      }
    } catch (e) {
      console.error("Error deleting user", e);
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteRoleId) return;

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/users/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          email: inviteEmail,
          name: inviteName || null,
          role_id: parseInt(inviteRoleId)
        })
      });

      if (res.ok) {
        alert(`User profile successfully pre-created and invited! Direct them to sign up with: ${inviteEmail}`);
        setIsInviteOpen(false);
        setInviteEmail("");
        setInviteName("");
        loadData();
      } else {
        const err = await res.json();
        alert(err.detail || "Failed to dispatch workspace invitation");
      }
    } catch (err) {
      console.error("Error creating invitation", err);
      alert("Network error. Failed to create invitation.");
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-extrabold text-lime-400">
            Workspace Users
          </h1>
          <p className="text-zinc-400 mt-1">Audit team members, assign workspace roles, and dispatch invitations.</p>
        </div>
        <button
          onClick={() => setIsInviteOpen(true)}
          className="px-5 py-2.5 rounded-xl font-bold bg-lime-400 hover:bg-lime-500 transition shadow-lg shadow-lime-950/20 text-zinc-950 flex items-center gap-2 text-sm cursor-pointer"
        >
          <UserPlus className="w-4 h-4 text-zinc-950" /> Invite User
        </button>
      </div>

      {/* Users table */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800">
          <h3 className="text-lg font-bold text-zinc-100">Team Roster</h3>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-zinc-500 font-semibold flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading team roster...
            </div>
          ) : users.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              No users registered. Clerk sessions will auto-provision user profiles on call!
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-950/40 text-xs font-bold uppercase text-zinc-400 border-b border-zinc-800">
                  <th className="p-4 pl-6">Full Name</th>
                  <th className="p-4">Email Address</th>
                  <th className="p-4">Clerk User Context</th>
                  <th className="p-4">Workspace Role</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Created At</th>
                  <th className="p-4 pr-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-zinc-900/20 transition-all">
                    <td className="p-4 pl-6 font-bold text-white text-sm">{user.name || "ApeWorker"}</td>
                    <td className="p-4 text-zinc-300 text-sm font-semibold">{user.email}</td>
                    <td className="p-4 font-mono text-[10px] text-zinc-500">{user.clerk_user_id}</td>
                    <td className="p-4">
                      <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-lime-400/10 border border-lime-400/20 text-lime-400">
                        {user.role_name}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                        user.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-400"
                      }`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="p-4 text-xs text-zinc-500">{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="p-4 pr-6 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => handleEditClick(user)}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Pencil className="w-3 h-3" /> Edit Role
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/60 text-rose-400 transition text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Edit Role Modal Dialog */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-md p-6 rounded-3xl relative shadow-2xl animate-scale-up border border-zinc-800 bg-[#121218]/95">
            <button
              onClick={() => setEditingUser(null)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-white mb-2">Edit Workspace Status</h3>
            <p className="text-xs text-zinc-400 mb-6">Modify workspace roles or deactivate users.</p>

            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-xs uppercase font-bold text-zinc-400 tracking-wider mb-2">Assign Role</label>
                <select
                  value={editRoleId}
                  onChange={(e) => setEditRoleId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#1e1e24] border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 text-sm"
                >
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase font-bold text-zinc-400 tracking-wider mb-2">Account Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#1e1e24] border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive / Deactivated</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-850 text-zinc-450 hover:bg-zinc-800 transition font-semibold text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-lime-400 hover:bg-lime-500 text-zinc-950 font-bold rounded-xl transition text-sm shadow-md shadow-lime-950/20 cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite User Modal Dialog */}
      {isInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-md p-6 rounded-3xl relative shadow-2xl animate-scale-up border border-zinc-800 bg-[#121218]/95">
            <button
              onClick={() => setIsInviteOpen(false)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-white mb-2">Invite Workspace Member</h3>
            <p className="text-xs text-zinc-400 mb-6">Dispatches an invitation link using Clerk Auth credentials.</p>

            <form onSubmit={handleInviteSubmit} className="space-y-4">
              <div>
                <label className="block text-xs uppercase font-bold text-zinc-400 tracking-wider mb-2">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Vlad Havrylov"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#1e1e24] border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs uppercase font-bold text-zinc-400 tracking-wider mb-2">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#1e1e24] border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs uppercase font-bold text-zinc-400 tracking-wider mb-2">Default Role Selection</label>
                <select
                  value={inviteRoleId}
                  onChange={(e) => setInviteRoleId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#1e1e24] border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 text-sm"
                >
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setIsInviteOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-850 text-zinc-450 hover:bg-zinc-800 transition font-semibold text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-lime-400 hover:bg-lime-500 text-zinc-950 font-bold rounded-xl transition text-sm shadow-lg shadow-lime-950/20 flex items-center gap-2 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5 text-zinc-950" /> Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
