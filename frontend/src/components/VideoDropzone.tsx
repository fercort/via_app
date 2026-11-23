import React, { useCallback, useRef, useState } from "react";
import { AlertCircle, Film, RefreshCw, UploadCloud } from "lucide-react";

import { ExtractedVideoFrame } from "../types";

interface VideoDropzoneProps {
  currentVideo: ExtractedVideoFrame | null;
  disabled?: boolean;
  onVideoLoaded: (extracted: ExtractedVideoFrame) => void;
}

const ACCEPTED_EXTENSIONS = [".mp4", ".avi", ".mov"];

function isSupportedVideoFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const VideoDropzone: React.FC<VideoDropzoneProps> = ({
  currentVideo,
  disabled = false,
  onVideoLoaded,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const extractFirstFrame = useCallback(
    async (file: File) => {
      if (!isSupportedVideoFile(file)) {
        setErrorMsg("Formato inválido. Solo se admiten archivos .mp4, .avi o .mov.");
        return;
      }

      const video = hiddenVideoRef.current;
      const canvas = captureCanvasRef.current;
      if (!video || !canvas) {
        return;
      }

      setErrorMsg(null);
      setIsExtracting(true);

      const objectUrl = URL.createObjectURL(file);

      try {
        const extracted = await new Promise<ExtractedVideoFrame>((resolve, reject) => {
          let settled = false;

          const cleanup = () => {
            video.removeEventListener("loadeddata", handleLoadedData);
            video.removeEventListener("seeked", handleSeeked);
            video.removeEventListener("error", handleError);
            video.removeAttribute("src");
            video.load();
            URL.revokeObjectURL(objectUrl);
          };

          const captureFrame = () => {
            if (settled) return;
            const width = video.videoWidth;
            const height = video.videoHeight;
            if (!width || !height) {
              settled = true;
              cleanup();
              reject(new Error("El video no reporta dimensiones válidas en el navegador."));
              return;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              settled = true;
              cleanup();
              reject(new Error("No se pudo inicializar el contexto 2D del canvas."));
              return;
            }

            ctx.drawImage(video, 0, 0, width, height);
            const frameDataUrl = canvas.toDataURL("image/jpeg", 0.92);
            const duration = Number.isFinite(video.duration) ? video.duration : 0;

            settled = true;
            cleanup();
            resolve({
              file,
              frameDataUrl,
              width,
              height,
              duration,
            });
          };

          const handleSeeked = () => {
            captureFrame();
          };

          const handleLoadedData = () => {
            const targetTime =
              Number.isFinite(video.duration) && video.duration > 0.15 ? 0.1 : 0;

            if (targetTime > 0 && Math.abs(video.currentTime - targetTime) > 0.01) {
              video.currentTime = targetTime;
            } else {
              captureFrame();
            }
          };

          const handleError = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(
              new Error(
                "El navegador no pudo decodificar este códec de video localmente. Prueba con .mp4 (H.264) o .mov."
              )
            );
          };

          video.addEventListener("loadeddata", handleLoadedData);
          video.addEventListener("seeked", handleSeeked);
          video.addEventListener("error", handleError);
          video.src = objectUrl;
          video.load();
        });

        onVideoLoaded(extracted);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Error inesperado al procesar el video.";
        setErrorMsg(message);
      } finally {
        setIsExtracting(false);
      }
    },
    [onVideoLoaded]
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (disabled || isExtracting || !files || files.length === 0) return;
      void extractFirstFrame(files[0]);
    },
    [disabled, extractFirstFrame, isExtracting]
  );

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isExtracting) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const openFilePicker = () => {
    if (!disabled && !isExtracting) {
      inputRef.current?.click();
    }
  };

  return (
    <div className="w-full">
      {/* Elementos ocultos para decodificación local y captura exacta del primer fotograma */}
      <video ref={hiddenVideoRef} className="hidden" muted playsInline preload="auto" />
      <canvas ref={captureCanvasRef} className="hidden" />
      <input
        ref={inputRef}
        type="file"
        accept=".mp4,.avi,.mov,video/mp4,video/quicktime,video/x-msvideo"
        className="hidden"
        disabled={disabled || isExtracting}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {currentVideo ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-slate-900/90 px-4 py-3 transition-colors ${
            isDragging
              ? "border-emerald-400 bg-emerald-950/20"
              : "border-slate-800 hover:border-slate-700"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Film className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-100">
                {currentVideo.file.name}
              </p>
              <p className="font-mono text-xs text-slate-400">
                {currentVideo.width} × {currentVideo.height} px ·{" "}
                {formatFileSize(currentVideo.file.size)}
                {currentVideo.duration > 0
                  ? ` · ${currentVideo.duration.toFixed(1)} s`
                  : ""}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={openFilePicker}
            disabled={disabled || isExtracting}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-500/50 hover:bg-slate-700 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isExtracting ? "animate-spin" : ""}`} />
            {isExtracting ? "Extrayendo frame..." : "Cambiar video"}
          </button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={openFilePicker}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openFilePicker();
            }
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-all ${
            isDragging
              ? "border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-500/10"
              : "border-slate-800 bg-slate-900/70 hover:border-cyan-500/60 hover:bg-slate-900"
          } ${disabled || isExtracting ? "pointer-events-none opacity-60" : ""}`}
        >
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/80 text-cyan-400 transition-transform group-hover:scale-105 group-hover:border-emerald-500/40 group-hover:text-emerald-400">
            <UploadCloud className="h-7 w-7" />
          </div>

          <h2 className="text-lg font-bold text-slate-100">
            {isExtracting
              ? "Extrayendo primer fotograma localmente..."
              : "Arrastra y suelta tu video de tráfico aquí"}
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-slate-400">
            O haz clic para explorar archivos{" "}
            <span className="font-mono text-cyan-400">.mp4</span>,{" "}
            <span className="font-mono text-cyan-400">.avi</span> o{" "}
            <span className="font-mono text-cyan-400">.mov</span>. El primer fotograma se
            extrae directamente en tu navegador sin subir el video todavía.
          </p>

          <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300">
            <span>Resolución nativa preservada · Coordenadas normalizadas 0.0–1.0</span>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-xs text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
