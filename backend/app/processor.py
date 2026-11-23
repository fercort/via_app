import base64
from dataclasses import dataclass, field
import math
import sys
import threading
import time
import types
from types import SimpleNamespace
from typing import Any, Iterator, Literal

import cv2
import numpy as np
from scipy.optimize import linear_sum_assignment
import supervision as sv
from ultralytics import YOLO

from app.schemas import (
    AnalysisConfig,
    ClassCounts,
    CompletedEvent,
    LineMetrics,
    ProgressEvent,
    VideoMetadata,
    VirtualLineConfig,
)

VehicleCategory = Literal["car", "motorcycle", "bus", "truck"]

# Clases COCO vehiculares permitidas exclusivamente
VEHICLE_CLASS_MAP: dict[int, VehicleCategory] = {
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}
VEHICLE_CLASS_IDS: list[int] = list(VEHICLE_CLASS_MAP.keys())
CATEGORY_TO_CLASS_ID: dict[VehicleCategory, int] = {
    v: k for k, v in VEHICLE_CLASS_MAP.items()
}

VEHICLE_LABELS_ES: dict[VehicleCategory, str] = {
    "car": "Carro",
    "motorcycle": "Moto",
    "bus": "Bus",
    "truck": "Camion",
}

VEHICLE_COLORS_BGR: dict[VehicleCategory, tuple[int, int, int]] = {
    "car": (212, 182, 6),         # cian
    "motorcycle": (248, 189, 56), # celeste
    "bus": (11, 158, 245),        # ámbar
    "truck": (247, 85, 168),      # violeta
}

_MODEL_CACHE: dict[str, YOLO] = {}
_MODEL_LOCK = threading.Lock()


def get_yolo_model(model_name: str) -> YOLO:
    """Obtiene o carga en caché una instancia del modelo YOLO."""
    with _MODEL_LOCK:
        if model_name not in _MODEL_CACHE:
            _MODEL_CACHE[model_name] = YOLO(model_name)
        return _MODEL_CACHE[model_name]


def _ensure_lap_module() -> None:
    """Garantiza que el módulo 'lap' esté disponible usando scipy.optimize.linear_sum_assignment como fallback."""
    try:
        import lap  # type: ignore[import-not-found]
        if hasattr(lap, "lapjv") and getattr(lap, "__version__", None):
            return
    except Exception:
        pass

    lap_mod = types.ModuleType("lap")
    lap_mod.__version__ = "0.5.12"  # type: ignore[attr-defined]

    def lapjv(
        cost_matrix: np.ndarray,
        extend_cost: bool = False,
        cost_limit: float = float("inf"),
        return_cost: bool = False,
    ) -> Any:
        n, m = cost_matrix.shape
        x = np.full(n, -1, dtype=np.int32)
        y = np.full(m, -1, dtype=np.int32)
        if n > 0 and m > 0:
            if np.isfinite(cost_limit):
                work_matrix = np.where(
                    cost_matrix > cost_limit, cost_limit + 1e-4, cost_matrix
                )
            else:
                work_matrix = cost_matrix
            row_ind, col_ind = linear_sum_assignment(work_matrix)
            for r, c in zip(row_ind, col_ind):
                if cost_matrix[r, c] <= cost_limit:
                    x[r] = c
                    y[c] = r
        if return_cost:
            matched = x >= 0
            total_cost = (
                float(cost_matrix[np.arange(n)[matched], x[matched]].sum())
                if np.any(matched)
                else 0.0
            )
            return total_cost, x, y
        return x, y

    lap_mod.lapjv = lapjv  # type: ignore[attr-defined]
    sys.modules["lap"] = lap_mod


