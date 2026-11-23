import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Bike,
  Bus,
  Car,
  Cpu,
  Crosshair,
  Eraser,
  Eye,
  EyeOff,
  Gauge,
  Maximize2,
  Play,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Truck,
  X,
} from "lucide-react";

import {
  FrameStrideOption,
  LineMetrics,
  ModelNameOption,
  ResolutionMode,
  VehicleCategory,
  VirtualLine,
} from "../types";

interface LineCanvasEditorProps {
  frameDataUrl: string;
  videoWidth: number;
  videoHeight: number;
  lines: VirtualLine[];
  confidence: number;
  frameStride: FrameStrideOption;
  isAnalyzing: boolean;
  livePreview: boolean;
  liveFrameDataUrl: string | null;
  activeDetections: number;
  liveMetrics: LineMetrics[] | null;
  enabledClasses: VehicleCategory[];
  resolutionMode: ResolutionMode;
  motoBoost: boolean;
  modelName: ModelNameOption;
  onLinesChange: (lines: VirtualLine[]) => void;
  onConfidenceChange: (value: number) => void;
  onFrameStrideChange: (value: FrameStrideOption) => void;
  onLivePreviewChange: (enabled: boolean) => void;
  onEnabledClassesChange: (classes: VehicleCategory[]) => void;
  onResolutionModeChange: (mode: ResolutionMode) => void;
  onMotoBoostChange: (enabled: boolean) => void;
  onModelNameChange: (model: ModelNameOption) => void;
  onStartAnalysis: () => void;
}

interface NormalizedPoint {
  x: number;
  y: number;
}

const LINE_PALETTE = [
  "#10b981", // esmeralda
  "#06b6d4", // cian
  "#f59e0b", // ámbar
  "#a855f7", // violeta
  "#38bdf8", // celeste
  "#f43f5e", // coral
];

const STRIDE_OPTIONS: Array<{
  value: FrameStrideOption;
  label: string;
  hint: string;
}> = [
  { value: 1, label: "1 — Máxima precisión", hint: "Analiza cada fotograma" },
  { value: 2, label: "2 — Balanceado", hint: "Recomendado (1 de cada 2)" },
  { value: 3, label: "3 — Rápido", hint: "Mayor velocidad (1 de cada 3)" },
];

const CLASS_OPTIONS: Array<{
  id: VehicleCategory;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeClass: string;
}> = [
  {
    id: "car",
    label: "Carros",
    icon: Car,
    activeClass: "border-cyan-500/60 bg-cyan-500/15 text-cyan-100",
  },
  {
    id: "motorcycle",
    label: "Motos",
    icon: Bike,
    activeClass: "border-sky-500/60 bg-sky-500/15 text-sky-100",
  },
  {
    id: "bus",
    label: "Buses",
    icon: Bus,
    activeClass: "border-amber-500/60 bg-amber-500/15 text-amber-100",
  },
  {
    id: "truck",
    label: "Camiones",
    icon: Truck,
    activeClass: "border-violet-500/60 bg-violet-500/15 text-violet-100",
  },
];

const MODEL_OPTIONS: Array<{
  value: ModelNameOption;
  label: string;
  hint: string;
}> = [
  { value: "yolo26n.pt", label: "YOLO26 Nano · Rápido", hint: "yolo26n.pt" },
  { value: "yolo26s.pt", label: "YOLO26 Small · Mayor precisión", hint: "yolo26s.pt" },
];

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  angle: number,
  size: number,
  color: string
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - size * Math.cos(angle - Math.PI / 6),
    tipY - size * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    tipX - size * Math.cos(angle + Math.PI / 6),
    tipY - size * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  text: string,
  bgColor: string,
  borderColor: string,
  textColor: string,
  fontSize: number,
  padX: number,
  padY: number
): void {
  ctx.save();
  ctx.font = `700 ${fontSize}px "JetBrains Mono", monospace`;
  const metrics = ctx.measureText(text);
  const boxW = metrics.width + padX * 2;
  const boxH = fontSize + padY * 2;
  const x = centerX - boxW / 2;
  const y = centerY - boxH / 2;
  const radius = Math.min(6, boxH / 3);

  ctx.fillStyle = bgColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = Math.max(1.2, fontSize / 12);

  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, radius);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, centerX, centerY + 0.5);
  ctx.restore();
}

