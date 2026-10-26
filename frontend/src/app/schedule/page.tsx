"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "../AuthProvider";
import { 
  Calendar, 
  Clock, 
  Sparkles, 
  Info, 
  AlertCircle, 
  CheckCircle, 
  X, 
  Trash2, 
  RefreshCw, 
  Eye, 
  User, 
  Video, 
  Tag, 
  ArrowRight,
  Send,
  Music,
  MessageCircle,
  FileText,
  ExternalLink
} from "lucide-react";

// Custom premium Google-style minimalist brand SVGs
const InstagramIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

const FacebookIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

const TikTokIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
  </svg>
);

const ThreadsIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-5.5h-3v-1h3v1z" />
  </svg>
);

interface Collection {
  id: string;
  name: string;
  items: { id: string; watermark_name: string; status: string }[];
}

interface Profile {
  username: string;
  status: string;
  connected_accounts: any;
}

interface ScheduledJob {
  id: string;
  collection_name: string;
  profile: string;
  platforms: string[];
  scheduled_at: string;
  status: string;
  result: any;
  post_title?: string;
  post_description?: string;
  post_hashtags?: string;
  channel_links?: { [platform: string]: string };
  channel_handles?: { [platform: string]: string };
}

const platformColors: Record<string, { bg: string; hover: string; border: string; text: string; label: string }> = {
  tiktok: {
    bg: "bg-black/70",
    hover: "hover:bg-cyan-500/20 hover:border-cyan-400 hover:text-cyan-300",
    border: "border-zinc-700",
    text: "text-zinc-200",
    label: "TikTok"
  },
  instagram: {
    bg: "bg-pink-950/40",
    hover: "hover:bg-pink-500/20 hover:border-pink-400 hover:text-pink-300",
    border: "border-pink-900/60",
    text: "text-pink-300",
    label: "Instagram"
  },
  youtube: {
    bg: "bg-red-950/40",
    hover: "hover:bg-red-500/20 hover:border-red-400 hover:text-red-300",
    border: "border-red-900/60",
    text: "text-red-300",
    label: "YouTube"
  },
  facebook: {
    bg: "bg-blue-950/40",
    hover: "hover:bg-blue-500/20 hover:border-blue-400 hover:text-blue-300",
    border: "border-blue-900/60",
    text: "text-blue-300",
    label: "Facebook"
  },
  threads: {
    bg: "bg-zinc-900/80",
    hover: "hover:bg-zinc-700 hover:border-zinc-400 hover:text-white",
    border: "border-zinc-700",
    text: "text-zinc-300",
    label: "Threads"
  },
  x: {
    bg: "bg-black/70",
    hover: "hover:bg-zinc-800 hover:border-zinc-400 hover:text-white",
    border: "border-zinc-700",
    text: "text-zinc-200",
    label: "X"
  }
};



function getChannelProfileUrl(job: ScheduledJob, platform: string, profilesList?: Profile[]): string | undefined {
  const platKey = platform.toLowerCase();
  if (job.channel_links && job.channel_links[platKey]) {
    return job.channel_links[platKey];
  }
  if (platKey === 'x' && job.channel_links?.['twitter']) return job.channel_links['twitter'];
  if (platKey === 'twitter' && job.channel_links?.['x']) return job.channel_links['x'];

  if (profilesList && profilesList.length > 0) {
    const prof = profilesList.find(p => p.username === job.profile);
    if (prof?.connected_accounts?.[platKey]?.profile_url) {
      return prof.connected_accounts[platKey].profile_url;
    }
    const handle = prof?.connected_accounts?.[platKey]?.handle || prof?.connected_accounts?.[platKey]?.account_name;
    if (handle) {
      const clean = handle.replace(/^@/, '').trim();
      if (clean) {
        if (platKey === 'tiktok') return `https://www.tiktok.com/@${clean}`;
        if (platKey === 'instagram') return `https://www.instagram.com/${clean}/`;
        if (platKey === 'youtube') return `https://www.youtube.com/@${clean}`;
        if (platKey === 'threads') return `https://www.threads.net/@${clean}`;
        if (platKey === 'x' || platKey === 'twitter') return `https://x.com/${clean}`;
        if (platKey === 'facebook') return `https://www.facebook.com/search/top?q=${encodeURIComponent(clean)}`;
      }
    }
  }

  return undefined;
}

