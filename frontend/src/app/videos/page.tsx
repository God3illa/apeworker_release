"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../AuthProvider";
import {
  Download,
  Trash2,
  Play,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Zap,
  Video,
  Clock,
  Eye,
  ExternalLink,
  MoreVertical,
} from "lucide-react";

interface VideoItem {
  id: string;
  title: string;
  description: string;
  hashtags: string[];
  view_count: number;
  duration: number;
  platform: string;
  thumbnail_url: string;
  original_url: string;
  file_path: string;
  downloaded_at: string;
}

interface UserProfile {
  name: string;
  email: string;
  role_name: string;
  permissions: string[];
}

export default function ViralVideos() {
  const { getToken } = useAuth();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // URL Import panel states
  const [urlInput, setUrlInput] = useState("");
  const [importStatus, setImportStatus] = useState<"idle" | "queueing" | "downloading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [jobId, setJobId] = useState("");

  // Description expanders
  const [expandedDescIds, setExpandedDescIds] = useState<string[]>([]);

  // Video preview player modal states
  const [activePlayerVideo, setActivePlayerVideo] = useState<VideoItem | null>(null);

  // Track active row dropdown menu
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const fetchVideos = async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/videos`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load videos library");
      const data = await res.json();
      setVideos(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadProfile = async () => {
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
      console.error("Error loading user profile context", e);
    }
  };

  useEffect(() => {
    fetchVideos();
    loadProfile();
  }, []);

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput) return;

    setImportStatus("queueing");
    setErrorMessage("");
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/videos/download`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ url: urlInput })
      });

      if (!res.ok) throw new Error("Could not execute download pipeline");
      const data = await res.json();
      setJobId(data.job_id);
      setImportStatus("downloading");

      pollJobStatus(data.job_id);
    } catch (err: any) {
      setImportStatus("error");
      setErrorMessage(err.message || "An unexpected error occurred.");
    }
  };

  const pollJobStatus = (id: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/jobs/${id}`);
        if (!res.ok) return;
        const job = await res.json();

        if (job.status === "SUCCESS") {
          setImportStatus("success");
          setUrlInput("");
          clearInterval(interval);
          fetchVideos();
        } else if (job.status === "FAILURE") {
          setImportStatus("error");
          setErrorMessage("Failed to download video. Please check URL.");
          clearInterval(interval);
        }
      } catch (err) {
        console.error(err);
      }
    }, 2000);

    setTimeout(() => clearInterval(interval), 120000);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this video from storage?")) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/videos/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setVideos(videos.filter(v => v.id !== id));
      }
    } catch (e) {
      console.error("Error deleting video", e);
    }
  };

  const toggleDescription = (id: string) => {
    if (expandedDescIds.includes(id)) {
      setExpandedDescIds(expandedDescIds.filter(x => x !== id));
    } else {
      setExpandedDescIds([...expandedDescIds, id]);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatViews = (views: number) => {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(1)}K`;
    return views.toString();
  };

  const canDownload = profile === null || profile.permissions.includes("videos:download");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-extrabold text-lime-400">
          Viral Videos Library
        </h1>
        <p className="text-zinc-400 mt-1">Download, catalog, and preview trending video resources.</p>
      </div>

      {/* URL Import Console */}
      <div className="glass-panel p-6 rounded-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-lime-400/5 rounded-full blur-[80px] pointer-events-none" />
        <h2 className="text-lg font-bold text-zinc-100 mb-2 flex items-center gap-2">
          <Zap className="w-4 h-4 text-lime-400" /> Import Viral Media
        </h2>
        <p className="text-xs text-zinc-400 mb-4">Provide a valid Instagram Reel or TikTok link. System extracts files and builds metadata metrics.</p>

        <form onSubmit={handleDownload} className="flex gap-4">
          <input
            type="url"
            required
            placeholder={canDownload ? "Paste Instagram or TikTok link here..." : "Video download pipeline is restricted to administrative roles."}
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            disabled={!canDownload || importStatus === "queueing" || importStatus === "downloading"}
            className="flex-1 px-4 py-3 rounded-xl bg-[#1e1e24] border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 placeholder-zinc-500 disabled:opacity-50 transition"
          />
          <button
            type="submit"
            disabled={!canDownload || importStatus === "queueing" || importStatus === "downloading"}
            className="px-6 py-3 bg-lime-400 hover:bg-lime-500 disabled:opacity-50 text-zinc-950 font-bold rounded-xl transition shadow-lg shadow-lime-950/20 text-sm flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4 text-zinc-950" /> Download
          </button>
        </form>

        {!canDownload && (
          <div className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 flex items-center gap-3 animate-fade-in">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <p className="font-bold">Недостаточно прав доступа</p>
              <p className="text-zinc-450 mt-0.5">Вашему профилю назначена роль с ограничениями (например, Viewer). Скачивание видео и использование пайплайнов заблокировано. Попросите администратора выдать вам роль Admin или Editor.</p>
            </div>
          </div>
        )}

        {/* Import State details */}
        {importStatus !== "idle" && (
          <div className="mt-4 p-3 rounded-lg bg-zinc-950/40 border border-zinc-800 text-sm w-fit flex items-center gap-3">
            {importStatus === "queueing" && <span className="text-amber-400 animate-pulse flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending to processing pipeline...</span>}
            {importStatus === "downloading" && <span className="text-lime-400 animate-pulse flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Downloading assets using yt-dlp...</span>}
            {importStatus === "success" && <span className="text-emerald-400 flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" /> Video imported successfully! Added to grid.</span>}
            {importStatus === "error" && <span className="text-rose-400 flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5" /> Error: {errorMessage}</span>}
          </div>
        )}
      </div>

      {/* Videos List Table */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800">
          <h3 className="text-lg font-bold text-zinc-100">Library Catalog</h3>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-zinc-500 font-semibold flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading library catalog...
            </div>
          ) : videos.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              <Download className="w-8 h-8 mx-auto mb-3 text-zinc-600" />
              No videos downloaded yet. Paste a link above to populate the library!
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-950/40 text-xs font-bold uppercase text-zinc-400 border-b border-zinc-800">
                  <th className="p-4 pl-6">Preview</th>
                  <th className="p-4">Meta Context</th>
                  <th className="p-4">Tags</th>
                  <th className="p-4">Views</th>
                  <th className="p-4">Duration</th>
                  <th className="p-4">Source</th>
                  <th className="p-4">Downloaded At</th>
                  <th className="p-4 pr-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {videos.map((vid) => {
                  const isExpanded = expandedDescIds.includes(vid.id);
                  const displayDesc = isExpanded ? vid.description : (vid.description.slice(0, 80) + (vid.description.length > 80 ? "..." : ""));

                  return (
                    <tr key={vid.id} className="hover:bg-zinc-900/20 transition-all">
                      <td className="p-4 pl-6">
                        <div
                          onClick={() => setActivePlayerVideo(vid)}
                          className="w-[100px] h-[177px] rounded-lg overflow-hidden border border-zinc-800 relative bg-zinc-950 cursor-pointer group"
                        >
                          <img
                            src={vid.thumbnail_url ? (vid.thumbnail_url.startsWith("http") ? vid.thumbnail_url : `${API_URL}${vid.thumbnail_url}`) : "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe"}
                            alt={vid.title}
                            className="w-full h-full object-cover group-hover:scale-110 transition duration-300"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                            <Play className="w-5 h-5 text-white" />
                          </div>
                        </div>
                      </td>
                      <td className="p-4 max-w-sm">
                        <h4 className="font-bold text-white text-sm line-clamp-1">{vid.title || "Viral Video"}</h4>
                        <p className="text-xs text-zinc-400 mt-1 whitespace-pre-wrap">
                          {displayDesc}
                          {vid.description.length > 80 && (
                            <button
                              onClick={() => toggleDescription(vid.id)}
                              className="text-lime-400 hover:text-lime-500 ml-1 text-[10px] font-bold uppercase tracking-wider"
                            >
                              {isExpanded ? "Less" : "More"}
                            </button>
                          )}
                        </p>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1 max-w-[150px]">
                          {vid.hashtags && vid.hashtags.map((h, idx) => (
                            <span key={idx} className="px-2 py-0.5 rounded text-[10px] font-semibold bg-lime-400/10 border border-lime-400/20 text-lime-400">
                              #{h}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-4 font-semibold text-zinc-200 text-sm">
                        <span className="flex items-center gap-1.5"><Eye className="w-3.5 h-3.5 text-zinc-500" /> {formatViews(vid.view_count)}</span>
                      </td>
                      <td className="p-4 font-semibold text-zinc-200 text-sm">
                        <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-zinc-500" /> {formatDuration(vid.duration)}</span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold ${
                          vid.platform === "TikTok" ? "bg-black text-white border border-zinc-800" :
                          vid.platform === "Instagram" ? "bg-gradient-to-r from-pink-500/20 to-orange-500/20 border border-pink-500/40 text-pink-400" :
                          "bg-zinc-800 text-zinc-400"
                        }`}>
                          {vid.platform}
                        </span>
                      </td>
                      <td className="p-4 text-xs text-zinc-500">{new Date(vid.downloaded_at).toLocaleDateString()}</td>
                      <td className="p-4 pr-6 text-right relative">
                        <div className="flex items-center justify-end gap-2.5">
                          <button
                            onClick={() => setActivePlayerVideo(vid)}
                            className="px-3 py-1.5 rounded-lg bg-[#18D6B0]/10 border border-[#18D6B0]/55 text-[#DFFFF8] hover:bg-[#18D6B0] hover:border-[#18D6B0] hover:text-[#04110F] text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-300 cursor-pointer"
                          >
                            <Play className="w-3 h-3" /> Preview
                          </button>
                          
                          {/* Dropdown Container */}
                          <div className="relative">
                            <button
                              onClick={() => setActiveDropdown(activeDropdown === vid.id ? null : vid.id)}
                              className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition inline-flex items-center justify-center cursor-pointer"
                              title="More actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            
                            {activeDropdown === vid.id && (
                              <>
                                {/* Click outside overlay to close */}
                                <div 
                                  className="fixed inset-0 z-30" 
                                  onClick={() => setActiveDropdown(null)}
                                />
                                
                                {/* Dropdown Menu */}
                                <div className="absolute right-0 mt-1.5 w-36 rounded-xl border border-zinc-800 bg-[#0d0d12]/95 backdrop-blur-xl p-1.5 shadow-2xl z-40 text-left space-y-1">
                                  <a
                                    href={`${API_URL}/uploads/videos/${vid.id}.mp4`}
                                    download={vid.title ? `${vid.title}.mp4` : `video_${vid.id}.mp4`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => setActiveDropdown(null)}
                                    className="w-full px-3 py-2 rounded-lg hover:bg-zinc-800/80 transition text-xs font-semibold text-zinc-200 flex items-center gap-2 cursor-pointer"
                                  >
                                    <Download className="w-3.5 h-3.5 text-lime-400" />
                                    <span>Download</span>
                                  </a>
                                  
                                  <button
                                    onClick={() => {
                                      handleDelete(vid.id);
                                      setActiveDropdown(null);
                                    }}
                                    className="w-full px-3 py-2 rounded-lg hover:bg-rose-950/30 text-rose-450 hover:text-rose-400 transition text-xs font-semibold flex items-center gap-2 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Delete</span>
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
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

      {/* HTML5 Native Video Preview Modal */}
      {activePlayerVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-xl p-6 rounded-3xl relative shadow-2xl animate-scale-up border border-zinc-800 bg-[#121218]/95">
            <button
              onClick={() => setActivePlayerVideo(null)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-white mb-2 line-clamp-1">{activePlayerVideo.title}</h3>
            <p className="text-xs text-zinc-400 mb-4">{activePlayerVideo.platform} • {formatDuration(activePlayerVideo.duration)}</p>

            <div className="w-full aspect-[9/16] max-h-[60vh] rounded-xl overflow-hidden bg-black border border-zinc-800 relative flex items-center justify-center">
              <video
                src={`${API_URL}/uploads/videos/${activePlayerVideo.id}.mp4`}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
