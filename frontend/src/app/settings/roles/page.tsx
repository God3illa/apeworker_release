"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../AuthProvider";
import {
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  Lock,
  Users,
} from "lucide-react";

interface Role {
  id: number;
  name: string;
  description: string;
  permissions: string[];
  permissions_count: number;
  users_count: number;
  created_at: string;
}

export default function RolesSettings() {
  const { getToken } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  // Creation/Edit states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [roleName, setRoleName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // Full permission definitions grouped by category
  const permissionStructure = [
    {
      category: "Videos",
      items: [
        { key: "videos:view", label: "View downloaded videos" },
        { key: "videos:download", label: "Download/import viral videos" },
        { key: "videos:delete", label: "Delete downloaded videos" }
      ]
    },
    {
      category: "Watermarks",
      items: [
        { key: "watermarks:view", label: "View uploaded watermarks" },
        { key: "watermarks:upload", label: "Upload WebM/MOV overlays" },
        { key: "watermarks:delete", label: "Delete watermarks" }
      ]
    },
    {
      category: "Collections",
      items: [
        { key: "collections:view", label: "View compiled collections" },
        { key: "collections:create", label: "Compile/generate watermarked collections" },
        { key: "collections:delete", label: "Delete collections" }
      ]
    },
    {
      category: "Publishing Schedule",
      items: [
        { key: "schedule:view", label: "View scheduled campaigns" },
        { key: "schedule:create", label: "Schedule posting campaigns" },
        { key: "schedule:cancel", label: "Cancel pending schedules" }
      ]
    },
    {
      category: "Social Integration Profiles",
      items: [
        { key: "accounts:view", label: "View integrated Upload Post channels" }
      ]
    },
    {
      category: "Administrative Settings",
      items: [
        { key: "settings:manage users", label: "Manage workspace user roles" },
        { key: "settings:manage roles", label: "Create or modify workspace roles" },
        { key: "settings:manage integrations", label: "Configure API keys & integrations" }
      ]
    }
  ];

  const fetchRoles = async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/roles`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load workspace roles");
      const data = await res.json();
      setRoles(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const handleOpenCreate = () => {
    setEditingRoleId(null);
    setRoleName("");
    setDescription("");
    setSelectedPermissions([]);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (role: Role) => {
    setEditingRoleId(role.id);
    setRoleName(role.name);
    setDescription(role.description);
    setSelectedPermissions(role.permissions);
    setIsFormOpen(true);
  };

  const handlePermissionToggle = (perm: string) => {
    if (selectedPermissions.includes(perm)) {
      setSelectedPermissions(selectedPermissions.filter(p => p !== perm));
    } else {
      setSelectedPermissions([...selectedPermissions, perm]);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName) return;

    try {
      const token = await getToken();
      const isEdit = editingRoleId !== null;
      const url = isEdit ? `${API_URL}/api/roles/${editingRoleId}` : `${API_URL}/api/roles`;
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: roleName,
          description,
          permissions: selectedPermissions
        })
      });

      if (res.ok) {
        setIsFormOpen(false);
        fetchRoles();
      } else {
        const err = await res.json();
        alert(err.detail || "Failed to update role schema");
      }
    } catch (e) {
      console.error("Error managing role", e);
    }
  };

  const handleDeleteRole = async (id: number) => {
    if (!confirm("Are you sure you want to delete this custom role? Members using this role will revert to Viewer.")) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/roles/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setRoles(roles.filter(r => r.id !== id));
      } else {
        const err = await res.json();
        alert(err.detail || "Deletion block encountered.");
      }
    } catch (e) {
      console.error("Error deleting role", e);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-extrabold text-lime-400">
            Workspace Roles
          </h1>
          <p className="text-zinc-400 mt-1">Configure user role policies and edit micro-permission matrices.</p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="px-5 py-2.5 rounded-xl font-bold bg-lime-400 hover:bg-lime-500 transition shadow-lg shadow-lime-950/20 text-zinc-950 flex items-center gap-2 text-sm cursor-pointer"
        >
          <ShieldCheck className="w-4 h-4 text-zinc-950" /> Create Role
        </button>
      </div>

      {/* Roles List Grid */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800">
          <h3 className="text-lg font-bold text-zinc-100">Role Security Policies</h3>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-zinc-500 font-semibold flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Retrieving workspace policies...
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-950/40 text-xs font-bold uppercase text-zinc-400 border-b border-zinc-800">
                  <th className="p-4 pl-6">Role Name</th>
                  <th className="p-4">Description</th>
                  <th className="p-4">Permissions Active</th>
                  <th className="p-4">Users Count</th>
                  <th className="p-4 pr-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {roles.map((r) => {
                  const isSystem = ["Admin", "Editor", "Viewer"].includes(r.name);
                  return (
                    <tr key={r.id} className="hover:bg-zinc-900/20 transition-all">
                      <td className="p-4 pl-6 font-bold text-white text-sm">
                        {r.name}
                        {isSystem && (
                          <span className="text-[9px] uppercase tracking-wider bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded ml-2 font-semibold border border-zinc-700 inline-flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" /> System
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-zinc-400 text-xs max-w-xs line-clamp-1">{r.description || "No description set"}</td>
                      <td className="p-4 font-semibold text-zinc-200 text-sm flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-zinc-500" /> {r.permissions_count} rules
                      </td>
                      <td className="p-4 font-semibold text-zinc-200 text-sm">
                        <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-zinc-500" /> {r.users_count} users</span>
                      </td>
                      <td className="p-4 pr-6 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() => handleOpenEdit(r)}
                          className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs font-semibold inline-flex items-center gap-1.5"
                        >
                          <Pencil className="w-3 h-3" /> Modify
                        </button>
                        {!isSystem && (
                          <button
                            onClick={() => handleDeleteRole(r.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/60 text-rose-400 transition text-xs font-semibold inline-flex items-center gap-1.5"
                          >
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create / Edit Role Modal Dialog */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm overflow-y-auto">
          <div className="glass-panel w-full max-w-2xl p-8 rounded-3xl relative shadow-2xl animate-scale-up border border-zinc-800 bg-[#121218]/95 my-8">
            <button
              onClick={() => setIsFormOpen(false)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-2xl font-extrabold text-white mb-2">
              {editingRoleId ? "Modify Workspace Role" : "Create Security Role"}
            </h3>
            <p className="text-sm text-zinc-400 mb-6">Select discrete operational rules associated with this group policy.</p>

            <form onSubmit={handleFormSubmit} className="space-y-6">
              {/* Role Name */}
              <div>
                <label className="block text-xs uppercase font-bold text-zinc-400 tracking-wider mb-2">Role Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Marketing Lead"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  disabled={["Admin", "Editor", "Viewer"].includes(roleName) && editingRoleId !== null}
                  className="w-full px-4 py-3 rounded-xl bg-[#1e1e24] border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 disabled:opacity-50"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs uppercase font-bold text-zinc-400 tracking-wider mb-2">Role Description</label>
                <textarea
                  placeholder="Summarize the core activities of this user segment..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full h-20 px-4 py-3 rounded-xl bg-[#1e1e24] border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 text-xs"
                />
              </div>

              {/* Permissions Checkbox Grid Matrix */}
              <div>
                <label className="block text-xs uppercase font-bold text-zinc-400 tracking-wider mb-3">Permissions Matrix</label>
                <div className="space-y-4 max-h-[300px] overflow-y-auto p-2 bg-zinc-950/40 rounded-xl border border-zinc-850">
                  {permissionStructure.map((group) => (
                    <div key={group.category} className="space-y-2 border-b border-zinc-850 pb-3 last:border-b-0">
                      <span className="text-[10px] uppercase font-bold text-lime-400 tracking-widest block mb-2">{group.category}</span>
                      <div className="grid grid-cols-2 gap-2">
                        {group.items.map((perm) => {
                          const isChecked = selectedPermissions.includes(perm.key);
                          return (
                            <div
                              key={perm.key}
                              onClick={() => handlePermissionToggle(perm.key)}
                              className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition ${
                                isChecked ? "bg-lime-400/10 border-lime-400/30" : "bg-zinc-900/10 border-zinc-900 hover:border-zinc-800"
                              }`}
                            >
                              <input type="checkbox" checked={isChecked} readOnly className="pointer-events-none rounded accent-lime-400" />
                              <span className="text-[11px] font-semibold text-zinc-300">{perm.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex justify-end gap-3 border-t border-zinc-850 pt-4 mt-6">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-850 text-zinc-450 hover:bg-zinc-800 transition font-semibold text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-lime-400 hover:bg-lime-500 text-zinc-950 font-bold rounded-xl transition text-sm shadow-lg shadow-lime-950/20 cursor-pointer"
                >
                  Save Policy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
