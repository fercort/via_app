# Traffic Counter YOLO26 — Aforo y Clasificación Vehicular

Aplicación web full-stack lista para producción diseñada para el aforo y clasificación automática de tráfico vehicular mediante **líneas virtuales interactivas**, utilizando **YOLO26** (`ultralytics`), **ByteTrack** y **LineZone** (`supervision`), con streaming de progreso en tiempo real (NDJSON) y cero renderizado de video en servidor.

---

## Arquitectura del Monorepo

```text
traffic-counter-yolo26/
├── .gitignore
├── README.md
├── frontend/                 # React 18 + TypeScript + Vite + TailwindCSS (desplegable en Vercel)
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── index.css
│       ├── main.tsx
│       ├── components/
│       │   ├── LineCanvasEditor.tsx
│       │   ├── MetricsGrid.tsx
│       │   └── VideoDropzone.tsx
│       ├── types/
│       │   └── index.ts
│       └── utils/
│           └── exportUtils.ts
└── backend/                  # FastAPI + Python 3.11 + uv + YOLO26 + ByteTrack (Docker Cloud)
    ├── .env.example
    ├── Dockerfile
    ├── pyproject.toml
    └── app/
        ├── __init__.py
        ├── main.py
        ├── processor.py
        └── schemas.py
```

### Flujo de Procesamiento
1. **Extracción en Navegador**: Al soltar un video (`.mp4`, `.avi`, `.mov`), el frontend extrae localmente el primer fotograma (`currentTime = 0.1`) y lo proyecta en un `<canvas>` responsivo manteniendo exactamente la relación de aspecto original.
2. **Trazado Normalizado**: El usuario dibuja múltiples líneas virtuales haciendo clic en **Punto A** y **Punto B**; las coordenadas se almacenan normalizadas en `[0.0, 1.0]` con indicadores direccionales claros para **IN** y **OUT**.
3. **Inferencia Streaming sin VideoWriter**: `POST /api/analyze` recibe el video y la configuración JSON, guarda temporalmente el archivo con `NamedTemporaryFile` (garantizando borrado inmediato en `try...finally`), ejecuta YOLO26 filtrando exclusivamente clases COCO vehiculares (`2: car`, `3: motorcycle`, `5: bus`, `7: truck`), mantiene tracking con `sv.ByteTrack` calibrado por `frame_stride` y evalúa cada `sv.LineZone`.
4. **Progreso en Vivo y Exportación**: El backend emite eventos JSON línea por línea cada 5% de avance real y el frontend muestra el porcentaje, cronómetro en vivo, malla de KPIs/resultados y descarga directa en **CSV (Excel)** y **JSON**.

---

## 1. Ejecución en Local (`localhost`)

### Requisitos previos
- **Backend**: Python `>= 3.11` y [`uv`](https://docs.astral.sh/uv/)
- **Frontend**: Node.js `>= 18` y `npm`

### Paso A: Levantar el Backend (`http://localhost:8000`)

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

> **Nota**: No necesitas crear `.env` para correr en local. Si `ALLOWED_ORIGINS` no está definida, el backend habilita automáticamente `http://localhost:5173` y `http://127.0.0.1:5173`. En la primera ejecución, Ultralytics descargará `yolo26n.pt` automáticamente si no existe en caché.

### Paso B: Levantar el Frontend (`http://localhost:5173`)

En una segunda terminal:

```bash
cd frontend
npm install
npm run dev
```

> **Nota**: Tampoco requiere `.env` en local. El cliente usa `import.meta.env.VITE_API_URL || "http://localhost:8000"`.

Abre `http://localhost:5173` en tu navegador.

---

## 2. Ejecución Local con Docker (Backend)

El `Dockerfile` utiliza `python:3.11-slim`, `uv`, `opencv-python-headless` (evitando errores de `libGL.so.1`) y pre-descarga `yolo26n.pt` durante el build:

```bash
cd backend
docker build -t traffic-counter-backend .
docker run --rm -p 8000:8000 \
  -e ALLOWED_ORIGINS="http://localhost:5173" \
  traffic-counter-backend
```

Verifica el estado en `http://localhost:8000/health`.

---

## 3. Despliegue en Producción (Sin cambios de código)

### Paso 1: Subir el repositorio a GitHub
```bash
git init
git add .
git commit -m "feat: initial traffic counter yolo26 full-stack monorepo"
git branch -M main
git remote add origin https://github.com/tu-usuario/traffic-counter-yolo26.git
git push -u origin main
```

### Paso 2: Desplegar el Backend en la Nube (Docker Container)
Compatible con **Google Cloud Run**, **Railway**, **Render**, **Fly.io** o **AWS App Runner / ECS**:
1. Configura la carpeta raíz / Dockerfile en `backend/Dockerfile`.
2. Expón el puerto `8000` (el contenedor lee `$PORT` si la plataforma lo inyecta o usa `8000` por defecto).
3. Define la variable de entorno:
   ```env
   ALLOWED_ORIGINS=https://tu-app.vercel.app,http://localhost:5173
   ```
4. Obtén la URL pública HTTPS del servicio (ejemplo: `https://traffic-api.up.railway.app`).

### Paso 3: Desplegar el Frontend en Vercel
1. Importa el repositorio desde GitHub en **Vercel**.
2. Configura **Root Directory** como `frontend`.
3. Vercel detectará automáticamente **Vite** (`npm run build`, salida `dist`).
4. En **Environment Variables**, añade:
   - `VITE_API_URL` = `https://traffic-api.up.railway.app` (sin barra final `/`).
5. Haz clic en **Deploy** y actualiza `ALLOWED_ORIGINS` en el backend con el dominio final `.vercel.app` si es necesario.