function renderVirtualLine(
  ctx: CanvasRenderingContext2D,
  line: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    name: string;
  },
  canvasW: number,
  canvasH: number,
  isDraft: boolean,
  counts?: { inCount: number; outCount: number }
): void {
  const x1 = line.x1 * canvasW;
  const y1 = line.y1 * canvasH;
  const x2 = line.x2 * canvasW;
  const y2 = line.y2 * canvasH;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 2) return;

  const scale = Math.max(0.75, Math.min(2.4, canvasW / 1100));
  const strokeW = 3.2 * scale;
  const arrowSize = 14 * scale;
  const perpOffset = 34 * scale;
  const badgeFontSize = Math.round(12 * scale);

  ctx.save();
  if (isDraft) {
    ctx.setLineDash([8 * scale, 6 * scale]);
  }

  // Trazo principal A -> B
  ctx.strokeStyle = line.color;
  ctx.lineWidth = strokeW;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(2, 6, 23, 0.85)";
  ctx.shadowBlur = 6 * scale;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Flecha direccional del vector A -> B
  const lineAngle = Math.atan2(dy, dx);
  drawArrowHead(ctx, x2, y2, lineAngle, arrowSize, line.color);

  // Vectores perpendiculares exactos según sv.LineZone (cross_product < 0 -> IN)
  const nxIn = dy / length;
  const nyIn = -dx / length;
  const nxOut = -nxIn;
  const nyOut = -nyIn;

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  const inTipX = midX + nxIn * perpOffset;
  const inTipY = midY + nyIn * perpOffset;
  const outTipX = midX + nxOut * perpOffset;
  const outTipY = midY + nyOut * perpOffset;

  // Segmento perpendicular hacia lado IN (esmeralda)
  ctx.strokeStyle = "#34d399";
  ctx.lineWidth = 2.2 * scale;
  ctx.beginPath();
  ctx.moveTo(midX, midY);
  ctx.lineTo(inTipX, inTipY);
  ctx.stroke();
  drawArrowHead(
    ctx,
    inTipX,
    inTipY,
    Math.atan2(nyIn, nxIn),
    10 * scale,
    "#34d399"
  );

  // Segmento perpendicular hacia lado OUT (ámbar/coral)
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 2.2 * scale;
  ctx.beginPath();
  ctx.moveTo(midX, midY);
  ctx.lineTo(outTipX, outTipY);
  ctx.stroke();
  drawArrowHead(
    ctx,
    outTipX,
    outTipY,
    Math.atan2(nyOut, nxOut),
    10 * scale,
    "#fbbf24"
  );

  // Etiquetas IN / OUT desplazadas más allá de las puntas
  const labelDist = perpOffset + 18 * scale;
  const inLabel = counts ? `IN: ${counts.inCount}` : "IN";
  const outLabel = counts ? `OUT: ${counts.outCount}` : "OUT";
  drawBadge(
    ctx,
    midX + nxIn * labelDist,
    midY + nyIn * labelDist,
    inLabel,
    "rgba(6, 78, 59, 0.92)",
    "#34d399",
    "#ecfdf5",
    badgeFontSize,
    6 * scale,
    3 * scale
  );
  drawBadge(
    ctx,
    midX + nxOut * labelDist,
    midY + nyOut * labelDist,
    outLabel,
    "rgba(120, 53, 15, 0.92)",
    "#fbbf24",
    "#fffbeb",
    badgeFontSize,
    6 * scale,
    3 * scale
  );

  // Puntos A y B
  const nodeRadius = 5.5 * scale;
  for (const [px, py, tag] of [
    [x1, y1, "A"],
    [x2, y2, "B"],
  ] as const) {
    ctx.fillStyle = "#020617";
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 2.4 * scale;
    ctx.beginPath();
    ctx.arc(px, py, nodeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.font = `700 ${Math.round(11 * scale)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(tag, px, py - nodeRadius - 3 * scale);
  }

  // Etiqueta del nombre de la línea junto al punto A
  if (line.name.trim()) {
    drawBadge(
      ctx,
      x1,
      y1 + 18 * scale,
      line.name,
      "rgba(15, 23, 42, 0.9)",
      line.color,
      "#f8fafc",
      Math.round(12 * scale),
      7 * scale,
      3.5 * scale
    );
  }

  ctx.restore();
}

export const LineCanvasEditor: React.FC<LineCanvasEditorProps> = ({
  frameDataUrl,
  videoWidth,
  videoHeight,
  lines,
  confidence,
  frameStride,
  isAnalyzing,
  livePreview,
  liveFrameDataUrl,
  activeDetections,
  liveMetrics,
  enabledClasses,
  resolutionMode,
  motoBoost,
  modelName,
  onLinesChange,
  onConfidenceChange,
  onFrameStrideChange,
  onLivePreviewChange,
  onEnabledClassesChange,
  onResolutionModeChange,
  onMotoBoostChange,
  onModelNameChange,
  onStartAnalysis,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameImgRef = useRef<HTMLImageElement | null>(null);
  const liveImgRef = useRef<HTMLImageElement | null>(null);

  const [pendingPointA, setPendingPointA] = useState<NormalizedPoint | null>(null);
  const [hoverPoint, setHoverPoint] = useState<NormalizedPoint | null>(null);
  const [imageReady, setImageReady] = useState(false);

  // Cargar imagen del fotograma extraído
  useEffect(() => {
    setImageReady(false);
    setPendingPointA(null);
    setHoverPoint(null);
    liveImgRef.current = null;

    const img = new Image();
    img.onload = () => {
      frameImgRef.current = img;
      setImageReady(true);
    };
    img.src = frameDataUrl;
  }, [frameDataUrl]);

  // Permitir cancelar el trazo en progreso con la tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pendingPointA) {
        setPendingPointA(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingPointA]);

  // Redibujar el canvas cada vez que cambien líneas, punto pendiente, hover o métricas en vivo
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const activeImg = liveImgRef.current ?? frameImgRef.current;
    if (!canvas || !activeImg || !imageReady) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(activeImg, 0, 0, canvas.width, canvas.height);

    for (const line of lines) {
      const lineMetric = liveMetrics?.find((m) => m.line_id === line.id);
      const counts = lineMetric
        ? {
            inCount: lineMetric.counts_in.total,
            outCount: lineMetric.counts_out.total,
          }
        : undefined;
      renderVirtualLine(ctx, line, canvas.width, canvas.height, false, counts);
    }

    if (pendingPointA) {
      const scale = Math.max(0.75, Math.min(2.4, canvas.width / 1100));
      const ax = pendingPointA.x * canvas.width;
      const ay = pendingPointA.y * canvas.height;
      const nextColor = LINE_PALETTE[lines.length % LINE_PALETTE.length];

      if (hoverPoint) {
        renderVirtualLine(
          ctx,
          {
            x1: pendingPointA.x,
            y1: pendingPointA.y,
            x2: hoverPoint.x,
            y2: hoverPoint.y,
            color: nextColor,
            name: `Línea ${lines.length + 1}`,
          },
          canvas.width,
          canvas.height,
          true
        );
      } else {
        ctx.save();
        ctx.fillStyle = nextColor;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5 * scale;
        ctx.beginPath();
        ctx.arc(ax, ay, 7 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [hoverPoint, imageReady, lines, liveMetrics, pendingPointA]);

  useEffect(() => {
    if (!liveFrameDataUrl) {
      liveImgRef.current = null;
      redrawCanvas();
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      liveImgRef.current = img;
      redrawCanvas();
    };
    img.src = liveFrameDataUrl;

    return () => {
      cancelled = true;
    };
  }, [liveFrameDataUrl, redrawCanvas]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const getNormalizedCoords = (
    e: React.MouseEvent<HTMLCanvasElement>
  ): NormalizedPoint => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return {
      x: Number(x.toFixed(5)),
      y: Number(y.toFixed(5)),
    };
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isAnalyzing) return;
    const point = getNormalizedCoords(e);

    if (!pendingPointA) {
      setPendingPointA(point);
      return;
    }

    const dist = Math.hypot(point.x - pendingPointA.x, point.y - pendingPointA.y);
    if (dist < 0.015) {
      // Evita crear líneas degeneradas por doble clic accidental en el mismo punto
      return;
    }

    const index = lines.length;
    const color = LINE_PALETTE[index % LINE_PALETTE.length];
    const newLine: VirtualLine = {
      id: `line-${Date.now()}-${index + 1}`,
      name: `Línea ${index + 1}`,
      color,
      x1: pendingPointA.x,
      y1: pendingPointA.y,
      x2: point.x,
      y2: point.y,
    };

    onLinesChange([...lines, newLine]);
    setPendingPointA(null);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!pendingPointA || isAnalyzing) return;
    setHoverPoint(getNormalizedCoords(e));
  };

  const handleRenameLine = (id: string, name: string) => {
    onLinesChange(
      lines.map((line) => (line.id === id ? { ...line, name } : line))
    );
  };

  const handleInvertLine = (id: string) => {
    onLinesChange(
      lines.map((line) =>
        line.id === id
          ? { ...line, x1: line.x2, y1: line.y2, x2: line.x1, y2: line.y1 }
          : line
      )
    );
  };

  const handleDeleteLine = (id: string) => {
    onLinesChange(lines.filter((line) => line.id !== id));
  };

  const handleClearAll = () => {
    setPendingPointA(null);
    onLinesChange([]);
  };

  const handleToggleClass = (category: VehicleCategory) => {
    if (isAnalyzing) return;
    if (enabledClasses.includes(category)) {
      if (enabledClasses.length <= 1) return;
      onEnabledClassesChange(enabledClasses.filter((c) => c !== category));
    } else {
      onEnabledClassesChange([...enabledClasses, category]);
    }
  };

  const resolutionOptions: Array<{
    value: ResolutionMode;
    label: string;
    hint: string;
  }> = [
    {
      value: "native",
      label: `Nativa 1:1 (${videoWidth}×${videoHeight})`,
      hint: "Sin reducir resolución (Máxima detección de motos)",
    },
    {
      value: "1280",
      label: "Alta HD (1280 px)",
      hint: "Balance entre detalle y velocidad",
    },
    {
      value: "640",
      label: "Compacta (640 px)",
      hint: "Menor detalle, mayor velocidad",
    },
  ];

  const motoBoostThreshold = Math.max(0.14, Number((confidence * 0.5).toFixed(2)));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Lienzo interactivo izquierdo */}
      <div className="lg:col-span-8 flex flex-col rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
              Editor Interactivo de Líneas Virtuales
            </h2>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {pendingPointA ? (
              <div className="flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-cyan-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                <span>Haz clic en el Punto B para cerrar la línea</span>
                <button
                  type="button"
                  onClick={() => setPendingPointA(null)}
                  className="ml-1 rounded p-0.5 hover:bg-cyan-500/20"
                  title="Cancelar trazo (Esc)"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <span className="text-slate-400">
                Clic en <strong className="text-emerald-400">Punto A</strong> y luego{" "}
                <strong className="text-cyan-400">Punto B</strong> · Flechas indican{" "}
                <span className="font-mono text-emerald-400">IN</span> /{" "}
                <span className="font-mono text-amber-400">OUT</span>
              </span>
            )}
          </div>
        </div>

        <div className="relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
          <div
            className="relative w-full"
            style={{ aspectRatio: `${videoWidth} / ${videoHeight}` }}
          >
            <canvas
              ref={canvasRef}
              width={videoWidth}
              height={videoHeight}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={() => setHoverPoint(null)}
              className={`block h-full w-full select-none ${
                isAnalyzing
                  ? livePreview && liveFrameDataUrl
                    ? "cursor-wait"
                    : "cursor-wait opacity-85"
                  : "cursor-crosshair"
              }`}
            />
            {isAnalyzing && livePreview && liveFrameDataUrl && (
              <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-slate-950/85 px-3 py-1.5 shadow-lg backdrop-blur-sm">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
                <span className="font-mono text-[11px] font-bold tracking-wider text-emerald-300">
                  VISTA EN VIVO
                </span>
                <span className="text-slate-600">·</span>
                <span className="font-mono text-[11px] text-slate-200">
                  {activeDetections}{" "}
                  {activeDetections === 1 ? "vehículo detectado" : "vehículos detectados"}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              Sentido <strong className="text-emerald-300">IN</strong> (cruce hacia la flecha verde)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              Sentido <strong className="text-amber-300">OUT</strong> (cruce hacia la flecha ámbar)
            </span>
          </div>
          <span className="font-mono text-slate-500">
            Resolución nativa: {videoWidth}×{videoHeight}
          </span>
        </div>
      </div>

      {/* Panel de configuración y lista de líneas */}
      <div className="lg:col-span-4 flex flex-col justify-between gap-5 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
        <div className="space-y-5">
          {/* Lista de líneas */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100">
                Líneas Virtuales ({lines.length})
              </h3>
              {lines.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={isAnalyzing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-rose-500/50 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Eraser className="h-3.5 w-3.5" />
                  Limpiar todas
                </button>
              )}
            </div>

            {lines.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-6 text-center text-xs text-slate-400">
                Aún no has trazado líneas sobre el fotograma. Haz clic en dos puntos del
                video para definir tu primera línea de aforo.
              </div>
            ) : (
              <div className="max-h-60 space-y-2.5 overflow-y-auto pr-1">
                {lines.map((line) => (
                  <div
                    key={line.id}
                    className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 transition hover:border-slate-700"
                  >
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-slate-800"
                      style={{ backgroundColor: line.color }}
                    />
                    <input
                      type="text"
                      value={line.name}
                      disabled={isAnalyzing}
                      maxLength={80}
                      onChange={(e) => handleRenameLine(line.id, e.target.value)}
                      onBlur={(e) => {
                        if (!e.target.value.trim()) {
                          handleRenameLine(line.id, "Línea sin nombre");
                        }
                      }}
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs font-semibold text-slate-100 focus:border-cyan-500/60 focus:bg-slate-900 focus:outline-none disabled:opacity-60"
                      placeholder="Nombre de la línea"
                    />
                    <button
                      type="button"
                      onClick={() => handleInvertLine(line.id)}
                      disabled={isAnalyzing}
                      title="Invertir sentido IN / OUT"
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-cyan-300 disabled:opacity-50"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteLine(line.id)}
                      disabled={isAnalyzing}
                      title="Eliminar línea"
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-400 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Parámetros de inferencia */}
          <div className="space-y-4 border-t border-slate-800 pt-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
              <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-400" />
              <span>Parámetros YOLO26 + ByteTrack</span>
            </div>

            {/* Selector de clases vehiculares */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Clases Vehiculares a Detectar
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  {enabledClasses.length}/4 activas
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {CLASS_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = enabledClasses.includes(opt.id);
                  const isLastActive = active && enabledClasses.length <= 1;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isAnalyzing || isLastActive}
                      onClick={() => handleToggleClass(opt.id)}
                      title={
                        isLastActive
                          ? "Debe quedar al menos 1 clase activa"
                          : undefined
                      }
                      className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs font-semibold transition ${
                        active
                          ? opt.activeClass
                          : "border-slate-800 bg-slate-900/50 text-slate-500 hover:border-slate-700 hover:text-slate-300"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5" />
                        {opt.label}
                      </span>
                      <span
                        className={`h-2 w-2 rounded-full ${
                          active ? "bg-emerald-400" : "bg-slate-700"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sensibilidad Mejorada para Motos */}
            {enabledClasses.includes("motorcycle") && (
              <button
                type="button"
                role="switch"
                aria-checked={motoBoost}
                disabled={isAnalyzing}
                onClick={() => onMotoBoostChange(!motoBoost)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition ${
                  motoBoost
                    ? "border-sky-500/50 bg-sky-500/10"
                    : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <div className="flex items-start gap-2.5">
                  <Sparkles
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      motoBoost ? "text-sky-400" : "text-slate-400"
                    }`}
                  />
                  <div>
                    <p className="text-xs font-semibold text-slate-100">
                      Sensibilidad Mejorada para Motos
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {motoBoost
                        ? `Umbral reducido (${motoBoostThreshold.toFixed(2)}) para motos con conductor`
                        : "Usa el mismo umbral de confianza global"}
                    </p>
                  </div>
                </div>
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    motoBoost ? "bg-sky-500" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-slate-950 transition-transform ${
                      motoBoost ? "translate-x-4" : "translate-x-1"
                    }`}
                  />
                </span>
              </button>
            )}

            {/* Resolución Interna de Inferencia */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="mb-2.5 flex items-center gap-2">
                <Maximize2 className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-xs font-semibold text-slate-200">
                  Resolución Interna de Inferencia
                </span>
              </div>
              <div className="space-y-1.5">
                {resolutionOptions.map((opt) => {
                  const selected = resolutionMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => onResolutionModeChange(opt.value)}
                      className={`flex w-full flex-col rounded-lg border px-3 py-2 text-left text-xs transition ${
                        selected
                          ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-100"
                          : "border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <span className="font-semibold">{opt.label}</span>
                      <span className="text-[11px] opacity-80">{opt.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selector de Modelo YOLO26 */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="mb-2.5 flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-xs font-semibold text-slate-200">
                  Modelo YOLO26
                </span>
              </div>
              <div className="space-y-1.5">
                {MODEL_OPTIONS.map((opt) => {
                  const selected = modelName === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => onModelNameChange(opt.value)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${
                        selected
                          ? "border-cyan-500/60 bg-cyan-500/15 text-cyan-100"
                          : "border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <span className="font-semibold">{opt.label}</span>
                      <span className="font-mono text-[10px] opacity-80">
                        {opt.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Confidence Slider */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <label
                  htmlFor="confidence-slider"
                  className="text-xs font-semibold text-slate-200"
                >
                  Umbral de Confianza (Confidence)
                </label>
                <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono text-xs font-bold text-emerald-300">
                  {confidence.toFixed(2)}
                </span>
              </div>
              <input
                id="confidence-slider"
                type="range"
                min="0.10"
                max="0.90"
                step="0.05"
                value={confidence}
                disabled={isAnalyzing}
                onChange={(e) => onConfidenceChange( parseFloat(e.target.value) )}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="mt-1.5 flex justify-between font-mono text-[10px] text-slate-500">
                <span>0.10 (Más detecciones)</span>
                <span>0.90 (Más estricto)</span>
              </div>
            </div>

            {/* Frame Stride Selector */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="mb-2.5 flex items-center gap-2">
                <Gauge className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-xs font-semibold text-slate-200">
                  Salto de Fotogramas (Frame Stride)
                </span>
              </div>

              <div className="space-y-1.5">
                {STRIDE_OPTIONS.map((opt) => {
                  const selected = frameStride === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => onFrameStrideChange(opt.value)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${
                        selected
                          ? "border-cyan-500/60 bg-cyan-500/15 text-cyan-100"
                          : "border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <span className="font-semibold">{opt.label}</span>
                      <span className="text-[11px] opacity-80">{opt.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vista en Vivo de Detecciones Toggle */}
            <button
              type="button"
              role="switch"
              aria-checked={livePreview}
              disabled={isAnalyzing}
              onClick={() => onLivePreviewChange(!livePreview)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition ${
                livePreview
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <div className="flex items-start gap-2.5">
                {livePreview ? (
                  <Eye className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                )}
                <div>
                  <p className="text-xs font-semibold text-slate-100">
                    Vista en Vivo de Detecciones
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {livePreview
                      ? "Muestra cajas, IDs y conteos en tiempo real"
                      : "Solo barra de progreso (máxima velocidad)"}
                  </p>
                </div>
              </div>
              <span
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  livePreview ? "bg-emerald-500" : "bg-slate-700"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-slate-950 transition-transform ${
                    livePreview ? "translate-x-4" : "translate-x-1"
                  }`}
                />
              </span>
            </button>
          </div>
        </div>

        {/* Botón ejecutar análisis */}
        <button
          type="button"
          onClick={onStartAnalysis}
          disabled={isAnalyzing || lines.length === 0}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-5 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:from-emerald-400 hover:to-cyan-400 disabled:cursor-not-allowed disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 disabled:shadow-none"
        >
          <Play className="h-4 w-4 fill-current" />
          {isAnalyzing
            ? "Procesando video en servidor..."
            : lines.length === 0
              ? "Traza al menos 1 línea para iniciar"
              : "Iniciar Aforo Vehicular"}
        </button>
      </div>
    </div>
  );
};
