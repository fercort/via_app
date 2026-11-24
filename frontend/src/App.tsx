import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  Loader2,
  Pencil,
  Radar,
  RotateCcw,
  Server,
  StopCircle,
  Timer,
  X,
} from "lucide-react";

import { LineCanvasEditor } from "./components/LineCanvasEditor";
import { MetricsGrid } from "./components/MetricsGrid";
import { VideoDropzone } from "./components/VideoDropzone";
import {
  AnalysisConfig,
  ExtractedVideoFrame,
  FrameStrideOption,
  LineMetrics,
  ModelNameOption,
  ResolutionMode,
  StreamEvent,
  VehicleCategory,
  VideoMetadata,
} from "./types";

const API_URL_STORAGE_KEY = "traffic_counter_api_url";
const DEFAULT_API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(
  /\/+$/,
  ""
);

function normalizeApiUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function getInitialApiUrl(): string {
  try {
    const paramUrl = new URLSearchParams(window.location.search).get("api");
    if (paramUrl) {
      const normalized = normalizeApiUrl(paramUrl);
      if (normalized) {
        window.localStorage.setItem(API_URL_STORAGE_KEY, normalized);
        return normalized;
      }
    }
    const storedUrl = window.localStorage.getItem(API_URL_STORAGE_KEY);
    if (storedUrl) {
      const normalized = normalizeApiUrl(storedUrl);
      if (normalized) {
        return normalized;
      }
    }
  } catch {
    // Ignorar errores de acceso a localStorage o window
  }
  return DEFAULT_API_URL;
}

function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = elapsedMs / 1000;
  const mins = Math.floor(totalSeconds / 60);
  const secs = (totalSeconds % 60).toFixed(1).padStart(4, "0");
  return mins > 0 ? `${mins}m ${secs}s` : `${secs} s`;
}

