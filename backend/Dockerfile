FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1

WORKDIR /app

# Librerías mínimas de runtime para OpenCV headless y PyTorch/Ultralytics
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Instalar uv desde la imagen oficial de Astral
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Instalar dependencias sin el paquete editable para aprovechar el caché de capas
COPY pyproject.toml ./
RUN uv sync --no-dev --no-install-project

# Pre-descargar y cachear los pesos de YOLO26 nano dentro de la imagen
RUN uv run python -c "from ultralytics import YOLO; YOLO('yolo26n.pt')"

# Copiar el código de la aplicación
COPY app ./app

EXPOSE 8000

# Respeta la variable PORT inyectada por plataformas Cloud (Cloud Run, Railway, Render) con fallback a 8000
CMD ["sh", "-c", "uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