class _ByteTrackWrapper:
    """Adaptador de ByteTrack compatible con supervision <0.30 y >=0.30 (vía Ultralytics)."""

    def __init__(self, frame_rate: int, confidence: float, moto_boost: bool = True) -> None:
        self._confidence = float(confidence)
        self._moto_boost = bool(moto_boost)
        self._moto_conf = (
            max(0.14, round(self._confidence * 0.5, 3))
            if self._moto_boost
            else self._confidence
        )
        effective_high = min(self._confidence, self._moto_conf) - 1e-3
        effective_high = max(0.05, effective_high)
        low_thresh = min(0.08, max(0.01, effective_high * 0.5))

        if hasattr(sv, "ByteTrack"):
            self._sv_tracker: Any = sv.ByteTrack(frame_rate=frame_rate)
            self._ultra_tracker: Any = None
            return

        _ensure_lap_module()
        from ultralytics.trackers.byte_tracker import BYTETracker

        args = SimpleNamespace(
            track_high_thresh=effective_high,
            track_low_thresh=low_thresh,
            new_track_thresh=effective_high,
            track_buffer=max(20, int(frame_rate)),
            match_thresh=0.85,
            fuse_score=True,
        )
        self._sv_tracker = None
        self._ultra_tracker = BYTETracker(args)

    @property
    def min_predict_conf(self) -> float:
        """Umbral mínimo requerido en model.predict()."""
        return min(self._confidence, self._moto_conf)

    def update(self, results: Any, frame: np.ndarray) -> sv.Detections:
        """Actualiza el tracker con las detecciones filtradas por clase y retorna sv.Detections."""
        if self._sv_tracker is not None:
            detections = sv.Detections.from_ultralytics(results)
            if (
                len(detections) > 0
                and detections.class_id is not None
                and detections.confidence is not None
            ):
                keep_mask = np.where(
                    detections.class_id == 3,
                    detections.confidence >= (self._moto_conf - 1e-3),
                    detections.confidence >= (self._confidence - 1e-3),
                )
                detections = detections[keep_mask]
            return self._sv_tracker.update_with_detections(detections)

        if getattr(results, "boxes", None) is None:
            return sv.Detections.empty()
        boxes_np = results.boxes.cpu().numpy()
        if len(boxes_np) > 0:
            cls_arr = boxes_np.cls
            conf_arr = boxes_np.conf
            keep_mask = np.where(
                cls_arr == 3,
                conf_arr >= (self._moto_conf - 1e-3),
                conf_arr >= (self._confidence - 1e-3),
            )
            boxes_np = boxes_np[keep_mask]
        tracks = self._ultra_tracker.update(boxes_np, frame)
        if tracks is None or len(tracks) == 0:
            return sv.Detections.empty()
        return sv.Detections(
            xyxy=tracks[:, :4].astype(np.float32),
            confidence=tracks[:, 5].astype(np.float32),
            class_id=tracks[:, 6].astype(int),
            tracker_id=tracks[:, 4].astype(np.int32),
        )


@dataclass
class _LineZoneState:
    """Estado interno de conteo por clase para una línea virtual."""

    config: VirtualLineConfig
    zone: sv.LineZone
    counts_in: dict[VehicleCategory, int] = field(
        default_factory=lambda: {"car": 0, "motorcycle": 0, "bus": 0, "truck": 0}
    )
    counts_out: dict[VehicleCategory, int] = field(
        default_factory=lambda: {"car": 0, "motorcycle": 0, "bus": 0, "truck": 0}
    )


def _scale_normalized_point(norm_x: float, norm_y: float, width: int, height: int) -> sv.Point:
    """Convierte coordenadas normalizadas [0.0, 1.0] a píxeles enteros dentro del frame."""
    px_x = max(0, min(width, int(round(norm_x * width))))
    px_y = max(0, min(height, int(round(norm_y * height))))
    return sv.Point(x=px_x, y=px_y)