export default function App(): React.ReactElement {
  const [videoData, setVideoData] = useState<ExtractedVideoFrame | null>(null);
  const [lines, setLines] = useState<AnalysisConfig["lines"]>([]);
  const [confidence, setConfidence] = useState<number>(0.35);
  const [frameStride, setFrameStride] = useState<FrameStrideOption>(2);
  const [enabledClasses, setEnabledClasses] = useState<VehicleCategory[]>([
    "car",
    "motorcycle",
    "bus",
    "truck",
  ]);
  const [resolutionMode, setResolutionMode] = useState<ResolutionMode>("native");
  const [motoBoost, setMotoBoost] = useState<boolean>(true);
  const [modelName, setModelName] = useState<ModelNameOption>("yolo26n.pt");

  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [livePreview, setLivePreview] = useState<boolean>(true);
  const [liveFrameDataUrl, setLiveFrameDataUrl] = useState<string | null>(null);
  const [activeDetections, setActiveDetections] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [totalFrames, setTotalFrames] = useState<number>(0);
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<LineMetrics[] | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [processingTimeSec, setProcessingTimeSec] = useState<number | null>(null);
  const [apiUrl, setApiUrl] = useState<string>(getInitialApiUrl);
  const [isEditingApiUrl, setIsEditingApiUrl] = useState<boolean>(false);
  const [apiUrlDraft, setApiUrlDraft] = useState<string>("");
  const [apiHealth, setApiHealth] = useState<"checking" | "online" | "offline">("checking");

  const abortControllerRef = useRef<AbortController | null>(null);
  const timerStartRef = useRef<number | null>(null);

  // Cronómetro en vivo durante la inferencia
  useEffect(() => {
    if (!isAnalyzing) {
      return;
    }

    timerStartRef.current = performance.now();
    setElapsedMs(0);

    const intervalId = window.setInterval(() => {
      if (timerStartRef.current !== null) {
        setElapsedMs(performance.now() - timerStartRef.current);
      }
    }, 100);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAnalyzing]);

  // Cancelar petición pendiente si el componente se desmonta
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Verificar estado del backend cuando cambia la URL configurada
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 6000);
    setApiHealth("checking");

    fetch(`${apiUrl}/health`, { signal: controller.signal })
      .then((res) => {
        if (!cancelled) {
          setApiHealth(res.ok ? "online" : "offline");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApiHealth("offline");
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [apiUrl]);

  const handleOpenApiUrlEditor = () => {
    if (isAnalyzing) {
      return;
    }
    setApiUrlDraft(apiUrl);
    setIsEditingApiUrl(true);
  };

  const handleSaveApiUrl = (event?: React.FormEvent) => {
    event?.preventDefault();
    const normalized = normalizeApiUrl(apiUrlDraft);
    if (!normalized) {
      return;
    }
    try {
      window.localStorage.setItem(API_URL_STORAGE_KEY, normalized);
    } catch {
      // Ignorar errores de almacenamiento local
    }
    setApiUrl(normalized);
    setIsEditingApiUrl(false);
  };

  const handleResetApiUrl = () => {
    try {
      window.localStorage.removeItem(API_URL_STORAGE_KEY);
    } catch {
      // Ignorar errores de almacenamiento local
    }
    setApiUrl(DEFAULT_API_URL);
    setIsEditingApiUrl(false);
  };

  const handleVideoLoaded = (extracted: ExtractedVideoFrame) => {
    setVideoData(extracted);
    setLines([]);
    setMetrics(null);
    setVideoMetadata(null);
    setProcessingTimeSec(null);
    setErrorMessage(null);
    setLiveFrameDataUrl(null);
    setActiveDetections(0);
    setProgress(0);
    setCurrentFrame(0);
    setTotalFrames(0);
    setElapsedMs(0);
  };

  const handleCancelAnalysis = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsAnalyzing(false);
    setErrorMessage("Análisis cancelado por el usuario.");
  };

  const handleStartAnalysis = async () => {
    if (!videoData || lines.length === 0 || isAnalyzing) {
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsAnalyzing(true);
    setErrorMessage(null);
    setMetrics(null);
    setVideoMetadata(null);
    setProcessingTimeSec(null);
    setLiveFrameDataUrl(null);
    setActiveDetections(0);
    setProgress(0);
    setCurrentFrame(0);
    setTotalFrames(0);

    const configPayload: AnalysisConfig = {
      lines,
      confidence,
      frame_stride: frameStride,
      model_name: modelName,
      live_preview: livePreview,
      enabled_classes: enabledClasses,
      resolution_mode: resolutionMode,
      moto_boost: motoBoost,
    };

    const formData = new FormData();
    formData.append("video", videoData.file);
    formData.append("config", JSON.stringify(configPayload));

    try {
      const response = await fetch(`${apiUrl}/api/analyze`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        let detail = `Error HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(errText) as { detail?: unknown };
          if (typeof parsed.detail === "string") {
            detail = parsed.detail;
          } else if (parsed.detail) {
            detail = JSON.stringify(parsed.detail);
          }
        } catch {
          if (errText) detail = errText;
        }
        throw new Error(detail);
      }

      if (!response.body) {
        throw new Error("El servidor no devolvió un stream de lectura válido.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      const processLine = (rawLine: string) => {
        const trimmed = rawLine.trim();
        if (!trimmed) return;

        const event = JSON.parse(trimmed) as StreamEvent;
        if (event.status === "processing") {
          setProgress(event.progress);
          setCurrentFrame(event.current_frame);
          setTotalFrames(event.total_frames);
          if (event.preview_frame) {
            setLiveFrameDataUrl(event.preview_frame);
          }
          if (event.metrics) {
            setMetrics(event.metrics);
          }
          if (typeof event.active_detections === "number") {
            setActiveDetections(event.active_detections);
          }
        } else if (event.status === "completed") {
          setProgress(100);
          setMetrics(event.metrics);
          setVideoMetadata(event.video_metadata);
          setProcessingTimeSec(event.processing_time_sec);
          setCurrentFrame(event.video_metadata.total_frames);
          setTotalFrames(event.video_metadata.total_frames);
        } else if (event.status === "error") {
          throw new Error(event.detail);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          processLine(part);
        }
      }

      if (buffer.trim()) {
        processLine(buffer);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message =
        err instanceof Error
          ? err.message
          : "No fue posible completar el análisis con el servidor.";
      setErrorMessage(message);
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  };

  const showProgressCard = isAnalyzing || (progress > 0 && (metrics !== null || errorMessage !== null));

  return (
    <div className="min-h-screen bg-slate-950 bg-tech-grid text-slate-100">
      {/* Header superior */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 shadow-sm shadow-emerald-500/10">
              <Radar className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-tight text-slate-50 sm:text-lg">
                  Traffic Counter YOLO26
                </h1>
                <span className="hidden rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-cyan-300 sm:inline-block">
                  ByteTrack + LineZone
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Aforo y clasificación vehicular con líneas virtuales interactivas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {isEditingApiUrl ? (
              <form
                onSubmit={handleSaveApiUrl}
                className="flex items-center gap-1.5 rounded-lg border border-cyan-500/50 bg-slate-900 px-2 py-1"
              >
                <Server className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                <input
                  type="text"
                  inputMode="url"
                  value={apiUrlDraft}
                  onChange={(e) => setApiUrlDraft(e.target.value)}
                  placeholder="https://xxxx.trycloudflare.com"
                  autoFocus
                  className="w-48 bg-transparent font-mono text-xs text-slate-100 placeholder-slate-500 focus:outline-none sm:w-64"
                />
                <button
                  type="submit"
                  title="Guardar URL del backend"
                  className="rounded p-1 text-emerald-400 transition hover:bg-emerald-500/20"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                {apiUrl !== DEFAULT_API_URL && (
                  <button
                    type="button"
                    onClick={handleResetApiUrl}
                    title="Restaurar URL por defecto"
                    className="rounded p-1 text-amber-400 transition hover:bg-amber-500/20"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsEditingApiUrl(false)}
                  title="Cancelar"
                  className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={handleOpenApiUrlEditor}
                disabled={isAnalyzing}
                title={`Estado: ${
                  apiHealth === "online"
                    ? "Conectado"
                    : apiHealth === "checking"
                      ? "Verificando conexión..."
                      : "Sin conexión"
                } — Haz clic para editar la URL del backend (${apiUrl})`}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-300 transition hover:border-cyan-500/50 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    apiHealth === "online"
                      ? "bg-emerald-400"
                      : apiHealth === "checking"
                        ? "animate-pulse bg-amber-400"
                        : "bg-rose-400"
                  }`}
                />
                <Server className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span className="max-w-[200px] truncate">{apiUrl}</span>
                <Pencil className="h-3 w-3 shrink-0 text-slate-500" />
              </button>
            )}
            <div className="hidden items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-400 md:inline-flex">
              <Cpu className="h-3.5 w-3.5 text-cyan-400" />
              <span>{modelName}</span>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-300">
                {resolutionMode === "native" ? "Resolución Nativa 1:1" : `${resolutionMode}px`}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Contenido principal */}
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Paso 1: Carga de video */}
        <VideoDropzone
          currentVideo={videoData}
          disabled={isAnalyzing}
          onVideoLoaded={handleVideoLoaded}
        />

        {/* Paso 2: Editor interactivo de líneas */}
        {videoData && (
          <LineCanvasEditor
            frameDataUrl={videoData.frameDataUrl}
            videoWidth={videoData.width}
            videoHeight={videoData.height}
            lines={lines}
            confidence={confidence}
            frameStride={frameStride}
            isAnalyzing={isAnalyzing}
            livePreview={livePreview}
            liveFrameDataUrl={liveFrameDataUrl}
            activeDetections={activeDetections}
            liveMetrics={metrics}
            enabledClasses={enabledClasses}
            resolutionMode={resolutionMode}
            motoBoost={motoBoost}
            modelName={modelName}
            onLinesChange={setLines}
            onConfidenceChange={setConfidence}
            onFrameStrideChange={setFrameStride}
            onLivePreviewChange={setLivePreview}
            onEnabledClassesChange={setEnabledClasses}
            onResolutionModeChange={setResolutionMode}
            onMotoBoostChange={setMotoBoost}
            onModelNameChange={setModelName}
            onStartAnalysis={() => void handleStartAnalysis()}
          />
        )}

        {/* Barra de progreso en vivo */}
        {showProgressCard && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                {isAnalyzing ? (
                  <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
                ) : metrics ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                )}
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    {isAnalyzing
                      ? "Analizando tráfico vehicular en tiempo real..."
                      : metrics
                        ? "Análisis completado exitosamente"
                        : "Proceso detenido"}
                  </h3>
                  <p className="font-mono text-xs text-slate-400">
                    {totalFrames > 0
                      ? `Fotogramas: ${currentFrame.toLocaleString("es-CO")} / ${totalFrames.toLocaleString("es-CO")}`
                      : "Inicializando modelo YOLO26 y decodificador de video..."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-200">
                  <Timer className="h-3.5 w-3.5 text-emerald-400" />
                  <span>{formatElapsedTime(elapsedMs)}</span>
                </div>

                <span className="font-mono text-lg font-bold text-emerald-400">
                  {progress}%
                </span>

                {isAnalyzing && (
                  <button
                    type="button"
                    onClick={handleCancelAnalysis}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
                  >
                    <StopCircle className="h-3.5 w-3.5" />
                    Cancelar
                  </button>
                )}
              </div>
            </div>

            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-950 ring-1 ring-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          </div>
        )}

        {/* Alerta de error */}
        {errorMessage && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
            <div>
              <p className="font-semibold text-rose-100">
                No se pudo completar el análisis
              </p>
              <p className="mt-0.5 text-xs text-rose-200/90">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Paso 3: Malla de resultados y KPIs */}
        {metrics && (
          <MetricsGrid
            metrics={metrics}
            videoMetadata={videoMetadata}
            processingTimeSec={processingTimeSec}
          />
        )}
      </main>
    </div>
  );
}