function getChannelHandle(job: ScheduledJob, platform: string, profilesList?: Profile[]): string | undefined {
  const platKey = platform.toLowerCase();
  if (job.channel_handles && job.channel_handles[platKey]) {
    return job.channel_handles[platKey];
  }
  if (platKey === 'x' && job.channel_handles?.['twitter']) return job.channel_handles['twitter'];
  if (platKey === 'twitter' && job.channel_handles?.['x']) return job.channel_handles['x'];

  if (profilesList && profilesList.length > 0) {
    const prof = profilesList.find(p => p.username === job.profile);
    return prof?.connected_accounts?.[platKey]?.handle || prof?.connected_accounts?.[platKey]?.account_name;
  }
  return undefined;
}


export default function PostingSchedule() {
  const { getToken } = useAuth();
  const [schedules, setSchedules] = useState<ScheduledJob[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const dateTimeRef = useRef<HTMLInputElement>(null);

  // Form states
  const [selectedProfile, setSelectedProfile] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [publishTime, setPublishTime] = useState("");
  const [caption, setCaption] = useState("");
  const [postTitle, setPostTitle] = useState("");
  const [postDescription, setPostDescription] = useState("");
  const [postHashtags, setPostHashtags] = useState("");
  
  // Tag input states
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // Sync tags with postHashtags
  useEffect(() => {
    setPostHashtags(tags.join(" "));
  }, [tags]);

  const handleTagInputChange = (val: string) => {
    if (val.includes(",")) {
      const parts = val.split(",");
      const newTags = [...tags];
      
      for (let i = 0; i < parts.length - 1; i++) {
        let tag = parts[i].trim();
        if (tag) {
          if (!tag.startsWith("#")) {
            tag = `#${tag}`;
          }
          if (!newTags.includes(tag)) {
            if (newTags.length >= 30) {
              alert("Достигнут лимит в 30 хэштегов! / Maximum limit of 30 hashtags reached!");
              break;
            }
            const potentialHashtagsStr = [...newTags, tag].join(" ");
            if (potentialHashtagsStr.length > 500) {
              alert("Хэштеги превышают лимит в 500 символов! / Hashtags exceed 500 characters limit!");
              break;
            }
            newTags.push(tag);
          }
        }
      }
      setTags(newTags);
      setTagInput(parts[parts.length - 1]);
    } else {
      setTagInput(val);
    }
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      let tag = tagInput.trim();
      if (tag) {
        if (!tag.startsWith("#")) {
          tag = `#${tag}`;
        }
        if (!tags.includes(tag)) {
          if (tags.length >= 30) {
            alert("Достигнут лимит в 30 хэштегов! / Maximum limit of 30 hashtags reached!");
            return;
          }
          const potentialHashtagsStr = [...tags, tag].join(" ");
          if (potentialHashtagsStr.length > 500) {
            alert("Хэштеги превышают лимит в 500 символов! / Hashtags exceed 500 characters limit!");
            return;
          }
          setTags([...tags, tag]);
        }
        setTagInput("");
      }
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  const handleRemoveTag = (indexToRemove: number) => {
    setTags(tags.filter((_, i) => i !== indexToRemove));
  };

  // Compute unified caption details and validate against channel limits
  const getCompiledCaptionDetails = () => {
    const captionParts: string[] = [];
    if (postTitle) captionParts.push(postTitle);
    if (postDescription) captionParts.push(postDescription);
    if (postHashtags) {
      const formattedTags = postHashtags
        .replace(/,/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .map(tag => tag.startsWith("#") ? tag : `#${tag}`);
      if (formattedTags.length > 0) {
        captionParts.push(formattedTags.join(" "));
      }
    }
    const compiledCaption = captionParts.join("\n\n");
    const totalCompiledLength = compiledCaption.length;

    // Check platform errors
    const errors: { [key: string]: string } = {};
    if (selectedPlatforms.includes("threads") && totalCompiledLength > 500) {
      errors.threads = `Лимит Threads превышен: ${totalCompiledLength}/500 симв.`;
    }
    if (selectedPlatforms.includes("instagram") && totalCompiledLength > 2200) {
      errors.instagram = `Лимит Instagram превышен: ${totalCompiledLength}/2200 симв.`;
    }
    if (selectedPlatforms.includes("tiktok") && totalCompiledLength > 2200) {
      errors.tiktok = `Лимит TikTok превышен: ${totalCompiledLength}/2200 симв.`;
    }
    if (selectedPlatforms.includes("facebook") && totalCompiledLength > 2200) {
      errors.facebook = `Лимит Facebook превышен: ${totalCompiledLength}/2200 симв.`;
    }

    return {
      compiledCaption,
      totalCompiledLength,
      errors,
      hasErrors: Object.keys(errors).length > 0
    };
  };

  const { compiledCaption, totalCompiledLength, errors, hasErrors } = getCompiledCaptionDetails();
  
  // Dialog state for viewing results
  const [activeJobResult, setActiveJobResult] = useState<ScheduledJob | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const loadData = async () => {
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };

      const [resSchedules, resProfiles, resCollections] = await Promise.all([
        fetch(`${API_URL}/api/schedule`, { headers }).then(r => r.ok ? r.json() : []),
        fetch(`${API_URL}/api/accounts/profiles`, { headers }).then(r => r.ok ? r.json() : []),
        fetch(`${API_URL}/api/collections`, { headers }).then(r => r.ok ? r.json() : []),
      ]);

      setSchedules(resSchedules);
      setProfiles(resProfiles);
      
      // Filter for collections that have at least one successfully watermarked video
      const readyCols = resCollections.filter((c: any) => c.items.some((i: any) => i.status === "ready"));
      setCollections(readyCols);

      if (resProfiles && resProfiles.length > 0) {
        setSelectedProfile(resProfiles[0].username);
      }
      if (readyCols && readyCols.length > 0) {
        setSelectedCollectionId(readyCols[0].id);
        const firstReadyItem = readyCols[0].items.find((i: any) => i.status === "ready");
        if (firstReadyItem) setSelectedItemId(firstReadyItem.id);
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

  // Update item dropdown when collection changes
  useEffect(() => {
    if (selectedCollectionId) {
      const col = collections.find(c => c.id === selectedCollectionId);
      if (col) {
        const readyItem = col.items.find(i => i.status === "ready");
        if (readyItem) setSelectedItemId(readyItem.id);
      }
    }
  }, [selectedCollectionId, collections]);

  const handlePlatformToggle = (platform: string) => {
    if (selectedPlatforms.includes(platform)) {
      setSelectedPlatforms(selectedPlatforms.filter(p => p !== platform));
    } else {
      setSelectedPlatforms([...selectedPlatforms, platform]);
    }
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfile || !selectedCollectionId || !selectedItemId || selectedPlatforms.length === 0 || !publishTime) {
      alert("Please ensure all required scheduler configurations are completed.");
      return;
    }

    if (hasErrors) {
      alert("Некоторые лимиты символов для выбранных платформ превышены. Пожалуйста, исправьте текст перед планированием.");
      return;
    }

    try {
      const token = await getToken();
      // Format local datetime-local to ISO string
      const isoTime = new Date(publishTime).toISOString();

      const res = await fetch(`${API_URL}/api/schedule`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          collection_id: selectedCollectionId,
          collection_item_id: selectedItemId,
          profile_username: selectedProfile,
          platforms: selectedPlatforms,
          scheduled_at: isoTime,
          post_title: postTitle || null,
          post_description: postDescription || null,
          post_hashtags: postHashtags || null
        })
      });

      if (res.ok) {
        // Clear out form details
        setPublishTime("");
        setSelectedPlatforms([]);
        setCaption("");
        setPostTitle("");
        setPostDescription("");
        setPostHashtags("");
        setTags([]);
        loadData();
      }
    } catch (e) {
      console.error("Error creating schedule", e);
    }
  };

  const handleCancelSchedule = async (id: string) => {
    if (!confirm("Are you sure you want to cancel this scheduled posting job?")) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/schedule/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setSchedules(schedules.filter(s => s.id !== id));
      }
    } catch (e) {
      console.error("Error cancelling schedule", e);
    }
  };

  const handleRetrySchedule = async (id: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/schedule/${id}/retry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        alert("Immediate retry queued in background worker!");
        loadData();
      }
    } catch (e) {
      console.error("Error retrying schedule", e);
    }
  };

  const activeCollection = collections.find(c => c.id === selectedCollectionId);

  return (
    <div className="space-y-8 animate-fade-in relative">
      {/* Ambient background glows in cosmic theme */}
      <div className="absolute top-[-100px] left-[20%] w-[500px] h-[500px] bg-lime-400/5 rounded-full blur-[120px] pointer-events-none -z-10" />

      {/* Header */}
      <div>
        <h1 className="text-4xl font-extrabold text-lime-400 tracking-tight">
          Publishing Scheduler
        </h1>
        <p className="text-zinc-400 mt-1.5 text-sm">Schedule automatic social posts using watermarked collection outputs.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Scheduler Form Console */}
        <div className="lg:col-span-1">
          <div className="glass-panel p-6 rounded-3xl relative overflow-hidden border border-zinc-800/60 bg-[#0d0d12]/80 backdrop-blur-xl">
            {/* Dynamic ambient card glow */}
            <div className="absolute -top-10 -right-10 w-48 h-48 bg-lime-400/10 rounded-full blur-[60px] pointer-events-none" />
            <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-lime-400/5 rounded-full blur-[60px] pointer-events-none" />
            
            <h2 className="text-md font-bold text-zinc-100 mb-6 flex items-center gap-2.5">
              <Calendar className="w-5 h-5 text-lime-400" />
              <span>Schedule Post</span>
            </h2>

            <form onSubmit={handleScheduleSubmit} className="space-y-5">
              {/* Select Profile */}
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Select Profile Username</label>
                <select
                  required
                  value={selectedProfile}
                  onChange={(e) => setSelectedProfile(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#13131a]/85 border border-zinc-800/80 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 text-sm transition-all"
                >
                  {profiles.map(p => (
                    <option key={p.username} value={p.username}>@{p.username}</option>
                  ))}
                </select>
              </div>

              {/* Select Collection */}
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Select Branded Collection</label>
                {collections.length === 0 ? (
                  <p className="text-xs text-rose-400">No compiled collections with successfully ready watermarked renders available.</p>
                ) : (
                  <select
                    required
                    value={selectedCollectionId}
                    onChange={(e) => setSelectedCollectionId(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-[#13131a]/85 border border-zinc-800/80 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 text-sm transition-all"
                  >
                    {collections.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Select Video File Render */}
              {activeCollection && (
                <div>
                  <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Select Branded Video Render</label>
                  <select
                    required
                    value={selectedItemId}
                    onChange={(e) => setSelectedItemId(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-[#13131a]/85 border border-zinc-800/80 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 text-sm transition-all"
                  >
                    {activeCollection.items.filter(i => i.status === "ready").map(item => (
                      <option key={item.id} value={item.id}>{item.watermark_name} overlay</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Reel Caption, Description, and Hashtags Fields */}
              <div className="space-y-4 pt-3 border-t border-zinc-800/40">
                <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-lime-400 tracking-wider">
                  <Sparkles className="w-3.5 h-3.5 text-lime-400" />
                  <span>Reel Post Metadata (Настройки публикации)</span>
                </div>
                
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Post Title (Заголовок)</label>
                    <span className={`text-[10px] font-bold transition-all duration-300 ${
                      postTitle.length >= 100 ? "text-rose-500 font-extrabold animate-pulse" :
                      postTitle.length >= 80 ? "text-amber-500 font-bold" : "text-zinc-550"
                    }`}>{postTitle.length}/100</span>
                  </div>
                  <input
                    type="text"
                    maxLength={100}
                    placeholder="e.g. Awesome Reel!"
                    value={postTitle}
                    onChange={(e) => setPostTitle(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-[#13131a]/85 border border-zinc-800/80 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 text-sm placeholder:text-zinc-600 transition-all"
                  />
                  <div className="text-[9.5px] text-zinc-500 mt-1 px-1 flex items-center gap-1.5">
                    <Info className="w-3 h-3 text-lime-400" />
                    <span className="px-1.5 py-0.5 rounded bg-zinc-950/60 border border-zinc-850/80 text-zinc-400">Лимит: 100 симв. (YouTube Shorts строго 100)</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Description (Описание)</label>
                    <span className={`text-[10px] font-bold transition-all duration-300 ${
                      postDescription.length >= 2200 ? "text-rose-500 font-extrabold animate-pulse" :
                      postDescription.length >= 1980 ? "text-amber-500 font-bold" : "text-zinc-550"
                    }`}>{postDescription.length}/2200</span>
                  </div>
                  <textarea
                    maxLength={2200}
                    placeholder="Provide details about the post context..."
                    value={postDescription}
                    onChange={(e) => setPostDescription(e.target.value)}
                    rows={2}
                    className="w-full px-4 py-2.5 rounded-xl bg-[#13131a]/85 border border-zinc-800/80 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 text-sm resize-none placeholder:text-zinc-600 transition-all"
                  />
                  <div className="text-[9.5px] text-zinc-555 mt-1 px-1 flex items-center gap-1.5">
                    <Info className="w-3 h-3 text-lime-400" />
                    <span className="px-1.5 py-0.5 rounded bg-zinc-950/60 border border-zinc-850/80 text-zinc-400">Instagram/TikTok/FB: max 2200 симв.</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Hashtags (Хэштеги)</label>
                    <div className="flex gap-2.5 text-[10px] font-bold">
                      <span className={`transition-all duration-300 ${
                        postHashtags.length >= 500 ? "text-rose-500 font-extrabold animate-pulse" :
                        postHashtags.length >= 400 ? "text-amber-500 font-bold" : "text-zinc-550"
                      }`}>{postHashtags.length}/500 симв.</span>
                      <span className={`transition-all duration-300 ${
                        tags.length >= 30 ? "text-rose-500 font-extrabold animate-pulse" :
                        tags.length >= 24 ? "text-amber-500 font-bold" : "text-zinc-550"
                      }`}>{tags.length}/30 тегов</span>
                    </div>
                  </div>
                  <div className="w-full flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-[#13131a]/85 border border-zinc-800/80 focus-within:ring-2 focus-within:ring-lime-400 focus-within:border-transparent transition-all min-h-[44px]">
                    {tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-zinc-700 text-zinc-100 text-xs font-semibold select-none"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => handleRemoveTag(idx)}
                          className="text-zinc-555 hover:text-rose-450 transition font-bold text-sm cursor-pointer leading-none flex items-center justify-center w-3 h-3 rounded-full hover:bg-zinc-700/50"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      maxLength={100}
                      placeholder={tags.length === 0 ? "e.g. reels, viral, apelabs" : ""}
                      value={tagInput}
                      onChange={(e) => handleTagInputChange(e.target.value)}
                      onKeyDown={handleTagKeyDown}
                      className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-zinc-100 text-sm placeholder:text-zinc-650"
                    />
                  </div>
                  <div className="text-[10px] text-zinc-555 mt-1.5 flex flex-col gap-1 px-1">
                    <span className="text-[9.5px]">Введите запятую или нажмите Enter для добавления тега.</span>
                    <div className="flex gap-2 mt-1">
                      <span className="px-1.5 py-0.5 rounded bg-zinc-950/60 border border-zinc-850/80 text-zinc-400">Instagram: max 30 тегов</span>
                      <span className="px-1.5 py-0.5 rounded bg-zinc-950/60 border border-zinc-850/80 text-zinc-400">Длина: max 500 симв.</span>
                    </div>
                  </div>
                </div>

                {/* Real-time Compilation Preview & Platform Limit Errors */}
                <div className="mt-4 p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/10 space-y-2.5 backdrop-blur-[4px]">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] uppercase font-bold text-lime-400 tracking-wider flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" />
                      <span>Предварительный просмотр поста</span>
                    </span>
                    <span className={`text-[10px] font-bold ${
                      selectedPlatforms.includes("threads") && totalCompiledLength > 500 ? "text-rose-500" :
                      totalCompiledLength > 2200 ? "text-rose-500" : "text-lime-400"
                    }`}>
                      Итого: {totalCompiledLength} симв.
                    </span>
                  </div>
                  
                  {compiledCaption ? (
                    <div className="p-3 rounded-lg bg-zinc-950/85 border border-zinc-850/80 text-xs text-zinc-300 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed shadow-inner">
                      {compiledCaption}
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-zinc-950/45 border border-zinc-850/50 text-xs text-zinc-650 italic text-center">
                      Заполните поля выше для предварительного просмотра поста
                    </div>
                  )}

                  {/* Platform Limit Warning States */}
                  {selectedPlatforms.length > 0 && (
                    <div className="space-y-1.5 mt-2 bg-zinc-950/30 p-2 rounded-lg border border-zinc-850/30">
                      <div className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider mb-1 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-lime-400" />
                        <span>Проверка лимитов выбранных сетей:</span>
                      </div>
                      {selectedPlatforms.map(platform => {
                        const isThreads = platform === "threads";
                        const limitVal = isThreads ? 500 : 2200;
                        const isExceeded = totalCompiledLength > limitVal;
                        return (
                          <div key={platform} className="flex justify-between items-center text-[10px] font-bold px-1 py-0.5">
                            <span className="capitalize text-zinc-400 flex items-center gap-1.5">
                              {platform === "instagram" && <InstagramIcon className="w-3.5 h-3.5 text-zinc-500" />}
                              {platform === "tiktok" && <TikTokIcon className="w-3.5 h-3.5 text-zinc-500" />}
                              {platform === "facebook" && <FacebookIcon className="w-3.5 h-3.5 text-zinc-500" />}
                              {platform === "threads" && <ThreadsIcon className="w-3.5 h-3.5 text-zinc-500" />}
                              {platform}
                            </span>
                            <span className={isExceeded ? "text-rose-500 animate-pulse font-extrabold flex items-center gap-1" : "text-emerald-400 font-semibold flex items-center gap-1"}>
                              {totalCompiledLength} / {limitVal}
                              {isExceeded ? (
                                <>
                                  <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                                  <span>Лимит превышен!</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>OK</span>
                                </>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* General Russian descriptive guides */}
                  <div className="text-[9px] text-zinc-550 leading-normal border-t border-zinc-800/40 pt-2 px-0.5 flex items-start gap-1.5">
                    <Info className="w-3 h-3 text-zinc-555 shrink-0 mt-0.5" />
                    <span>Заголовок, описание и хэштеги объединяются при публикации через разделитель абзаца. Threads поддерживает максимум 500 символов, остальные платформы — 2200 символов.</span>
                  </div>
                </div>
              </div>

              {/* Select Platforms Destination */}
              <div className="pt-3 border-t border-zinc-800/40">
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Publish Channels</label>
                <div className="grid grid-cols-2 gap-2">
                  {["instagram", "tiktok", "facebook", "threads"].map((p) => {
                    const isChecked = selectedPlatforms.includes(p);
                    return (
                      <div
                        key={p}
                        onClick={() => handlePlatformToggle(p)}
                        className={`p-2.5 rounded-xl border cursor-pointer text-center font-bold text-xs capitalize transition-all duration-300 flex items-center justify-center gap-2 ${
                          isChecked ? "bg-lime-400/15 border-lime-400 text-lime-400 shadow-[0_0_15px_rgba(163,230,53,0.1)]" : "bg-[#13131a]/85 border-zinc-800/80 text-zinc-400 hover:border-zinc-700/80 hover:text-zinc-300"
                        }`}
                      >
                        {p === "instagram" && <InstagramIcon className="w-3.5 h-3.5" />}
                        {p === "tiktok" && <TikTokIcon className="w-3.5 h-3.5" />}
                        {p === "facebook" && <FacebookIcon className="w-3.5 h-3.5" />}
                        {p === "threads" && <ThreadsIcon className="w-3.5 h-3.5" />}
                        <span>{p}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Scheduled Date/Time picker */}
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Publish Date & Time</label>
                <div 
                  onClick={() => dateTimeRef.current?.showPicker()}
                  className="relative group cursor-pointer"
                >
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-zinc-400 group-hover:text-lime-400 transition-colors">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <input
                    ref={dateTimeRef}
                    type="datetime-local"
                    required
                    value={publishTime}
                    onChange={(e) => setPublishTime(e.target.value)}
                    className="w-full pl-12 pr-10 py-3.5 rounded-xl bg-[#13131a]/85 border border-zinc-800/80 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 text-sm transition-all cursor-pointer font-medium placeholder-zinc-550"
                  />
                  <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-zinc-500 group-hover:text-zinc-400 transition-colors">
                    <Clock className="w-4 h-4" />
                  </div>
                </div>
              </div>

              {/* Submit trigger */}
              <button
                type="submit"
                disabled={!selectedProfile || !selectedCollectionId || !selectedItemId || selectedPlatforms.length === 0 || !publishTime || hasErrors}
                className="w-full py-3 bg-lime-400 hover:bg-lime-500 disabled:opacity-40 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 font-bold rounded-xl transition-all duration-300 text-sm shadow-lg shadow-lime-950/20 hover:shadow-lime-950/30 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>Schedule Publishing</span>
              </button>
            </form>
          </div>
        </div>

        {/* Schedule list table */}
        <div className="lg:col-span-2 space-y-6 sticky top-8">
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800">
              <h3 className="text-lg font-bold text-zinc-100">Scheduled Campaigns</h3>
            </div>

            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-12 text-center text-zinc-500 font-semibold">Retrieving scheduled logs...</div>
              ) : schedules.length === 0 ? (
                <div className="p-12 text-center text-zinc-500 flex flex-col items-center">
                  <Calendar className="w-10 h-10 text-zinc-700 mb-3" />
                  <span>No scheduled posting campaigns active. Set configurations on the left!</span>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-950/40 text-xs font-bold uppercase text-zinc-400 border-b border-zinc-800">
                      <th className="p-4 pl-6">Collection</th>
                      <th className="p-4">Target Profile</th>
                      <th className="p-4">Channels</th>
                      <th className="p-4">Schedule Time</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 pr-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {schedules.map((job) => (
                      <tr key={job.id} className="hover:bg-zinc-900/20 transition-all">
                        <td className="p-4 pl-6">
                          <div className="font-bold text-white text-sm">{job.collection_name}</div>
                          {job.post_title && (
                            <div className="text-[10px] text-lime-400 mt-0.5 font-semibold truncate max-w-[200px] flex items-center gap-1" title={job.post_title}>
                              <FileText className="w-3 h-3 text-lime-400 shrink-0" />
                              <span>{job.post_title}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-4 font-semibold text-zinc-300 text-sm">@{job.profile}</td>
                        <td className="p-4">
                          <div className="flex gap-1.5 flex-wrap items-center">
                            {job.platforms.map(p => {
                              const url = getChannelProfileUrl(job, p, profiles);
                              const handle = getChannelHandle(job, p, profiles);
                              const platKey = p.toLowerCase();
                              const style = platformColors[platKey] || {
                                bg: "bg-zinc-800",
                                hover: "hover:bg-zinc-700 hover:border-zinc-500",
                                border: "border-zinc-700",
                                text: "text-zinc-300",
                                label: p
                              };

                              if (url) {
                                return (
                                  <a
                                    key={p}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`Перейти в профиль ${style.label}${handle ? ` (@${handle})` : ""}`}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold border ${style.border} ${style.bg} ${style.text} ${style.hover} uppercase transition-all duration-150 cursor-pointer shadow-sm group/btn hover:scale-105`}
                                  >
                                    <span>{p.slice(0, 3)}</span>
                                    <ExternalLink className="w-2.5 h-2.5 opacity-60 group-hover/btn:opacity-100 transition-opacity shrink-0" />
                                  </a>
                                );
                              }

                              return (
                                <span
                                  key={p}
                                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold border ${style.border} ${style.bg} ${style.text} uppercase`}
                                >
                                  {p.slice(0, 3)}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="p-4 text-xs text-zinc-400">
                          {new Date(job.scheduled_at).toLocaleString()}
                        </td>
                        <td className="p-4">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold capitalize ${
                            job.status === "pending" ? "bg-amber-500/20 text-amber-400" :
                            job.status === "processing" ? "bg-purple-500/20 text-purple-400 animate-pulse" :
                            job.status === "published" ? "bg-emerald-500/20 text-emerald-400" :
                            "bg-rose-500/20 text-rose-400"
                          }`}>
                            {job.status}
                          </span>
                        </td>
                        <td className="p-4 pr-6 text-right space-x-2 whitespace-nowrap">
                          {job.status === "pending" && (
                            <button
                              onClick={() => handleCancelSchedule(job.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer"
                            >
                              Cancel
                            </button>
                          )}
                          {job.status === "failed" && (
                            <button
                              onClick={() => handleRetrySchedule(job.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-900/60 text-emerald-400 text-xs font-semibold cursor-pointer"
                            >
                              Retry
                            </button>
                          )}
                          {job.result && (
                            <button
                              onClick={() => setActiveJobResult(job)}
                              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer"
                            >
                              Results
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Result details dialog overlay */}
      {activeJobResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-lg p-6 rounded-3xl relative shadow-2xl animate-scale-up border border-zinc-800 bg-[#0d0d12]/95 backdrop-blur-xl">
            <button
              onClick={() => setActiveJobResult(null)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-white transition flex items-center justify-center w-8 h-8 rounded-full hover:bg-zinc-850 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <h3 className="text-xl font-bold text-white mb-2">Publishing Campaign Details</h3>
            <p className="text-xs text-zinc-400 mb-4">Metadata and feedback returned from the Upload Post API.</p>

            {(activeJobResult.post_title || activeJobResult.post_description || activeJobResult.post_hashtags) && (
              <div className="mb-6 p-4 rounded-xl border border-zinc-800 bg-zinc-950/40 space-y-3 text-left">
                <span className="text-[10px] uppercase font-bold text-lime-400 tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-lime-400" />
                  <span>Scheduled Metadata</span>
                </span>
                {activeJobResult.post_title && (
                  <div>
                    <h4 className="text-xs font-bold text-zinc-400">Title</h4>
                    <p className="text-sm font-semibold text-white">{activeJobResult.post_title}</p>
                  </div>
                )}
                {activeJobResult.post_description && (
                  <div>
                    <h4 className="text-xs font-bold text-zinc-400">Description</h4>
                    <p className="text-sm font-semibold text-white">{activeJobResult.post_description}</p>
                  </div>
                )}
                {activeJobResult.post_hashtags && (
                  <div>
                    <h4 className="text-xs font-bold text-zinc-400">Hashtags</h4>
                    <p className="text-sm font-semibold text-purple-400">{activeJobResult.post_hashtags}</p>
                  </div>
                )}
              </div>
            )}

            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider block mb-1.5 text-left">API Response Payload</span>
            <pre className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-850 text-[11px] text-emerald-400 overflow-auto max-h-60 font-mono text-left">
              {JSON.stringify(activeJobResult.result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