def _build_line_states(
    lines: list[VirtualLineConfig], width: int, height: int
) -> list[_LineZoneState]:
    """Instancia sv.LineZone por cada línea virtual escalada a la resolución del video."""
    states: list[_LineZoneState] = []
    for line in lines:
        start = _scale_normalized_point(line.x1, line.y1, width, height)
        end = _scale_normalized_point(line.x2, line.y2, width, height)

        # Evita vectores nulos si ambos puntos colapsan tras redondear a píxeles
        if start.x == end.x and start.y == end.y:
            end = sv.Point(
                x=end.x + 1 if end.x < width else max(0, end.x - 1),
                y=end.y,
            )

        zone = sv.LineZone(
            start=start,
            end=end,
            triggering_anchors=[sv.Position.CENTER],
        )
        states.append(_LineZoneState(config=line, zone=zone))
    return states


def _accumulate_crossings(
    bucket: dict[VehicleCategory, int],
    class_ids: np.ndarray,
    crossed_mask: np.ndarray,
) -> None:
    """Suma cruces confirmados en la categoría vehicular correspondiente."""
    if crossed_mask.size == 0:
        return
    for idx, crossed in enumerate(crossed_mask):
        if not crossed:
            continue
        vehicle_key = VEHICLE_CLASS_MAP.get(int(class_ids[idx]))
        if vehicle_key is not None:
            bucket[vehicle_key] += 1


def _to_class_counts(counts: dict[VehicleCategory, int]) -> ClassCounts:
    """Construye el modelo ClassCounts con su suma total."""
    total = counts["car"] + counts["motorcycle"] + counts["bus"] + counts["truck"]
    return ClassCounts(
        car=counts["car"],
        motorcycle=counts["motorcycle"],
        bus=counts["bus"],
        truck=counts["truck"],
        total=total,
    )


def _build_metrics(line_states: list[_LineZoneState]) -> list[LineMetrics]:
    """Consolida las métricas IN, OUT y Total para cada línea virtual."""
    metrics: list[LineMetrics] = []
    for state in line_states:
        counts_in = _to_class_counts(state.counts_in)
        counts_out = _to_class_counts(state.counts_out)
        counts_total = ClassCounts(
            car=counts_in.car + counts_out.car,
            motorcycle=counts_in.motorcycle + counts_out.motorcycle,
            bus=counts_in.bus + counts_out.bus,
            truck=counts_in.truck + counts_out.truck,
            total=counts_in.total + counts_out.total,
        )
        metrics.append(
            LineMetrics(
                line_id=state.config.id,
                line_name=state.config.name,
                color=state.config.color,
                counts_in=counts_in,
                counts_out=counts_out,
                counts_total=counts_total,
            )
        )
    return metrics


