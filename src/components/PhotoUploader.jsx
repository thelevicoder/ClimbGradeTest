import React, { useRef, useState } from "react";
import { Camera, X, Upload } from "lucide-react";
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
      <div className="relative rounded-2xl overflow-hidden">
        <img src={imageUrl} alt="Climbing wall" className="w-full max-h-64 object-cover rounded-2xl" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent rounded-2xl" />
        <button
          onClick={(e) => { e.stopPropagation(); onImageUploaded(null); }}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-[#c94a4a] hover:bg-[#b83f3f] text-white flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="absolute bottom-3 left-4 text-white/80 text-xs font-medium">
          Photo uploaded ✓
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
        className={`
          rounded-2xl border-2 border-dashed transition-all duration-200 select-none
          flex flex-col items-center justify-center gap-5 py-12 px-6 text-center
          ${dragOver
            ? 'border-[#4ec9d6] bg-[#4ec9d6]/10'
            : 'border-white/20 bg-[#2e5148]'}
        `}
      >
        {isUploading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-white/20 border-t-[#4ec9d6] rounded-full animate-spin" />
            <p className="text-white/70 text-sm">Uploading...</p>
          </div>
        ) : (
          <>
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors ${
              dragOver ? 'bg-[#4ec9d6]/20' : 'bg-[#254540]'
            }`}>
              {dragOver
                ? <Upload className="w-7 h-7 text-[#4ec9d6]" />
                : <Camera className="w-7 h-7 text-white/40" />
              }
            </div>
            <div>
              <p className="text-white font-semibold text-[15px]">
                {dragOver ? 'Drop to upload' : 'Drag & drop your photo here'}
              </p>
              <p className="text-white/50 text-sm mt-1">or tap the button below</p>
            </div>
          </>
        )}
      </div>

      {!isUploading && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full mt-4 bg-[#4ec9d6] hover:bg-[#3ab9c6] active:bg-[#32aab8] text-white font-bold
            rounded-full py-3 uppercase tracking-widest text-sm transition-all"
        >
          Upload Image
        </button>
      )}

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
