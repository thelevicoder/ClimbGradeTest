import React, { useRef, useState } from "react";
import { Camera, Upload, X, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

export default function PhotoUploader({ imageUrl, onImageUploaded, isUploading, setIsUploading }) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setIsUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    onImageUploaded(file_url);
    setIsUploading(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  return (
    <div className="w-full">
      {!imageUrl ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative cursor-pointer border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center gap-4 transition-all duration-300 ${
            dragOver
              ? "border-orange-400 bg-orange-400/5"
              : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-500 hover:bg-zinc-800/50"
          }`}
        >
          {isUploading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-3 border-zinc-600 border-t-orange-400 rounded-full animate-spin" />
              <p className="text-zinc-400 text-sm">Uploading photo...</p>
            </div>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center">
                <Camera className="w-8 h-8 text-zinc-400" />
              </div>
              <div className="text-center">
                <p className="text-zinc-300 font-medium">Drop your wall photo here</p>
                <p className="text-zinc-500 text-sm mt-1">or tap to take a photo / browse</p>
              </div>
              <div className="flex gap-2 mt-2">
                <span className="text-xs text-zinc-600 bg-zinc-800 px-3 py-1 rounded-full">JPG</span>
                <span className="text-xs text-zinc-600 bg-zinc-800 px-3 py-1 rounded-full">PNG</span>
                <span className="text-xs text-zinc-600 bg-zinc-800 px-3 py-1 rounded-full">HEIC</span>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden group">
          <img src={imageUrl} alt="Climbing wall" className="w-full h-64 sm:h-80 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onImageUploaded(null); }}
            className="absolute top-3 right-3 bg-black/50 hover:bg-black/70 text-white rounded-full h-8 w-8"
          >
            <X className="w-4 h-4" />
          </Button>
          <div className="absolute bottom-3 left-3 flex items-center gap-2 text-white/80 text-sm">
            <Image className="w-4 h-4" />
            <span>Wall photo uploaded</span>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        
        className="hidden"
        onChange={(e) => handleFile(e.target.files[0])}
      />
    </div>
  );
}