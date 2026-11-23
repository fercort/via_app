declare global {
  interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
  }
}

export interface VirtualLine {
  id: string;
  name: string;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type VehicleCategory = "car" | "motorcycle" | "bus" | "truck";
export type ResolutionMode = "native" | "1280" | "640";
export type ModelNameOption = "yolo26n.pt" | "yolo26s.pt";

export interface AnalysisConfig {
  lines: VirtualLine[];
  confidence: number;
  frame_stride: number;
  model_name: string;
  live_preview: boolean;
  enabled_classes: VehicleCategory[];
  resolution_mode: ResolutionMode;
  moto_boost: boolean;
}

export interface ClassCounts {
  car: number;
  motorcycle: number;
  bus: number;
  truck: number;
  total: number;
}

export interface LineMetrics {
  line_id: string;
  line_name: string;
  color: string;
  counts_in: ClassCounts;
  counts_out: ClassCounts;
  counts_total: ClassCounts;
}

export interface VideoMetadata {
  filename: string;
  width: number;
  height: number;
  fps: number;
  total_frames: number;
  analyzed_frames: number;
  duration_sec: number;
}

export interface ProgressEvent {
  status: "processing";
  progress: number;
  current_frame: number;
  total_frames: number;
  active_detections?: number;
  preview_frame?: string | null;
  metrics?: LineMetrics[] | null;
}

export interface CompletedEvent {
  status: "completed";
  processing_time_sec: number;
  video_metadata: VideoMetadata;
  metrics: LineMetrics[];
}

export interface ErrorEvent {
  status: "error";
  detail: string;
}

export type StreamEvent = ProgressEvent | CompletedEvent | ErrorEvent;

export interface ExtractedVideoFrame {
  file: File;
  frameDataUrl: string;
  width: number;
  height: number;
  duration: number;
}

export type FrameStrideOption = 1 | 2 | 3;