def _encode_preview_frame(
    frame: np.ndarray,
    detections: sv.Detections,
    max_width: int = 1920,
) -> str:
    """Dibuja las detecciones rastreadas sobre el fotograma y lo codifica en JPEG base64."""
    orig_h, orig_w = frame.shape[:2]
    if orig_w > max_width:
        scale = max_width / float(orig_w)
        preview_w = max_width
        preview_h = max(1, int(round(orig_h * scale)))
        canvas = cv2.resize(frame, (preview_w, preview_h), interpolation=cv2.INTER_AREA)
    else:
        scale = 1.0
        canvas = frame.copy()

    canvas_h, canvas_w = canvas.shape[:2]

    if len(detections) > 0:
        for i in range(len(detections)):
            box = detections.xyxy[i]
            x1 = max(0, min(canvas_w - 1, int(round(float(box[0]) * scale))))
            y1 = max(0, min(canvas_h - 1, int(round(float(box[1]) * scale))))
            x2 = max(0, min(canvas_w - 1, int(round(float(box[2]) * scale))))
            y2 = max(0, min(canvas_h - 1, int(round(float(box[3]) * scale))))

            cls_id = int(detections.class_id[i]) if detections.class_id is not None else 2
            category = VEHICLE_CLASS_MAP.get(cls_id, "car")
            color = VEHICLE_COLORS_BGR[category]
            label_es = VEHICLE_LABELS_ES[category]
            track_id = int(detections.tracker_id[i]) if detections.tracker_id is not None else 0
            conf = float(detections.confidence[i]) if detections.confidence is not None else 0.0

            cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 2)

            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2
            cv2.circle(canvas, (cx, cy), 5, (15, 23, 42), -1, cv2.LINE_AA)
            cv2.circle(canvas, (cx, cy), 3, color, -1, cv2.LINE_AA)

            label = f"#{track_id} {label_es} {int(round(conf * 100))}%"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.5
            thickness = 1
            (text_w, text_h), baseline = cv2.getTextSize(label, font, font_scale, thickness)
            pad_x = 5
            pad_y = 4
            pill_w = text_w + pad_x * 2
            pill_h = text_h + pad_y * 2

            pill_x1 = max(0, min(canvas_w - pill_w, x1))
            pill_y1 = y1 - pill_h - 2 if y1 - pill_h - 2 >= 0 else min(canvas_h - pill_h, y1)
            pill_x2 = min(canvas_w - 1, pill_x1 + pill_w)
            pill_y2 = min(canvas_h - 1, pill_y1 + pill_h)

            cv2.rectangle(canvas, (pill_x1, pill_y1), (pill_x2, pill_y2), (15, 23, 42), -1)
            cv2.rectangle(canvas, (pill_x1, pill_y1), (pill_x2, pill_y2), color, 1)
            text_x = pill_x1 + pad_x
            text_y = pill_y2 - pad_y - max(0, baseline // 2) + 1
            cv2.putText(
                canvas,
                label,
                (text_x, text_y),
                font,
                font_scale,
                (248, 250, 252),
                thickness,
                cv2.LINE_AA,
            )

    ok, encoded = cv2.imencode(".jpg", canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
    if not ok:
        return ""
    b64 = base64.b64encode(encoded.tobytes()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def _resolve_inference_imgsz(
    width: int,
    height: int,
    resolution_mode: str,
    stride: int = 32,
) -> tuple[int, int] | int:
    """Calcula el tamaño de entrada (imgsz) preservando la resolución nativa cuando resolution_mode='native'."""
    if resolution_mode == "640":
        return 640
    if resolution_mode == "1280":
        return 1280
    aligned_h = int(math.ceil(height / stride) * stride)
    aligned_w = int(math.ceil(width / stride) * stride)
    return (aligned_h, aligned_w)


def analyze_video_stream(
    video_path: str,
    config: AnalysisConfig,
    original_filename: str,
) -> Iterator[dict[str, Any]]:
    """
    Ejecuta inferencia YOLO26 + ByteTrack + LineZone sin generar archivos de video.
    Emite eventos de progreso cada 5% de avance real y el reporte final al 100%.
    """
    start_time = time.perf_counter()
    model = get_yolo_model(config.model_name)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("No fue posible abrir el archivo de video con OpenCV.")

    try:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        raw_fps = float(cap.get(cv2.CAP_PROP_FPS))
        fps = raw_fps if raw_fps > 0.0 else 30.0
        reported_total_frames = max(0, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))

        if width <= 0 or height <= 0:
            raise ValueError("El video no contiene dimensiones de fotograma válidas.")

        line_states = _build_line_states(config.lines, width=width, height=height)

        active_class_ids = [
            CATEGORY_TO_CLASS_ID[c]
            for c in config.enabled_classes
            if c in CATEGORY_TO_CLASS_ID
        ] or VEHICLE_CLASS_IDS

        raw_stride = getattr(model, "stride", 32)
        model_stride = (
            int(raw_stride)
            if isinstance(raw_stride, (int, float))
            else int(max(raw_stride))
        )
        inference_imgsz = _resolve_inference_imgsz(
            width,
            height,
            config.resolution_mode,
            stride=model_stride,
        )

        effective_frame_rate = max(1, int(fps / config.frame_stride))
        byte_tracker = _ByteTrackWrapper(
            frame_rate=effective_frame_rate,
            confidence=config.confidence,
            moto_boost=config.moto_boost,
        )
        predict_conf = byte_tracker.min_predict_conf

        yield ProgressEvent(
            progress=0,
            current_frame=0,
            total_frames=reported_total_frames,
            metrics=_build_metrics(line_states),
        ).model_dump()

        frame_idx = 0
        analyzed_frames = 0
        last_emitted_progress = 0
        last_preview_time = 0.0
        active_count = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_idx += 1
            crossed_any_line = False
            is_analyzed_frame = (frame_idx - 1) % config.frame_stride == 0

            if is_analyzed_frame:
                analyzed_frames += 1
                results = model.predict(
                    frame,
                    imgsz=inference_imgsz,
                    conf=predict_conf,
                    classes=active_class_ids,
                    verbose=False,
                )[0]
                tracked_detections = byte_tracker.update(results, frame)

                if (
                    len(tracked_detections) > 0
                    and tracked_detections.tracker_id is not None
                    and tracked_detections.class_id is not None
                ):
                    active_count = len(tracked_detections)
                    for state in line_states:
                        crossed_in, crossed_out = state.zone.trigger(
                            detections=tracked_detections
                        )
                        if np.any(crossed_in) or np.any(crossed_out):
                            crossed_any_line = True
                        _accumulate_crossings(
                            state.counts_in,
                            tracked_detections.class_id,
                            crossed_in,
                        )
                        _accumulate_crossings(
                            state.counts_out,
                            tracked_detections.class_id,
                            crossed_out,
                        )
                else:
                    active_count = 0

            current_pct = (
                min(99, int((frame_idx * 100) / reported_total_frames))
                if reported_total_frames > 0
                else 0
            )

            if config.live_preview and is_analyzed_frame:
                now = time.perf_counter()
                should_emit_preview = (
                    (analyzed_frames == 1)
                    or crossed_any_line
                    or (now - last_preview_time >= 0.22)
                    or (current_pct >= last_emitted_progress + 5)
                )
                if should_emit_preview:
                    last_preview_time = now
                    if current_pct > last_emitted_progress:
                        last_emitted_progress = current_pct
                    yield ProgressEvent(
                        progress=current_pct,
                        current_frame=frame_idx,
                        total_frames=reported_total_frames,
                        active_detections=active_count,
                        preview_frame=_encode_preview_frame(frame, tracked_detections),
                        metrics=_build_metrics(line_states),
                    ).model_dump()
            elif not config.live_preview and reported_total_frames > 0:
                if current_pct >= last_emitted_progress + 5:
                    last_emitted_progress = (current_pct // 5) * 5
                    yield ProgressEvent(
                        progress=last_emitted_progress,
                        current_frame=frame_idx,
                        total_frames=reported_total_frames,
                        active_detections=active_count,
                        metrics=_build_metrics(line_states),
                    ).model_dump()

        final_total_frames = max(reported_total_frames, frame_idx)

        if last_emitted_progress < 100:
            yield ProgressEvent(
                progress=100,
                current_frame=frame_idx,
                total_frames=final_total_frames,
                active_detections=active_count,
                metrics=_build_metrics(line_states),
            ).model_dump()

        processing_time_sec = round(time.perf_counter() - start_time, 3)
        duration_sec = round(frame_idx / fps, 3) if fps > 0 else 0.0

        metadata = VideoMetadata(
            filename=original_filename,
            width=width,
            height=height,
            fps=round(fps, 3),
            total_frames=final_total_frames,
            analyzed_frames=analyzed_frames,
            duration_sec=duration_sec,
        )

        yield CompletedEvent(
            processing_time_sec=processing_time_sec,
            video_metadata=metadata,
            metrics=_build_metrics(line_states),
        ).model_dump()
    finally:
        cap.release()
