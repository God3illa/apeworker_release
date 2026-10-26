"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { 
  LayoutDashboard, 
  Flame, 
  FolderOpen, 
  Link2, 
  Calendar, 
  Users, 
  ShieldCheck,
  KeyRound,
  Zap,
  Layers
} from "lucide-react";

interface UserProfile {
  name: string;
  email: string;
  role_name: string;
  permissions: string[];
}

interface NavLink {
  href: string;
  label: string;
  icon: any;
  permission?: string;
}

interface NavGroup {
  category: string;
  links: NavLink[];
}

export default function Sidebar() {
  const pathname = usePathname();
  const { getToken, logout } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/users/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setProfile(data);
        }
      } catch (e) {
        console.error("Error loading user context", e);
      }
    };
    fetchProfile();
  }, [getToken, API_URL]);

  const isActive = (href: string) => {
    if (!pathname) return false;
    
    const cleanPathname = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
    const cleanHref = href.endsWith("/") && href !== "/" ? href.slice(0, -1) : href;

    if (cleanHref === "/") {
      return cleanPathname === "/";
    }

    return cleanPathname === cleanHref || cleanPathname.startsWith(cleanHref + "/");
  };

  const navGroups: NavGroup[] = [
    {
      category: "General",
      links: [
        { href: "/", label: "Dashboard", icon: LayoutDashboard }
      ]
    },
    {
      category: "Video Management",
      links: [
        { href: "/videos", label: "Viral Videos", icon: Flame },
        { href: "/watermarks", label: "Watermarks", icon: Layers },
        { href: "/collections", label: "Collections", icon: FolderOpen }
      ]
    },
    {
      category: "Social Accounts",
      links: [
        { href: "/accounts", label: "Social Accounts", icon: Link2 },
        { href: "/schedule", label: "Posting Schedule", icon: Calendar }
      ]
    },
    {
      category: "Settings",
      links: [
        { href: "/settings/users", label: "Users List", icon: Users, permission: "settings:manage users" },
        { href: "/settings/roles", label: "Roles & Permissions", icon: ShieldCheck, permission: "settings:manage roles" },
        { href: "/settings/integrations", label: "API & Integrations", icon: KeyRound, permission: "settings:manage integrations" }
      ]
    }
  ];

  // Filter links based on role permissions
  const visibleGroups = navGroups.map(group => {
    const filteredLinks = group.links.filter(link => {
      if (!link.permission) return true;
      if (!profile) return false; // hide until profile loaded
      if (link.permission === "settings:manage integrations") {
        const perms = profile.permissions || [];
        const roleUpper = (profile.role_name || "").toUpperCase();
        return perms.includes("settings:manage integrations") || 
               perms.includes("settings:manage roles") || 
               perms.includes("settings:manage users") ||
               roleUpper === "ADMIN";
      }
      return profile.permissions.includes(link.permission);
    });
    return { ...group, links: filteredLinks };
  }).filter(group => group.links.length > 0);

  return (
    <>
      <aside className="w-[200px] border-r border-zinc-900 bg-[#0d0d12]/90 flex flex-col justify-between fixed left-0 top-0 h-screen backdrop-blur-xl z-20">
        <div>
          {/* Brand Logo in premium lime style */}
          <div className="px-3.5 py-4 border-b border-zinc-900 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl bg-lime-400 flex items-center justify-center shadow-lg shadow-lime-900/20 shrink-0">
              <Zap className="w-3.5 h-3.5 text-zinc-950" />
            </div>
            <div>
              <h1 className="font-bold text-sm leading-none text-lime-400">
                ApeLabs
              </h1>
              <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-semibold block mt-1">
                Team Portal
              </span>
            </div>
          </div>
  
          {/* Navigation Links */}
          <nav className="p-2.5 space-y-1">
            {visibleGroups.map((group) => (
              <div key={group.category} className="space-y-1.5">
                <span className="px-2 text-[9px] uppercase font-bold text-zinc-500 tracking-wider block mt-3 mb-1.5 first:mt-0">
                  {group.category}
                </span>
                {group.links.map((link) => {
                  const active = isActive(link.href);
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 text-xs rounded-xl transition-all group ${
                        active
                          ? "text-white bg-zinc-900/50 font-bold"
                          : "text-zinc-400 hover:text-white hover:bg-zinc-900/50"
                      }`}
                    >
                      <Icon
                        className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                          active
                            ? "text-lime-400"
                            : "text-zinc-500 group-hover:text-lime-400"
                        }`}
                      />
                      <span>{link.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>
  
        {/* User Footer Profile */}
        <div className="p-3 border-t border-zinc-900 flex items-center justify-between bg-zinc-950/20">
          <div className="flex items-center gap-3">
            <div 
              onClick={logout}
              className="w-7 h-7 rounded-full bg-lime-400 shrink-0 hover:bg-lime-500 transition-colors duration-200 text-zinc-950 flex items-center justify-center font-extrabold text-sm cursor-pointer shadow-md shadow-lime-950/20"
              title="Нажмите для выхода"
            >
              {profile?.name ? profile.name[0].toUpperCase() : "A"}
            </div>
            <div className="leading-none">
              <p className="text-xs font-semibold text-zinc-200 truncate max-w-[100px]" title={profile?.name || "Active Session"}>
                {profile?.name || "Active Session"}
              </p>
              <span className="text-[9px] text-lime-400 font-bold uppercase tracking-wider block truncate">
                {profile?.role_name || "Loading..."}
              </span>
            </div>
          </div>
        </div>
      </aside>
      
      {/* Spacer to prevent layout collapse and overlay */}
      <div className="w-[200px] shrink-0" />
    </>
  );
}
