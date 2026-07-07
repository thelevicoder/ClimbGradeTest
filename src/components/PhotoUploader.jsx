import React, { useRef, useState } from "react";
import { Camera, X, Image, Upload } from "lucide-react";
import { api } from "@/api/client";

export default function PhotoUploader({ imageUrl, onImageUploaded, isUploading, setIsUploading }) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setIsUploading(true);
    try {
      const { file_url } = await api.uploadFile(file);
      onImageUploaded(file_url);
    } catch (error) {
      console.error("Upload failed:", error);
      alert("Upload failed: " + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  if (imageUrl) {
    return (
      <div className="relative rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800/60">
        <img src={imageUrl} alt="Climbing wall" className="w-full max-h-72 object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <button
          onClick={(e) => { e.stopPropagation(); onImageUploaded(null); }}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/70 hover:bg-black/90 text-white flex items-center justify-center transition-colors border border-white/10"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-white/60 text-xs">
          <Image className="w-3.5 h-3.5" />
          Photo ready
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-300 select-none
          flex flex-col items-center justify-center gap-5 py-16 px-8 text-center
          ${dragOver
            ? 'border-orange-500/70 bg-orange-500/5'
            : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900/50'}
        `}
      >
        {isUploading ? (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-2 border-zinc-800 border-t-orange-500 rounded-full animate-spin" />
            <p className="text-zinc-400 text-sm">Uploading photo...</p>
          </div>
        ) : (
          <>
            <div className={`w-18 h-18 rounded-2xl flex items-center justify-center transition-colors ${
              dragOver ? 'bg-orange-500/15' : 'bg-zinc-900'
            }`} style={{ width: 72, height: 72 }}>
              {dragOver
                ? <Upload className="w-8 h-8 text-orange-400" />
                : <Camera className="w-8 h-8 text-zinc-600" />
              }
            </div>

            <div className="space-y-1.5">
              <p className="text-white font-semibold text-[15px]">
                {dragOver ? 'Drop to upload' : 'Upload a wall photo'}
              </p>
              <p className="text-zinc-600 text-sm">Drag & drop or tap to browse</p>
            </div>

            <div className="flex gap-2">
              {['JPG', 'PNG', 'HEIC', 'WEBP'].map(ext => (
                <span key={ext} className="text-[11px] font-medium text-zinc-600 bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-lg">
                  {ext}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files[0])}
      />
    </>
  );
}
