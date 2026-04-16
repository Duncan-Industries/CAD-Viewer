# CADViewer

A CAD file viewer built with **Python (FastAPI)**, **React 19**, **Three.js** (via react-three-fiber), **Tailwind CSS v4**, and **Base UI**. Runs as a **web app** (Docker / local dev) or a native **desktop app** (Electron + electron-builder).

Supports viewing STEP, IGES, STL, OBJ, GLTF/GLB, PLY, OFF, and 3MF files with automatic extraction of embedded annotations, assembly trees, and file metadata.

---

## Features

- **3D Viewer** — orbit, pan, zoom, axis gizmo, infinite grid
- **View modes** — Solid, Wireframe, X-Ray (transparent)
- **Assembly tree** — hierarchical part/assembly browser with colour swatches
- **Annotations** — notes, GD&T, dimensions, and properties extracted from STEP/IGES headers
- **Metadata panel** — file format, author, organisation, created date, AP standard (AP203/AP214/AP242), units

---

## Tech stack

| Layer | Package | Version |
|---|---|---|
| Backend | FastAPI | ≥ 0.115 |
| Backend | CadQuery (OpenCASCADE) | ≥ 2.4 |
| Backend | trimesh | ≥ 4.5 |
| Frontend | React | 19 |
| Frontend | Vite | 6 |
| Frontend | Three.js | 0.175 |
| Frontend | @react-three/fiber | 9 |
| Frontend | @react-three/drei | 10 |
| Frontend | Tailwind CSS | v4 |
| Frontend | @base-ui-components/react | 1 |

---

## Quick start (Docker)

The easiest way — no Python or Node.js required on your machine.

```bash
# 1. Clone / enter the project
cd cadviewer

# 2. Build and start both services
docker compose up --build

# 3. Open in browser
#    Frontend → http://localhost:3000
#    API docs  → http://localhost:8000/docs
```

To stop:
```bash
docker compose down
```

---

## Local development

### Prerequisites

| Tool | Minimum version |
|---|---|
| Python | 3.11 |
| Node.js | 20 |
| npm | 9 |

### Backend

```bash
cd backend

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# Install dependencies
# cadquery pulls in pythonocc-core (OpenCASCADE) automatically.
# On Linux you may first need: sudo apt install libgl1-mesa-glx libgomp1
pip install -r requirements.txt

# Start the API server (hot-reload)
uvicorn main:app --reload --port 8000
```

The API is now at http://localhost:8000  
Interactive docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server (proxies /api → localhost:8000)
npm run dev
```

Open http://localhost:5173 in your browser.

### Build for production

```bash
cd frontend
npm run build        # output goes to frontend/dist/
```

---

## Project structure

```
cadviewer/
├── backend/
│   ├── main.py                      # FastAPI app, upload + serve endpoints
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── services/
│   │   ├── cad_processor.py         # CAD → GLB conversion (CadQuery + trimesh)
│   │   └── annotation_extractor.py  # Extracts metadata, assembly, annotations
│   └── models/
│       └── schemas.py               # Pydantic response models
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── nginx.conf                   # Used by Docker image
│   └── src/
│       ├── App.tsx                  # Root layout with tab panel
│       ├── index.css                # Tailwind v4 + global styles
│       ├── components/
│       │   ├── Viewer3D.tsx         # Three.js canvas, GLTF loader
│       │   ├── FileUpload.tsx       # Drag-and-drop file input
│       │   ├── Toolbar.tsx          # View mode switcher, open button
│       │   ├── AssemblyTree.tsx     # Collapsible part hierarchy
│       │   └── AnnotationsPanel.tsx # Annotation cards + metadata rows
│       ├── hooks/
│       │   └── useCADFile.ts        # Upload state machine
│       ├── services/
│       │   └── api.ts               # fetch wrappers
│       └── types/
│           └── cad.ts               # TypeScript interfaces
│
├── docker-compose.yml
└── .gitignore
```

---

## Supported file formats

| Extension | Format | Annotations extracted |
|---|---|---|
| `.step` / `.stp` | STEP (AP203/AP214/AP242) | Assembly tree, colours, notes, properties, author, GD&T |
| `.iges` / `.igs` | IGES | General Note entities (type 212), author, org |
| `.stl` | STL (ASCII or binary) | None |
| `.obj` | Wavefront OBJ | File comments (`# ...`) |
| `.glb` / `.gltf` | GLTF 2.0 | Pass-through (no conversion) |
| `.ply` | PLY | None |
| `.off` | OFF mesh | None |
| `.3mf` | 3MF | None |

---

## API reference

### `POST /api/upload`

Upload a CAD file. Returns JSON with the GLB URL, metadata, assembly tree, and annotations.

**Request:** `multipart/form-data` with field `file`.

**Response:**
```json
{
  "file_id": "uuid",
  "gltf_url": "/api/files/<uuid>.glb",
  "metadata": { "filename": "...", "format": "STEP", ... },
  "assembly": [ { "id": "...", "name": "...", "type": "assembly", "children": [...] } ],
  "annotations": [ { "id": "...", "type": "note", "text": "..." } ]
}
```

### `GET /api/files/{id}.glb`

Download the converted GLB file. Cached for 1 hour.

### `GET /api/health`

Returns `{"status": "ok"}`.

---

## Building the Electron desktop app

The Electron app bundles the React frontend and spawns the Python backend as a
sidecar process (a PyInstaller-compiled binary). Electron-builder packages
everything into a native installer.

### Step 1 — Build the Python backend binary

```bash
# macOS / Linux
./scripts/build-python.sh

# Windows (PowerShell)
cd backend
pip install pyinstaller
pyinstaller cadviewer-api.spec --distpath dist --noconfirm --clean
```

This produces `backend/dist/cadviewer-api` (or `.exe` on Windows).
The binary is ~150–250 MB because it bundles OpenCASCADE + Python.

### Step 2 — Build and package the Electron app

```bash
cd frontend
npm install

# Package for the current platform
npm run dist

# Cross-platform targets
npm run dist:win    # Windows NSIS installer
npm run dist:mac    # macOS DMG
npm run dist:linux  # AppImage + .deb
```

Output is in `frontend/release/`.

### Step 3 — Development with Electron hot-reload

```bash
# Terminal 1: FastAPI (required even in Electron dev mode)
cd backend && uvicorn main:app --port 48321 --reload

# Terminal 2: Electron + Vite
cd frontend && npm run dev:electron
```

### How it works

```
Electron main process
  ├─ spawns  backend/dist/cadviewer-api  (PyInstaller binary)
  │           ↳ FastAPI on 127.0.0.1:48321
  └─ opens   BrowserWindow → dist/renderer/index.html
              ↳ React app fetches /api/* → proxied to 127.0.0.1:48321
```

The backend process is killed automatically when the window closes.

### Icon assets

Place your icon files in `frontend/build-resources/`:
- `icon.ico` — Windows
- `icon.icns` — macOS
- `icon.png` — Linux (512×512 recommended)

---

## Notes on CadQuery / OpenCASCADE

- **cadquery** bundles its own compiled version of OpenCASCADE — no separate OCC install is needed.
- STEP annotation extraction uses the **XDE (Extended Data Exchange)** framework inside OCC. Assembly colours and names are available for AP214/AP242 files. For AP203 files only the header metadata is available.
- The conversion pipeline is: STEP/IGES → OCC tessellation → STL → trimesh → GLB.
- Large assemblies (hundreds of parts) may take 10–60 seconds to tessellate.
