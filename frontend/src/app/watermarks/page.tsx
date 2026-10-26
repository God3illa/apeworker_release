"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../AuthProvider";
import { 
  Sparkles, 
  Upload, 
  Trash2, 
  Play, 
  Download,
  Eye, 
  X, 
  Layers, 
  Info, 
  CheckCircle, 
  AlertCircle,
  RefreshCw,
  MoreVertical
} from "lucide-react";

interface Watermark {
  id: string;
  filename: string;
  original_name: string;
  duration: number;
  created_at: string;
}

export default function Watermarks() {
  const { getToken } = useAuth();
  const [watermarks, setWatermarks] = useState<Watermark[]>([]);
  const [loading, setLoading] = useState(true);

  // Dropdown states for Actions
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // File Upload states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Preview video player
  const [activePlayerWm, setActivePlayerWm] = useState<Watermark | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const fetchWatermarks = async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/watermarks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to load watermarks list");
      const data = await res.json();
      setWatermarks(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWatermarks();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext !== "webm" && ext !== "mov") {
        setErrorMessage("Only WebM and MOV files with transparency are supported!");
        setUploadStatus("error");
        return;
      }
      setSelectedFile(file);
      setUploadStatus("idle");
      setErrorMessage("");
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploadStatus("uploading");
    setErrorMessage("");

    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch(`${API_URL}/api/watermarks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Upload pipeline failed");
      }

      setUploadStatus("success");
      setSelectedFile(null);
      fetchWatermarks();
    } catch (err: any) {
      setUploadStatus("error");
      setErrorMessage(err.message || "An unexpected error occurred during upload.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this watermark from storage?")) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/watermarks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setWatermarks(watermarks.filter(w => w.id !== id));
      }
    } catch (e) {
      console.error("Error deleting watermark", e);
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-8 animate-fade-in relative">
      {/* Ambient background glow in cosmic theme */}
      <div className="absolute top-[-100px] left-[25%] w-[450px] h-[450px] bg-lime-400/5 rounded-full blur-[120px] pointer-events-none -z-10" />

      {/* Header */}
      <div>
        <h1 className="text-4xl font-extrabold text-lime-400 tracking-tight">
          Watermarks Library
        </h1>
        <p className="text-zinc-400 mt-1.5 text-sm">Upload and manage transparency overlay animations (WebM or MOV).</p>
      </div>

      {/* Upload Box Console */}
      <div className="glass-panel p-6 rounded-3xl relative overflow-hidden border border-zinc-800/60 bg-[#0d0d12]/80 backdrop-blur-xl">
        <div className="absolute -top-10 -right-10 w-48 h-48 bg-lime-400/10 rounded-full blur-[60px] pointer-events-none" />
        
        <h2 className="text-md font-bold text-zinc-100 mb-2 flex items-center gap-2.5">
          <Upload className="w-5 h-5 text-lime-400" />
          <span>Upload transparent watermark overlay</span>
        </h2>
        <p className="text-xs text-zinc-400 mb-6">File format MUST be WebM or MOV containing transparent channels (Alpha transparency).</p>

        <form onSubmit={handleUploadSubmit} className="space-y-4">
          <div className="border-2 border-dashed border-zinc-800 hover:border-zinc-700/80 transition-all rounded-2xl p-8 text-center bg-[#13131a]/40 relative cursor-pointer group">
            <input
              type="file"
              required
              accept=".webm,.mov"
              onChange={handleFileChange}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <div className="space-y-3 pointer-events-none">
              <Sparkles className="w-8 h-8 text-lime-400 mx-auto transition-transform group-hover:scale-110" />
              <p className="text-sm font-semibold text-zinc-200">
                {selectedFile ? selectedFile.name : "Drag & drop files or click here to upload"}
              </p>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500">
                WebM / MOV transparency-preserved format
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {/* Status logs */}
            <div className="text-xs font-semibold">
              {uploadStatus === "uploading" && (
                <span className="text-lime-400 animate-pulse flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Streaming overlay to database...
                </span>
              )}
              {uploadStatus === "success" && (
                <span className="text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Watermark added successfully!
                </span>
              )}
              {uploadStatus === "error" && (
                <span className="text-rose-450 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Error: {errorMessage}
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={!selectedFile || uploadStatus === "uploading"}
              className="px-6 py-2.5 bg-lime-400 hover:bg-lime-500 disabled:opacity-40 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 font-bold rounded-xl transition-all duration-300 text-sm shadow-md shadow-lime-950/20 cursor-pointer flex items-center justify-center gap-2 shrink-0"
            >
              <Upload className="w-4 h-4" />
              <span>Upload Watermark</span>
            </button>
          </div>
        </form>
      </div>

      {/* Watermarks library list */}
      <div className="glass-panel rounded-3xl overflow-hidden border border-zinc-800/60 bg-[#0d0d12]/80 backdrop-blur-xl">
        <div className="p-6 border-b border-zinc-900">
          <h3 className="text-md font-bold text-zinc-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-lime-400" />
            <span>Watermark Library</span>
          </h3>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-zinc-500 font-semibold">Loading watermarks catalog...</div>
          ) : watermarks.length === 0 ? (
            <div className="p-12 text-center text-zinc-500 flex flex-col items-center">
              <Layers className="w-10 h-10 text-zinc-700 mb-3" />
              <span>No watermarks active. Upload transparent files above to begin collections pipeline!</span>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-950/40 text-xs font-bold uppercase text-zinc-400 border-b border-zinc-900">
                  <th className="p-4 pl-6">Loop Preview</th>
                  <th className="p-4">Filename</th>
                  <th className="p-4">Duration</th>
                  <th className="p-4">Uploaded At</th>
                  <th className="p-4 pr-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {watermarks.map((wm) => (
                  <tr key={wm.id} className="hover:bg-zinc-900/20 transition-all">
                    {/* Continuous transparency preview thumbnail */}
                    <td className="p-4 pl-6">
                      <div
                        onClick={() => setActivePlayerWm(wm)}
                        className="w-[130px] h-16 rounded-xl overflow-hidden border border-zinc-800 bg-[size:10px_10px] bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[#27272a] cursor-pointer relative group flex items-center justify-center"
                      >
                        <video
                          src={`${API_URL}/uploads/watermarks/${wm.filename}`}
                          autoPlay
                          loop
                          muted
                          playsInline
                          className="w-full h-full object-contain"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                          <Eye className="w-4 h-4 text-white" />
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <h4 className="font-bold text-white text-sm">{wm.original_name}</h4>
                      <span className="text-[10px] text-zinc-550 font-mono block mt-0.5">{wm.id}</span>
                    </td>
                    <td className="p-4 font-semibold text-zinc-200 text-sm">{formatDuration(wm.duration)}</td>
                    <td className="p-4 text-xs text-zinc-500">{new Date(wm.created_at).toLocaleDateString()}</td>
                    <td className="p-4 pr-6 text-right relative">
                      <div className="flex items-center justify-end gap-2.5">
                        <button
                          onClick={() => setActivePlayerWm(wm)}
                          className="px-3 py-1.5 rounded-lg bg-[#18D6B0]/10 border border-[#18D6B0]/55 text-[#DFFFF8] hover:bg-[#18D6B0] hover:border-[#18D6B0] hover:text-[#04110F] text-xs font-semibold transition-all duration-300 cursor-pointer inline-flex items-center gap-1.5"
                        >
                          <Play className="w-3 h-3" /> Preview
                        </button>

                        {/* Dropdown Container for More Actions (Delete) */}
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDropdown(activeDropdown === wm.id ? null : wm.id);
                            }}
                            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition inline-flex items-center justify-center cursor-pointer"
                            title="More actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {activeDropdown === wm.id && (
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
                              <div className="absolute right-0 mt-2 w-36 rounded-xl border border-zinc-800 bg-[#0d0d12]/95 backdrop-blur-xl p-1.5 shadow-2xl z-40 text-left space-y-1">
                                <a
                                  href={`${API_URL}/uploads/watermarks/${wm.filename}`}
                                  download={wm.original_name}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() => setActiveDropdown(null)}
                                  className="w-full px-3 py-2 rounded-lg hover:bg-zinc-800/80 transition text-xs font-semibold text-zinc-200 flex items-center gap-2 cursor-pointer"
                                >
                                  <Download className="w-3.5 h-3.5 text-lime-400" />
                                  <span>Download</span>
                                </a>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(wm.id);
                                    setActiveDropdown(null);
                                  }}
                                  className="w-full text-left px-3 py-2 rounded-lg text-rose-450 hover:bg-rose-950/30 text-xs font-semibold cursor-pointer flex items-center gap-2"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Delete
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Watermark Checkerboard Grid Player Modal */}
      {activePlayerWm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-xl p-6 rounded-3xl relative shadow-2xl animate-scale-up border border-zinc-800 bg-[#0d0d12]/95 backdrop-blur-xl">
            <button
              onClick={() => setActivePlayerWm(null)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-white transition flex items-center justify-center w-8 h-8 rounded-full hover:bg-zinc-850 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <h3 className="text-xl font-bold text-white mb-2 line-clamp-1">{activePlayerWm.original_name}</h3>
            <p className="text-xs text-zinc-400 mb-4">Transparency checkerboard grid visualization.</p>

            {/* Checkerboard CSS background overlay player */}
            <div
              className="w-full aspect-video rounded-xl overflow-hidden relative flex items-center justify-center border border-zinc-800"
              style={{
                backgroundImage: "linear-gradient(45deg, #18181b 25%, transparent 25%), linear-gradient(-45deg, #18181b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #18181b 75%), linear-gradient(-45deg, transparent 75%, #18181b 75%)",
                backgroundSize: "20px 20px",
                backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
                backgroundColor: "#27272a"
              }}
            >
              <video
                src={`${API_URL}/uploads/watermarks/${activePlayerWm.filename}`}
                controls
                autoPlay
                loop
                className="max-w-full max-h-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
