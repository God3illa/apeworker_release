"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../AuthProvider";
import { 
  FolderOpen, 
  Play,
  Plus, 
  Layers, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  X, 
  Download, 
  Eye, 
  Video, 
  Sparkles,
  Send,
  ArrowUpLeft,
  ArrowUp,
  ArrowUpRight,
  Minimize2,
  ArrowDownLeft,
  ArrowDown,
  ArrowDownRight,
  MoreVertical,
  Trash2,
  Pause,
  Volume2,
  VolumeX
} from "lucide-react";

interface VideoData {
  id: string;
  title: string;
  thumbnail_url: string;
  file_path?: string;
}

interface Watermark {
  id: string;
  filename: string;
  original_name: string;
}

interface CollectionItem {
  id: string;
  watermark: Watermark;
  position: string;
  offset_x: number;
  offset_y: number;
  scale: number;
  output_url: string | null;
  status: string;
  created_at: string;
}

interface Collection {
  id: string;
  name: string;
  video_title: string;
  video_thumbnail: string;
  watermarks_count: number;
  items: { 
    id: string; 
    status: string; 
    watermark_name: string;
    position: string;
    scale: number;
    output_url: string | null;
  }[];
  created_at: string;
}

interface WatermarkConfigState {
  watermark_id: string;
  position: string;
  offset_x: number;
  offset_y: number;
  scale: number;
}

