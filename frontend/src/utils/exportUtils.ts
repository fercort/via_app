import { ClassCounts, LineMetrics, VideoMetadata } from "../types";

function escapeCsvField(value: string | number, separator: string): string {
  const str = String(value);
  if (
    str.includes(separator) ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function sanitizeBaseFilename(videoFilename?: string): string {
  const base = (videoFilename || "aforo_vehicular")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "aforo_vehicular";
}

export function sumGlobalCounts(metrics: LineMetrics[]): ClassCounts {
  return metrics.reduce<ClassCounts>(
    (acc, line) => ({
      car: acc.car + line.counts_total.car,
      motorcycle: acc.motorcycle + line.counts_total.motorcycle,
      bus: acc.bus + line.counts_total.bus,
      truck: acc.truck + line.counts_total.truck,
      total: acc.total + line.counts_total.total,
    }),
    { car: 0, motorcycle: 0, bus: 0, truck: 0, total: 0 }
  );
}

export function exportMetricsToCsv(
  metrics: LineMetrics[],
  metadata: VideoMetadata | null,
  separator: "," | ";" = ";"
): void {
  const headers = [
    "Línea",
    "Sentido",
    "Carros",
    "Motos",
    "Buses",
    "Camiones",
    "Total Línea",
  ];

  const rows: string[] = [
    headers.map((h) => escapeCsvField(h, separator)).join(separator),
  ];

  for (const line of metrics) {
    const directions: Array<{ label: string; counts: ClassCounts }> = [
      { label: "IN", counts: line.counts_in },
      { label: "OUT", counts: line.counts_out },
      { label: "Total", counts: line.counts_total },
    ];

    for (const dir of directions) {
      rows.push(
        [
          line.line_name,
          dir.label,
          dir.counts.car,
          dir.counts.motorcycle,
          dir.counts.bus,
          dir.counts.truck,
          dir.counts.total,
        ]
          .map((cell) => escapeCsvField(cell, separator))
          .join(separator)
      );
    }
  }

  const globalTotals = sumGlobalCounts(metrics);
  rows.push(
    [
      "TOTAL GLOBAL",
      "IN + OUT",
      globalTotals.car,
      globalTotals.motorcycle,
      globalTotals.bus,
      globalTotals.truck,
      globalTotals.total,
    ]
      .map((cell) => escapeCsvField(cell, separator))
      .join(separator)
  );

  // BOM UTF-8 (\uFEFF) para apertura directa sin problemas de acentos en Microsoft Excel
  const csvContent = "\uFEFF" + rows.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const baseName = sanitizeBaseFilename(metadata?.filename);
  const sepTag = separator === ";" ? "excel" : "csv";
  triggerBlobDownload(blob, `${baseName}_aforo_${sepTag}.csv`);
}

export function exportMetricsToJson(
  metrics: LineMetrics[],
  metadata: VideoMetadata | null,
  processingTimeSec: number | null
): void {
  const payload = {
    exported_at: new Date().toISOString(),
    processing_time_sec: processingTimeSec,
    video_metadata: metadata,
    global_totals: sumGlobalCounts(metrics),
    metrics,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8;",
  });
  const baseName = sanitizeBaseFilename(metadata?.filename);
  triggerBlobDownload(blob, `${baseName}_aforo.json`);
}
