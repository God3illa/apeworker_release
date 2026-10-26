"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../AuthProvider";
import {
  Link2,
  CheckCircle2,
  XCircle,
  Crown,
  Plug,
  Loader2,
  ExternalLink,
} from "lucide-react";

interface Profile {
  username: string;
  status: string;
  connected_accounts: { [platform: string]: { account_name: string; active: boolean } };
}

interface UserContext {
  email: string;
  plan: string;
}

export default function SocialAccounts() {
  const { getToken } = useAuth();
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProfileDetails, setActiveProfileDetails] = useState<Profile | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    const fetchAccountDetails = async () => {
      try {
        const token = await getToken();
        const headers = { Authorization: `Bearer ${token}` };

        const [resUser, resProfiles] = await Promise.all([
          fetch(`${API_URL}/api/accounts/current-user`, { headers }).then(r => r.ok ? r.json() : null),
          fetch(`${API_URL}/api/accounts/profiles`, { headers }).then(r => r.ok ? r.json() : []),
        ]);

        setUserContext(resUser);
        setProfiles(resProfiles);
        
        if (resProfiles && resProfiles.length > 0) {
          setActiveProfileDetails(resProfiles[0]);
        }
      } catch (e) {
        console.error("Error retrieving accounts proxy details", e);
      } finally {
        setLoading(false);
      }
    };

    fetchAccountDetails();
  }, []);

  // Standard platforms check
  const platformList = [
    { name: "instagram", label: "Instagram", color: "text-pink-400 bg-pink-500/10 border-pink-500/20" },
    { name: "tiktok", label: "TikTok", color: "text-zinc-200 bg-black/40 border-zinc-800" },
    { name: "facebook", label: "Facebook", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
    { name: "threads", label: "Threads", color: "text-zinc-300 bg-zinc-800/30 border-zinc-700/40" },
    { name: "youtube", label: "YouTube", color: "text-red-400 bg-red-500/10 border-red-500/20" },
    { name: "linkedin", label: "LinkedIn", color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20" },
    { name: "x", label: "X (Twitter)", color: "text-zinc-200 bg-zinc-800/40 border-zinc-800" },
    { name: "pinterest", label: "Pinterest", color: "text-rose-400 bg-rose-500/10 border-rose-500/20" }
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-extrabold text-lime-400">
          Connected Accounts
        </h1>
        <p className="text-zinc-400 mt-1">Manage external profiles linked to the Upload Post API.</p>
      </div>

      {loading ? (
        <div className="text-center py-20 text-zinc-500 font-semibold flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Syncing connected social platforms...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Profiles list & user info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Account context card */}
            {userContext && (
              <div className="glass-panel p-6 rounded-2xl relative overflow-hidden flex items-center justify-between border-l-4 border-lime-400">
                <div className="absolute top-0 right-0 w-64 h-64 bg-lime-400/5 rounded-full blur-[80px] pointer-events-none" />
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-500 block mb-1">Subscription Status</span>
                  <h3 className="text-lg font-bold text-white">{userContext.email}</h3>
                </div>
                <div className="px-4 py-2 rounded-xl bg-lime-400/10 border border-lime-400/30 text-lime-400 font-bold text-sm uppercase tracking-widest flex items-center gap-2">
                  <Crown className="w-3.5 h-3.5" /> Plan: {userContext.plan}
                </div>
              </div>
            )}

            {/* Profiles table catalog */}
            <div className="glass-panel rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-zinc-800">
                <h3 className="text-lg font-bold text-zinc-100">Upload Post Profiles</h3>
              </div>

              <div className="overflow-x-auto">
                {profiles.length === 0 ? (
                  <div className="p-12 text-center text-zinc-500">
                    <Plug className="w-8 h-8 mx-auto mb-3 text-zinc-600" />
                    No active profiles returned. Connect channels in Upload Post console.
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-zinc-950/40 text-xs font-bold uppercase text-zinc-400 border-b border-zinc-800">
                        <th className="p-4 pl-6">Profile Username</th>
                        <th className="p-4">Status</th>
                        <th className="p-4 pr-6">Integrations</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {profiles.map((prof) => {
                        const connectedKeys = Object.keys(prof.connected_accounts || {}).filter(
                          k => prof.connected_accounts[k]?.active
                        );

                        return (
                          <tr 
                            key={prof.username} 
                            className={`hover:bg-zinc-900/20 transition-all cursor-pointer ${activeProfileDetails?.username === prof.username ? "bg-lime-400/5 border-l-2 border-lime-400" : ""}`}
                            onClick={() => setActiveProfileDetails(prof)}
                          >
                            <td className="p-4 pl-6 font-bold text-white text-sm">@{prof.username}</td>
                            <td className="p-4">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                                prof.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-400"
                              }`}>
                                {prof.status === "active" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                {prof.status}
                              </span>
                            </td>
                            <td className="p-4 pr-6">
                              <div className="flex gap-1.5 flex-wrap max-w-[200px]">
                                {connectedKeys.map(k => {
                                  const config = platformList.find(p => p.name === k);
                                  return (
                                    <span key={k} className={`px-2 py-0.5 rounded text-[9px] font-bold border capitalize ${
                                      config?.color || "text-zinc-400 bg-zinc-800 border-zinc-700"
                                    }`}>
                                      {k}
                                    </span>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Social details panel */}
          <div className="lg:col-span-1">
            {activeProfileDetails ? (
              <div className="glass-panel p-6 rounded-2xl sticky top-8 min-h-[400px]">
                <h3 className="text-xl font-bold text-white mb-2">@{activeProfileDetails.username}</h3>
                <p className="text-xs text-zinc-400 mb-6">Linked integration channels synchronization overview.</p>

                <div className="space-y-3">
                  {platformList.map((platform) => {
                    const connected = activeProfileDetails.connected_accounts?.[platform.name];
                    const isActive = !!connected?.active;

                    const getPlatformUrl = (platformName: string, accountName: string) => {
                      const cleanName = accountName.replace(/^@/, "");
                      switch (platformName) {
                        case "instagram":
                          return `https://www.instagram.com/${cleanName}`;
                        case "tiktok":
                          return `https://www.tiktok.com/@${cleanName}`;
                        case "facebook":
                          return `https://www.facebook.com/${cleanName}`;
                        case "threads":
                          return `https://www.threads.net/@${cleanName}`;
                        case "youtube":
                          return `https://www.youtube.com/@${cleanName}`;
                        case "linkedin":
                          return `https://www.linkedin.com/in/${cleanName}`;
                        case "x":
                          return `https://x.com/${cleanName}`;
                        case "pinterest":
                          return `https://www.pinterest.com/${cleanName}`;
                        default:
                          return "#";
                      }
                    };

                    const url = isActive ? getPlatformUrl(platform.name, connected.account_name) : null;

                    return (
                      <div
                        key={platform.name}
                        onClick={() => {
                          if (isActive && url) {
                            window.open(url, "_blank");
                          }
                        }}
                        className={`p-3 rounded-xl border flex items-center justify-between transition ${
                          isActive 
                            ? "bg-zinc-950/40 border-zinc-800 hover:border-zinc-700/80 hover:bg-zinc-900/30 cursor-pointer active:scale-[0.99] group" 
                            : "bg-zinc-950/10 border-zinc-900 opacity-40"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`text-sm px-2 py-1 rounded border font-bold capitalize ${platform.color}`}>
                            {platform.name.charAt(0)}
                          </span>
                          <div>
                            <h4 className="text-sm font-bold text-zinc-200">{platform.label}</h4>
                            <span className="text-[10px] text-zinc-500">{isActive ? connected.account_name : "Not integrated"}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isActive ? (
                            <>
                              <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Synchronized
                              </span>
                              <ExternalLink className="w-3 h-3 text-zinc-500 group-hover:text-lime-400 transition" />
                            </>
                          ) : (
                            <span className="text-[10px] font-semibold text-zinc-650">Disconnected</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="glass-panel p-12 rounded-2xl text-center text-zinc-500 flex flex-col items-center justify-center min-h-[300px]">
                <Plug className="w-10 h-10 mb-3 text-zinc-600" />
                Select a profile to view connected social accounts details!
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
