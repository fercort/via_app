import React from "react";
import {
  Activity,
  Bike,
  Bus,
  Car,
  Clock,
  FileJson,
  FileSpreadsheet,
  Truck,
} from "lucide-react";

import { LineMetrics, VideoMetadata } from "../types";
import {
  exportMetricsToCsv,
  exportMetricsToJson,
  sumGlobalCounts,
} from "../utils/exportUtils";

interface MetricsGridProps {
  metrics: LineMetrics[];
  videoMetadata: VideoMetadata | null;
  processingTimeSec: number | null;
}

export const MetricsGrid: React.FC<MetricsGridProps> = ({
  metrics,
  videoMetadata,
  processingTimeSec,
}) => {
  const globals = sumGlobalCounts(metrics);

  const kpiCards = [
    {
      label: "Total Vehículos Cruzados",
      value: globals.total.toLocaleString("es-CO"),
      icon: Activity,
      accent: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
      subtext: `${metrics.length} ${metrics.length === 1 ? "línea activa" : "líneas activas"}`,
    },
    {
      label: "Carros",
      value: globals.car.toLocaleString("es-CO"),
      icon: Car,
      accent: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
      subtext: "Clase COCO 2",
    },
    {
      label: "Motos",
      value: globals.motorcycle.toLocaleString("es-CO"),
      icon: Bike,
      accent: "text-sky-400 border-sky-500/30 bg-sky-500/10",
      subtext: "Clase COCO 3",
    },
    {
      label: "Buses",
      value: globals.bus.toLocaleString("es-CO"),
      icon: Bus,
      accent: "text-amber-400 border-amber-500/30 bg-amber-500/10",
      subtext: "Clase COCO 5",
    },
    {
      label: "Camiones",
      value: globals.truck.toLocaleString("es-CO"),
      icon: Truck,
      accent: "text-violet-400 border-violet-500/30 bg-violet-500/10",
      subtext: "Clase COCO 7",
    },
    {
      label: "Tiempo Procesamiento",
      value: processingTimeSec !== null ? `${processingTimeSec.toFixed(2)} s` : "—",
      icon: Clock,
      accent: "text-emerald-300 border-slate-700 bg-slate-800/80",
      subtext: videoMetadata
        ? `${videoMetadata.analyzed_frames}/${videoMetadata.total_frames} frames`
        : "Sin video",
    },
  ];

  return (
    <section className="space-y-6">
      {/* Encabezado y botones de exportación */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100">
            Resultados del Aforo Vehicular
          </h2>
          {videoMetadata && (
            <p className="mt-0.5 font-mono text-xs text-slate-400">
              {videoMetadata.filename} · {videoMetadata.width}×{videoMetadata.height} ·{" "}
              {videoMetadata.fps} FPS · Duración {videoMetadata.duration_sec.toFixed(1)} s
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => exportMetricsToCsv(metrics, videoMetadata, ",")}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-500/50 hover:bg-slate-800 hover:text-emerald-300"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
            CSV (Coma ,)
          </button>

          <button
            type="button"
            onClick={() => exportMetricsToCsv(metrics, videoMetadata, ";")}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
            CSV Excel (Punto y coma ;)
          </button>

          <button
            type="button"
            onClick={() =>
              exportMetricsToJson(metrics, videoMetadata, processingTimeSec)
            }
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
          >
            <FileJson className="h-4 w-4 text-cyan-400" />
            Descargar JSON
          </button>
        </div>
      </div>

      {/* Tarjetas superiores de KPIs globales */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-slate-400">
                  {card.label}
                </span>
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${card.accent}`}
                >
                  <Icon className="h-4 w-4" />
                </div>
              </div>

              <div className="mt-3">
                <p className="font-mono text-2xl font-bold tracking-tight text-slate-50">
                  {card.value}
                </p>
                <p className="mt-1 font-mono text-[11px] text-slate-500">
                  {card.subtext}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Malla detallada por línea virtual */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-3.5">Línea</th>
                <th className="px-4 py-3.5">Sentido (IN / OUT / Total)</th>
                <th className="px-4 py-3.5 text-right">Carros</th>
                <th className="px-4 py-3.5 text-right">Motos</th>
                <th className="px-4 py-3.5 text-right">Buses</th>
                <th className="px-4 py-3.5 text-right">Camiones</th>
                <th className="px-5 py-3.5 text-right">Total Línea</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {metrics.map((line) => {
                const rows = [
                  {
                    key: "in",
                    label: "IN",
                    badgeClass:
                      "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
                    rowClass: "hover:bg-slate-800/35",
                    counts: line.counts_in,
                    isTotal: false,
                  },
                  {
                    key: "out",
                    label: "OUT",
                    badgeClass:
                      "border-amber-500/40 bg-amber-500/15 text-amber-300",
                    rowClass: "hover:bg-slate-800/35",
                    counts: line.counts_out,
                    isTotal: false,
                  },
                  {
                    key: "total",
                    label: "Total",
                    badgeClass:
                      "border-cyan-500/40 bg-cyan-500/15 text-cyan-200",
                    rowClass: "bg-slate-950/45 font-semibold hover:bg-slate-800/50",
                    counts: line.counts_total,
                    isTotal: true,
                  },
                ];

                return rows.map((row, idx) => (
                  <tr
                    key={`${line.line_id}-${row.key}`}
                    className={`transition-colors ${row.rowClass}`}
                  >
                    {idx === 0 && (
                      <td
                        rowSpan={3}
                        className="border-r border-slate-800/80 px-5 py-4 align-middle"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-slate-800"
                            style={{ backgroundColor: line.color }}
                          />
                          <span className="font-semibold text-slate-100">
                            {line.line_name}
                          </span>
                        </div>
                      </td>
                    )}

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex min-w-[3.5rem] items-center justify-center rounded-md border px-2 py-0.5 font-mono text-xs font-bold ${row.badgeClass}`}
                      >
                        {row.label}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right font-mono text-slate-200">
                      {row.counts.car}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-200">
                      {row.counts.motorcycle}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-200">
                      {row.counts.bus}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-200">
                      {row.counts.truck}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-mono ${
                        row.isTotal
                          ? "text-base font-bold text-emerald-300"
                          : "font-semibold text-slate-100"
                      }`}
                    >
                      {row.counts.total}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