export default function Collections() {
  const { getToken } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [watermarks, setWatermarks] = useState<Watermark[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal forms
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState("");
  const [selectedWatermarkConfigs, setSelectedWatermarkConfigs] = useState<WatermarkConfigState[]>([]);

  // Live video preview states
  const [focusedWatermarkId, setFocusedWatermarkId] = useState<string | null>(null);
  const [previewDimensions, setPreviewDimensions] = useState<{ w: number; h: number }>({ w: 1080, h: 1920 });
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);

  // Detail view drawer
  const [activeCollectionDetailId, setActiveCollectionDetailId] = useState<string | null>(null);
  const [collectionDetail, setCollectionDetail] = useState<{ id: string; name: string; video: any; items: CollectionItem[] } | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Preview media player
  const [previewOutputUrl, setPreviewOutputUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");

  // Dropdown states for Actions
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const loadData = async () => {
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };

      const [resCol, resVid, resWm] = await Promise.all([
        fetch(`${API_URL}/api/collections`, { headers }).then(r => r.ok ? r.json() : []),
        fetch(`${API_URL}/api/videos`, { headers }).then(r => r.ok ? r.json() : []),
        fetch(`${API_URL}/api/watermarks`, { headers }).then(r => r.ok ? r.json() : []),
      ]);

      setCollections(resCol);
      setVideos(resVid);
      setWatermarks(resWm);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Poll collections status if there are processing items
  useEffect(() => {
    const hasProcessing = collections.some(col => 
      col.items.some(item => item.status === "processing")
    ) || (collectionDetail && collectionDetail.items.some(item => item.status === "processing"));

    if (!hasProcessing) return;

    const interval = setInterval(() => {
      loadData();
      if (activeCollectionDetailId) {
        refreshDetailsSilently(activeCollectionDetailId);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [collections, activeCollectionDetailId, collectionDetail]);

  const getVideoUrl = (video: VideoData | undefined) => {
    if (!video) return "";
    if (video.file_path && video.file_path.startsWith("http")) return video.file_path;
    if (video.file_path) {
      const clean = video.file_path.startsWith("/") ? video.file_path : `/${video.file_path}`;
      return clean;
    }
    return `/uploads/videos/${video.id}.mp4`;
  };

  const getWatermarkUrl = (wm: Watermark | undefined) => {
    if (!wm) return "";
    return `/uploads/watermarks/${wm.filename}`;
  };

  const selectedVideo = videos.find(v => v.id === selectedVideoId);

  const handleOpenWizard = () => {
    setCollectionName("");
    const firstVid = videos[0]?.id || "";
    setSelectedVideoId(firstVid);
    setSelectedWatermarkConfigs([]);
    setFocusedWatermarkId(null);
    setIsPlaying(true);
    setIsMuted(true);
    setIsWizardOpen(true);
  };

  const handleWatermarkToggle = (wmId: string) => {
    const exists = selectedWatermarkConfigs.find(c => c.watermark_id === wmId);
    if (exists) {
      const remaining = selectedWatermarkConfigs.filter(c => c.watermark_id !== wmId);
      setSelectedWatermarkConfigs(remaining);
      if (focusedWatermarkId === wmId) {
        setFocusedWatermarkId(remaining[0]?.watermark_id || null);
      }
    } else {
      setSelectedWatermarkConfigs([...selectedWatermarkConfigs, {
        watermark_id: wmId,
        position: "top-center",
        offset_x: 0,
        offset_y: 50,
        scale: 85
      }]);
      setFocusedWatermarkId(wmId);
    }
  };

  const handleConfigChange = (wmId: string, field: keyof WatermarkConfigState, val: any) => {
    setSelectedWatermarkConfigs(selectedWatermarkConfigs.map(c => {
      if (c.watermark_id === wmId) {
        return { ...c, [field]: val };
      }
      return c;
    }));
  };

  const handleWizardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collectionName || !selectedVideoId || selectedWatermarkConfigs.length === 0) return;

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/collections`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: collectionName,
          video_id: selectedVideoId,
          watermarks: selectedWatermarkConfigs
        })
      });

      if (res.ok) {
        setIsWizardOpen(false);
        loadData();
      }
    } catch (e) {
      console.error("Error creating collection", e);
    }
  };

  const handleViewDetails = async (colId: string) => {
    setActiveCollectionDetailId(colId);
    setLoadingDetails(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/collections/${colId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCollectionDetail(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDetails(false);
    }
  };

  const refreshDetailsSilently = async (colId: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/collections/${colId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCollectionDetail(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteCollection = async (colId: string) => {
    if (!confirm("Are you sure you want to delete this collection and all watermarked outputs?")) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/collections/${colId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setCollections(collections.filter(c => c.id !== colId));
        if (activeCollectionDetailId === colId) {
          setCollectionDetail(null);
          setActiveCollectionDetailId(null);
        }
      }
    } catch (e) {
      console.error("Error deleting collection", e);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in relative">
      {/* Ambient background glow in cosmic theme */}
      <div className="absolute top-[-100px] left-[20%] w-[450px] h-[450px] bg-lime-400/5 rounded-full blur-[120px] pointer-events-none -z-10" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold text-lime-400 tracking-tight">
            Branded Collections
          </h1>
          <p className="text-zinc-400 mt-1.5 text-sm">Compile and overlay watermarks onto core video assets.</p>
        </div>
        <button
          onClick={handleOpenWizard}
          className="px-5 py-2.5 rounded-xl font-bold bg-lime-400 hover:bg-lime-500 transition text-zinc-950 flex items-center gap-2 text-sm shadow-md shadow-lime-950/20 cursor-pointer"
        >
          <FolderOpen className="w-4 h-4 text-zinc-950" />
          <span>Create Collection</span>
        </button>
      </div>

      {/* Collections Catalog Section */}
      <div className="w-full space-y-6">
        <div className="glass-panel rounded-3xl overflow-hidden border border-zinc-800/60 bg-[#0d0d12]/80 backdrop-blur-xl">
          <div className="p-6 border-b border-zinc-900 flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-lime-400" />
            <h3 className="text-md font-bold text-zinc-100">Collections Catalog</h3>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-12 text-center text-zinc-500 font-semibold">Loading collections...</div>
            ) : collections.length === 0 ? (
              <div className="p-12 text-center text-zinc-500 flex flex-col items-center">
                <FolderOpen className="w-10 h-10 text-zinc-700 mb-3" />
                <span>No collections active. Compile watermarks to get started!</span>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-950/40 text-xs font-bold uppercase text-zinc-400 border-b border-zinc-900">
                    <th className="p-4 pl-6">Collection Name</th>
                    <th className="p-4">Source Video</th>
                    <th className="p-4">Watermarks</th>
                    <th className="p-4">Outputs</th>
                    <th className="p-4 text-right pr-6">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {collections.map((col) => {
                    return (
                      <tr 
                        key={col.id} 
                        className="hover:bg-zinc-900/10 transition-all border-b border-zinc-800/20"
                      >
                        <td className="p-4 pl-6 font-bold text-white text-sm">{col.name}</td>
                        <td className="p-4 flex items-center gap-3">
                          <div className="w-10 h-12 rounded overflow-hidden bg-zinc-950 border border-zinc-800 shrink-0">
                            <img 
                              src={col.video_thumbnail ? (col.video_thumbnail.startsWith("http") ? col.video_thumbnail : `${API_URL}${col.video_thumbnail}`) : "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe"} 
                              className="w-full h-full object-cover" 
                              alt=""
                            />
                          </div>
                          <span className="text-sm font-semibold text-zinc-300 line-clamp-1 max-w-[120px]">{col.video_title}</span>
                        </td>
                        <td className="p-4 text-sm font-semibold text-zinc-400">{col.watermarks_count} active</td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-3">
                            {col.items && col.items.length > 0 ? (
                              col.items.map((item) => (
                                <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-zinc-950/40 border border-zinc-900/60 min-w-[240px] max-w-[320px]">
                                  <div className="space-y-0.5 flex-1 min-w-0">
                                    <div className="text-[11px] font-bold text-zinc-300 truncate" title={item.watermark_name}>
                                      {item.watermark_name}
                                    </div>
                                    <div className="text-[9px] font-semibold text-zinc-550">
                                      Preset: {item.position} • Scale: {item.scale}%
                                    </div>
                                  </div>
                                  
                                  <div className="shrink-0">
                                    {item.status === "processing" && (
                                      <span className="text-amber-450 text-[10px] font-bold animate-pulse flex items-center gap-1">
                                        <svg className="animate-spin h-3 w-3 text-amber-400" viewBox="0 0 24 24" fill="none">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        Rendering
                                      </span>
                                    )}
                                    {item.status === "failed" && (
                                      <span className="text-rose-450 text-[10px] font-bold flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        Failed
                                      </span>
                                    )}
                                    {item.status === "ready" && (
                                      <span className="text-emerald-450 text-[10px] font-bold flex items-center gap-1">
                                        <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                        Ready
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <span className="text-xs text-zinc-550">No outputs generated</span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 pr-6 text-right relative">
                          <div className="flex items-center justify-end gap-2.5">
                            {col.items && col.items.filter(item => item.status === "ready").map((item) => (
                              <button
                                key={item.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewOutputUrl(`${API_URL}${item.output_url}`);
                                  setPreviewTitle(item.watermark_name || "Output Preview");
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-[#18D6B0]/10 border border-[#18D6B0]/55 text-[#DFFFF8] hover:bg-[#18D6B0] hover:border-[#18D6B0] hover:text-[#04110F] text-[10px] font-bold transition-all duration-300 inline-flex items-center gap-1 cursor-pointer"
                                title={`Preview ${item.watermark_name}`}
                              >
                                <Play className="w-2.5 h-2.5" /> Preview
                              </button>
                            ))}

                            {/* Dropdown Container for More Actions (Delete) */}
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveDropdown(activeDropdown === col.id ? null : col.id);
                                }}
                                className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition inline-flex items-center justify-center cursor-pointer"
                                title="More actions"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>

                              {activeDropdown === col.id && (
                                <>
                                  {/* Click outside overlay to close */}
                                  <div 
                                    className="fixed inset-0 z-30" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveDropdown(null);
                                    }}
                                  />
                                  
                                  {/* Dropdown Menu */}
                                  <div className="absolute right-0 mt-2 w-48 rounded-xl border border-zinc-800 bg-[#0d0d12]/95 backdrop-blur-xl p-1.5 shadow-2xl z-40 text-left space-y-1">
                                    {col.items && col.items.filter(item => item.status === "ready").map((item) => (
                                      <a
                                        key={item.id}
                                        href={`${API_URL}${item.output_url}`}
                                        download={item.watermark_name ? `watermarked_${item.watermark_name}.mp4` : `watermarked_${item.id}.mp4`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={() => setActiveDropdown(null)}
                                        className="w-full px-3 py-2 rounded-lg hover:bg-zinc-800/80 transition text-xs font-semibold text-zinc-200 flex items-center gap-2 cursor-pointer"
                                      >
                                        <Download className="w-3.5 h-3.5 text-lime-400" />
                                        <span>Download {col.items.filter(i => i.status === "ready").length > 1 ? `(${item.watermark_name.substring(0, 8)}...)` : ""}</span>
                                      </a>
                                    ))}

                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteCollection(col.id);
                                        setActiveDropdown(null);
                                      }}
                                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-rose-950/30 text-rose-450 hover:text-rose-400 transition text-xs font-semibold flex items-center gap-2 cursor-pointer"
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
      </div>

      {/* Creation Wizard Dialog/Overlay */}
      {isWizardOpen && (
        <div className="fixed top-0 bottom-0 left-0 md:left-[200px] right-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md overflow-y-auto p-4 sm:p-6">
          <div className="glass-panel w-full max-w-5xl xl:max-w-6xl p-6 sm:p-8 rounded-3xl relative shadow-2xl animate-scale-up border border-zinc-800 bg-[#0d0d12]/95 backdrop-blur-xl my-auto max-h-[92vh] flex flex-col">
            <button
              onClick={() => setIsWizardOpen(false)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-white transition flex items-center justify-center w-8 h-8 rounded-full hover:bg-zinc-850 cursor-pointer z-10"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="mb-5 shrink-0">
              <h3 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-lime-400" />
                <span>Compile Video Collection</span>
              </h3>
              <p className="text-xs text-zinc-400 mt-1">Select source video, configure watermark overlays with live real-time preview, and generate your batch.</p>
            </div>

            <form onSubmit={handleWizardSubmit} className="flex-1 overflow-y-auto pr-1">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Left Column: Form Controls */}
                <div className="lg:col-span-7 space-y-5">
                  {/* Collection Name */}
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Collection Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Summer Trend TikToks"
                      value={collectionName}
                      onChange={(e) => setCollectionName(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl bg-[#13131a]/85 border border-zinc-800/80 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 transition-all text-sm"
                    />
                  </div>

                  {/* Select Source Video */}
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Select Source Video</label>
                    <select
                      required
                      value={selectedVideoId}
                      onChange={(e) => {
                        setSelectedVideoId(e.target.value);
                      }}
                      className="w-full px-4 py-2.5 rounded-xl bg-[#13131a]/85 border border-zinc-800/80 focus:outline-none focus:ring-2 focus:ring-lime-400 text-zinc-100 transition-all text-sm cursor-pointer"
                    >
                      {videos.map(v => (
                        <option key={v.id} value={v.id}>{v.title}</option>
                      ))}
                    </select>
                  </div>

                  {/* Select Watermarks Multi-select */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Select Watermarks</label>
                      <span className="text-[10px] text-zinc-500">{selectedWatermarkConfigs.length} selected</span>
                    </div>
                    {watermarks.length === 0 ? (
                      <p className="text-xs text-rose-400">No active watermarks library. Upload watermark overlays first!</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2.5 max-h-36 overflow-y-auto p-2 bg-[#13131a]/40 rounded-xl border border-zinc-850">
                        {watermarks.map(wm => {
                          const isChecked = !!selectedWatermarkConfigs.find(c => c.watermark_id === wm.id);
                          return (
                            <div
                              key={wm.id}
                              onClick={() => handleWatermarkToggle(wm.id)}
                              className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all duration-200 ${
                                isChecked 
                                  ? "bg-lime-400/15 border-lime-400 text-lime-400 shadow-[0_0_10px_rgba(163,230,53,0.08)]" 
                                  : "bg-zinc-900/20 border-zinc-850 hover:border-zinc-700"
                              }`}
                            >
                              <input 
                                type="checkbox" 
                                checked={isChecked} 
                                readOnly 
                                className="pointer-events-none rounded accent-lime-400 shrink-0" 
                              />
                              <span className="text-xs font-semibold text-zinc-300 line-clamp-1">{wm.original_name}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Overlay coordinates adjustments per watermark */}
                  {selectedWatermarkConfigs.length > 0 && (
                    <div className="space-y-3 pt-2 border-t border-zinc-850">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-lime-400 tracking-wider">
                          <Sparkles className="w-3.5 h-3.5 text-lime-400" />
                          <span>Configure Overlay Position per Watermark</span>
                        </div>
                        <span className="text-[10px] text-zinc-500">Click a card to highlight in preview</span>
                      </div>

                      <div className="space-y-3.5 max-h-[36vh] overflow-y-auto pr-1">
                        {selectedWatermarkConfigs.map((config) => {
                          const wm = watermarks.find(w => w.id === config.watermark_id);
                          if (!wm) return null;
                          const isFocused = focusedWatermarkId === config.watermark_id;

                          return (
                            <div 
                              key={config.watermark_id} 
                              onClick={() => setFocusedWatermarkId(config.watermark_id)}
                              className={`p-4 rounded-xl transition-all duration-200 cursor-pointer space-y-3.5 ${
                                isFocused
                                  ? "bg-[#181824] border-2 border-lime-400 shadow-[0_0_15px_rgba(163,230,53,0.12)]"
                                  : "bg-[#13131a]/60 border border-zinc-850 hover:border-zinc-750"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-bold text-sm text-lime-400 line-clamp-1">{wm.original_name}</h4>
                                  {isFocused && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-lime-400 text-zinc-950 tracking-wider">
                                      Active in Preview
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleWatermarkToggle(config.watermark_id);
                                  }}
                                  className="text-zinc-500 hover:text-rose-400 transition p-1 cursor-pointer"
                                  title="Remove watermark"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              {/* Position Preset selector */}
                              <div onClick={(e) => e.stopPropagation()}>
                                <span className="text-[10px] uppercase font-bold text-zinc-500 block mb-1.5">Preset Position</span>
                                <div className="flex gap-1.5 flex-wrap">
                                  {[
                                    { preset: "top-left", icon: <ArrowUpLeft className="w-3.5 h-3.5" />, label: "Top Left" },
                                    { preset: "top-center", icon: <ArrowUp className="w-3.5 h-3.5" />, label: "Top Center" },
                                    { preset: "top-right", icon: <ArrowUpRight className="w-3.5 h-3.5" />, label: "Top Right" },
                                    { preset: "center", icon: <Minimize2 className="w-3.5 h-3.5" />, label: "Center" },
                                    { preset: "bottom-left", icon: <ArrowDownLeft className="w-3.5 h-3.5" />, label: "Bottom Left" },
                                    { preset: "bottom-center", icon: <ArrowDown className="w-3.5 h-3.5" />, label: "Bottom Center" },
                                    { preset: "bottom-right", icon: <ArrowDownRight className="w-3.5 h-3.5" />, label: "Bottom Right" }
                                  ].map(pos => (
                                    <button
                                      key={pos.preset}
                                      type="button"
                                      onClick={() => handleConfigChange(config.watermark_id, "position", pos.preset)}
                                      className={`w-8 h-8 rounded-lg border transition-all flex items-center justify-center cursor-pointer ${
                                        config.position === pos.preset 
                                          ? "bg-lime-400 text-zinc-950 border-lime-400 shadow-md shadow-lime-950/20 font-bold" 
                                          : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                                      }`}
                                      title={pos.label}
                                    >
                                      {pos.icon}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Offset sliders & scale */}
                              <div className="grid grid-cols-3 gap-3" onClick={(e) => e.stopPropagation()}>
                                <div>
                                  <div className="flex justify-between text-[10px] font-bold text-zinc-500 mb-1">
                                    <span>Offset X</span>
                                    <span className="text-zinc-400">{config.offset_x}px</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={config.offset_x}
                                    onChange={(e) => handleConfigChange(config.watermark_id, "offset_x", parseInt(e.target.value))}
                                    className="w-full accent-lime-400 cursor-pointer"
                                  />
                                </div>

                                <div>
                                  <div className="flex justify-between text-[10px] font-bold text-zinc-500 mb-1">
                                    <span>Offset Y</span>
                                    <span className="text-zinc-400">{config.offset_y}px</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={config.offset_y}
                                    onChange={(e) => handleConfigChange(config.watermark_id, "offset_y", parseInt(e.target.value))}
                                    className="w-full accent-lime-400 cursor-pointer"
                                  />
                                </div>

                                <div>
                                  <div className="flex justify-between text-[10px] font-bold text-zinc-500 mb-1">
                                    <span>Scale width</span>
                                    <span className="text-zinc-400">{config.scale}%</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="10"
                                    max="80"
                                    value={config.scale}
                                    onChange={(e) => handleConfigChange(config.watermark_id, "scale", parseInt(e.target.value))}
                                    className="w-full accent-lime-400 cursor-pointer"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Column: Live Interactive Video Overlay Preview */}
                <div className="lg:col-span-5 flex flex-col items-center">
                  <div className="w-full sticky top-0 space-y-3 bg-[#13131a]/40 p-4 rounded-2xl border border-zinc-850">
                    <div className="flex items-center justify-between w-full px-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-lime-400 animate-pulse" />
                        <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">Real-time Overlay Preview</span>
                      </div>
                      {selectedWatermarkConfigs.length > 1 && (
                        <div className="flex items-center gap-1 bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-800">
                          <button
                            type="button"
                            onClick={() => setFocusedWatermarkId(null)}
                            className={`px-2 py-0.5 text-[10px] font-medium rounded transition cursor-pointer ${
                              focusedWatermarkId === null 
                                ? "bg-lime-400 text-zinc-950 font-bold" 
                                : "text-zinc-400 hover:text-white"
                            }`}
                          >
                            All ({selectedWatermarkConfigs.length})
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Phone/Reel Preview Canvas (9:16 Aspect Ratio) */}
                    <div className="relative w-full max-w-[260px] sm:max-w-[280px] aspect-[9/16] mx-auto rounded-2xl overflow-hidden bg-black border border-zinc-800 shadow-2xl flex items-center justify-center group">
                      {selectedVideo ? (
                        <>
                          <video
                            key={selectedVideo.id}
                            src={getVideoUrl(selectedVideo)}
                            autoPlay
                            loop
                            muted={isMuted}
                            playsInline
                            onLoadedMetadata={(e) => {
                              if (e.currentTarget.videoWidth && e.currentTarget.videoHeight) {
                                setPreviewDimensions({
                                  w: e.currentTarget.videoWidth,
                                  h: e.currentTarget.videoHeight
                                });
                              }
                            }}
                            ref={(el) => {
                              if (el) {
                                if (isPlaying) {
                                  el.play().catch(() => {});
                                } else {
                                  el.pause();
                                }
                              }
                            }}
                            className="w-full h-full object-cover"
                          />

                          {/* Watermarks Overlay Layer */}
                          <div className="absolute inset-0 pointer-events-none overflow-hidden">
                            {selectedWatermarkConfigs.map((config) => {
                              const wm = watermarks.find(w => w.id === config.watermark_id);
                              if (!wm) return null;

                              const isFocused = focusedWatermarkId === config.watermark_id || focusedWatermarkId === null;
                              const isSingleFocused = focusedWatermarkId === config.watermark_id;
                              
                              // Coordinates calculated proportionally to source video resolution (exact FFmpeg match)
                              const xPercent = (config.offset_x / (previewDimensions.w || 1080)) * 100;
                              const yPercent = (config.offset_y / (previewDimensions.h || 1920)) * 100;

                              const positionStyles: React.CSSProperties = {
                                position: "absolute",
                                width: `${config.scale}%`,
                                zIndex: isSingleFocused ? 20 : 10,
                                opacity: isFocused ? 1 : 0.45,
                                transition: "all 0.15s ease-out"
                              };

                              switch (config.position) {
                                case "top-left":
                                  positionStyles.top = `${yPercent}%`;
                                  positionStyles.left = `${xPercent}%`;
                                  break;
                                case "top-center":
                                  positionStyles.top = `${yPercent}%`;
                                  positionStyles.left = "50%";
                                  positionStyles.transform = "translateX(-50%)";
                                  break;
                                case "top-right":
                                  positionStyles.top = `${yPercent}%`;
                                  positionStyles.right = `${xPercent}%`;
                                  break;
                                case "center":
                                  positionStyles.top = "50%";
                                  positionStyles.left = "50%";
                                  positionStyles.transform = "translate(-50%, -50%)";
                                  break;
                                case "bottom-left":
                                  positionStyles.bottom = `${yPercent}%`;
                                  positionStyles.left = `${xPercent}%`;
                                  break;
                                case "bottom-center":
                                  positionStyles.bottom = `${yPercent}%`;
                                  positionStyles.left = "50%";
                                  positionStyles.transform = "translateX(-50%)";
                                  break;
                                case "bottom-right":
                                default:
                                  positionStyles.bottom = `${yPercent}%`;
                                  positionStyles.right = `${xPercent}%`;
                                  break;
                              }

                              const isVideoWatermark = wm.filename.toLowerCase().endsWith(".webm") || wm.filename.toLowerCase().endsWith(".mov");

                              return (
                                <div
                                  key={config.watermark_id}
                                  style={positionStyles}
                                  className={`relative transition-all ${
                                    isSingleFocused 
                                      ? "ring-2 ring-lime-400 ring-offset-1 ring-offset-black/60 shadow-[0_0_15px_rgba(163,230,53,0.5)]" 
                                      : ""
                                  }`}
                                >
                                  {isVideoWatermark ? (
                                    <video
                                      src={getWatermarkUrl(wm)}
                                      autoPlay
                                      loop
                                      muted
                                      playsInline
                                      className="w-full h-auto object-contain"
                                    />
                                  ) : (
                                    <img
                                      src={getWatermarkUrl(wm)}
                                      alt={wm.original_name}
                                      className="w-full h-auto object-contain"
                                    />
                                  )}

                                  {isSingleFocused && (
                                    <div className="absolute -top-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-lime-400 text-zinc-950 font-extrabold text-[9px] whitespace-nowrap shadow-md">
                                      {wm.original_name}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Quick Controls Bar on bottom */}
                          <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-80 hover:opacity-100 transition-opacity bg-black/70 backdrop-blur-md px-2 py-1 rounded-full border border-zinc-700/60 shadow-lg">
                            <button
                              type="button"
                              onClick={() => setIsPlaying(!isPlaying)}
                              className="text-zinc-300 hover:text-white transition p-0.5 cursor-pointer"
                              title={isPlaying ? "Pause video" : "Play video"}
                            >
                              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsMuted(!isMuted)}
                              className="text-zinc-300 hover:text-white transition p-0.5 cursor-pointer"
                              title={isMuted ? "Unmute video" : "Mute video"}
                            >
                              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                            </button>
                          </div>

                          {selectedWatermarkConfigs.length === 0 && (
                            <div className="absolute inset-x-3 bottom-12 bg-black/85 backdrop-blur-md p-2.5 rounded-xl border border-zinc-800 text-center animate-fade-in">
                              <p className="text-[11px] text-zinc-300 font-medium">Select watermarks on the left to see live overlay placement.</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-center p-6 space-y-3">
                          <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-600">
                            <Video className="w-6 h-6" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-zinc-300">No Video Selected</p>
                            <p className="text-[10px] text-zinc-500 mt-1">Select a video on the left to preview</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Resolution / Metadata Tag */}
                    {selectedVideo && (
                      <div className="text-center">
                        <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900/80 px-2.5 py-1 rounded-full border border-zinc-800">
                          {previewDimensions.w}x{previewDimensions.h}px • {selectedWatermarkConfigs.length} overlay{selectedWatermarkConfigs.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 mt-6 border-t border-zinc-850 pt-4 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsWizardOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition font-semibold text-sm cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!collectionName || !selectedVideoId || selectedWatermarkConfigs.length === 0}
                  className="px-6 py-2 bg-lime-400 hover:bg-lime-500 disabled:opacity-50 text-zinc-950 font-bold rounded-xl transition-all duration-300 text-sm shadow-md shadow-lime-950/20 flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-4 h-4 text-zinc-950" />
                  <span>Generate Collection</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HTML5 Native Video Preview Modal for Outputs */}
      {previewOutputUrl && (
        <div className="fixed top-0 bottom-0 left-0 md:left-[200px] right-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-xl p-6 rounded-3xl relative shadow-2xl animate-scale-up border border-zinc-800 bg-[#0d0d12]/95 backdrop-blur-xl">
            <button
              onClick={() => setPreviewOutputUrl(null)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-white transition flex items-center justify-center w-8 h-8 rounded-full hover:bg-zinc-850 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <h3 className="text-xl font-bold text-white mb-2 line-clamp-1">{previewTitle}</h3>
            <p className="text-xs text-zinc-400 mb-4">Branded watermarked output video preview.</p>

            <div className="w-full aspect-[9/16] max-h-[60vh] rounded-xl overflow-hidden bg-black border border-zinc-800 relative flex items-center justify-center">
              <video
                src={previewOutputUrl}
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
