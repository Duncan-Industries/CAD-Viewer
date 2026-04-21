/**
 * Electron main process.
 *
 * Startup sequence:
 *  1. Open the BrowserWindow immediately
 *  2. Renderer drives setup via IPC (check Python → download → install → start backend)
 *  3. Kill backend on app quit
 */

import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn, execFile, ChildProcess } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Port the Python backend listens on.
const BACKEND_PORT = 48_321;

// ---------------------------------------------------------------------------
// uv paths — uv is bundled in resources/uv/
// ---------------------------------------------------------------------------

function getUvExe(): string {
  const ext = process.platform === "win32" ? ".exe" : "";
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "uv", `uv${ext}`);
  }
  // Dev: look in build-resources/uv/ relative to repo root
  return path.join(__dirname, `../../build-resources/uv/uv${ext}`);
}

function getVenvDir(): string {
  return path.join(app.getPath("userData"), "cadviewer-venv");
}

function getVenvPython(): string {
  return process.platform === "win32"
    ? path.join(getVenvDir(), "Scripts", "python.exe")
    : path.join(getVenvDir(), "bin", "python3");
}

// Alias used throughout
function getAppPython(): string {
  return getVenvPython();
}

function appPythonExists(): boolean {
  try {
    fs.accessSync(getAppPython());
    return true;
  } catch {
    return false;
  }
}

// uv stores its own Python downloads here (isolated from system)
function getUvCacheDir(): string {
  return path.join(app.getPath("userData"), "uv-cache");
}

type BackendStatus = "stopped" | "starting" | "ready" | "error";

let backend: ChildProcess | null = null;
let backendStatus: BackendStatus = "stopped";
let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendProgress(
  stage: string,
  percent: number,
  message: string,
): void {
  mainWindow?.webContents.send("setup:progress", { stage, percent, message });
}

function getBackendBinary(): { cmd: string; args: string[]; cwd?: string } {
  if (app.isPackaged) {
    const ext = process.platform === "win32" ? ".exe" : "";
    const bin = path.join(
      process.resourcesPath,
      "backend",
      `cadviewer-api${ext}`,
    );
    return { cmd: bin, args: [] };
  }

  // Dev: __dirname = frontend/out/main/ → ../../../ = repo root
  const ext = process.platform === "win32" ? ".exe" : "";
  const repoRoot = path.resolve(__dirname, "../../..");
  const devBin = path.join(repoRoot, "backend", "dist", `cadviewer-api${ext}`);
  console.log(`[backend] devBin path: ${devBin} (exists: ${fs.existsSync(devBin)})`);
  if (fs.existsSync(devBin)) {
    return { cmd: devBin, args: [] };
  }

  // Fallback: run via uvicorn using the app-local venv (or system python)
  const backendDir = path.join(repoRoot, "backend");
  console.log(`[backend] uvicorn cwd: ${backendDir} (exists: ${fs.existsSync(backendDir)})`);
  const python = appPythonExists() ? getAppPython() : (process.platform === "win32" ? "python" : "python3");
  return getBackendBinaryWithPython(python, backendDir);
}

function getBackendBinaryWithPython(
  pythonExe: string,
  cwd?: string,
): { cmd: string; args: string[]; cwd?: string } {
  const backendDir = cwd ??
    (app.isPackaged
      ? path.join(process.resourcesPath, "backend")
      : path.join(path.resolve(__dirname, "../../.."), "backend"));
  return {
    cmd: pythonExe,
    args: [
      "-m",
      "uvicorn",
      "main:app",
      "--port",
      String(BACKEND_PORT),
      "--log-level",
      "warning",
    ],
    cwd: backendDir,
  };
}

function waitForBackend(port: number, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("Backend did not start within 90 seconds."));
      }
      const req = http.get(
        `http://127.0.0.1:${port}/api/health`,
        { timeout: 2000 },
        (res) => {
          if (res.statusCode === 200) return resolve();
          setTimeout(attempt, 1500);
        },
      );
      req.on("error", () => setTimeout(attempt, 1500));
      req.on("timeout", () => {
        req.destroy();
        setTimeout(attempt, 1500);
      });
    };
    attempt();
  });
}

// ---------------------------------------------------------------------------
// IPC: python:check — checks for app-local venv, then whether uv is available
// ---------------------------------------------------------------------------

ipcMain.handle("python:check", async () => {
  // In packaged builds the PyInstaller binary is self-contained — no setup needed
  if (app.isPackaged) {
    const ext = process.platform === "win32" ? ".exe" : "";
    const bin = path.join(process.resourcesPath, "backend", `cadviewer-api${ext}`);
    if (fs.existsSync(bin)) {
      return { found: true, version: "bundled", embedded: true, bundled: true };
    }
  }

  // Dev: also skip setup if a local PyInstaller binary exists
  const ext = process.platform === "win32" ? ".exe" : "";
  const devBin = path.join(path.resolve(__dirname, "../../.."), "backend", "dist", `cadviewer-api${ext}`);
  if (fs.existsSync(devBin)) {
    return { found: true, version: "bundled", embedded: true, bundled: true };
  }

  // uv is always bundled — treat it like "bundled" so UI skips the download step
  const uvExe = getUvExe();
  const uvAvailable = fs.existsSync(uvExe);

  // If venv already exists, verify python works AND key packages are installed
  if (appPythonExists()) {
    try {
      const version = await runPython(getAppPython(), ["--version"]);
      // Also check uvicorn is importable — guards against partial installs
      await runPython(getAppPython(), ["-c", "import uvicorn"]);
      return { found: true, version: version.trim(), embedded: true, bundled: uvAvailable };
    } catch {
      // venv broken or incomplete — fall through to reinstall
    }
  }

  // uv is present — signal that we can install without a separate download
  if (uvAvailable) {
    return { found: false, bundled: true };
  }

  return { found: false, bundled: false };
});

function runPython(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve((stdout || stderr).trim());
    });
  });
}

// ---------------------------------------------------------------------------
// IPC: python:download — no-op when uv is bundled (uv fetches Python itself)
// ---------------------------------------------------------------------------

ipcMain.handle("python:download", async () => {
  // uv manages its own Python downloads internally — nothing to do here
  sendProgress("download", 100, "Runtime bundled — no download needed.");
  return null;
});

// ---------------------------------------------------------------------------
// IPC: python:install — uv creates venv + installs deps (all platforms)
// ---------------------------------------------------------------------------

ipcMain.handle("python:install", async () => {
  const uv = getUvExe();
  if (!fs.existsSync(uv)) {
    throw new Error(`uv not found at ${uv}. Please reinstall CADViewer.`);
  }

  const venvDir = getVenvDir();

  // Clean up stale venv so retries start fresh
  if (fs.existsSync(venvDir)) {
    fs.rmSync(venvDir, { recursive: true, force: true });
  }

  // Base env: keep all uv state inside userData, never touch system
  const uvBase = {
    ...process.env,
    UV_CACHE_DIR: getUvCacheDir(),
    UV_PYTHON_INSTALL_DIR: path.join(app.getPath("userData"), "uv-python"),
    UV_PYTHON_DOWNLOADS: "automatic",
  };

  sendProgress("install", 10, "Creating Python 3.11 environment…");

  // uv venv: creates the venv and auto-downloads Python 3.11 if needed
  await spawnPromise(uv, ["venv", venvDir, "--python", "3.11"], uvBase);

  // Verify the venv python actually exists before trying to install into it
  const venvPy = getVenvPython();
  if (!fs.existsSync(venvPy)) {
    throw new Error(`Venv creation appeared to succeed but python not found at: ${venvPy}`);
  }

  sendProgress("install", 30, "Installing components (this may take a few minutes)…");

  const requirementsTxt = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "requirements.txt")
    : path.resolve(__dirname, "../../backend/requirements.txt");

  if (!fs.existsSync(requirementsTxt)) {
    throw new Error(`requirements.txt not found at: ${requirementsTxt}`);
  }

  // uv pip install --python <venvDir> installs into the venv's site-packages.
  // Per uv docs: "--python also accepts a path to the root directory of a virtual environment"
  await spawnPromiseWithProgress(
    uv,
    ["pip", "install", "--python", venvDir, "--index-strategy", "unsafe-best-match", "-r", requirementsTxt],
    (line) => {
      const m = line.match(/(?:Resolved|Prepared|Installed|Downloading)\s+(.+)/);
      if (m) sendProgress("install", 50, m[0].slice(0, 70));
    },
    uvBase,
  );

  sendProgress("install", 100, "Python environment ready.");
  return true;
});

function spawnPromiseWithProgress(
  cmd: string,
  args: string[],
  onLine: (line: string) => void,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: env ?? process.env });
    const outLines: string[] = [];
    let buf = "";
    const handleChunk = (d: Buffer) => {
      const s = d.toString();
      outLines.push(s);
      buf += s;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) onLine(line.trim());
    };
    proc.stdout?.on("data", (d: Buffer) => { process.stdout.write(`[setup] ${d.toString()}`); handleChunk(d); });
    proc.stderr?.on("data", (d: Buffer) => { process.stderr.write(`[setup] ${d.toString()}`); handleChunk(d); });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const tail = outLines.slice(-30).join("").trim();
        reject(
          new Error(
            `'${path.basename(cmd)} ${args.slice(0, 3).join(" ")}…' failed (exit ${code}):\n\n${tail}`,
          ),
        );
      }
    });
    proc.on("error", reject);
  });
}

function spawnPromise(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: env ?? process.env });
    const outLines: string[] = [];
    proc.stdout?.on("data", (d: Buffer) => {
      const s = d.toString();
      outLines.push(s);
      process.stdout.write(`[setup] ${s}`);
    });
    proc.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      outLines.push(s);
      process.stderr.write(`[setup] ${s}`);
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const tail = outLines.slice(-30).join("").trim();
        reject(
          new Error(
            `'${path.basename(cmd)} ${args.slice(0, 3).join(" ")}…' failed (exit ${code}):\n\n${tail}`,
          ),
        );
      }
    });
    proc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// IPC: backend:start — spawn + wait for /api/health
// ---------------------------------------------------------------------------

ipcMain.handle("backend:start", async () => {
  if (backendStatus === "ready") return { ok: true };
  if (backendStatus === "starting") return { ok: false, reason: "already starting" };

  backendStatus = "starting";
  sendProgress("backend", 0, "Starting backend…");

  const { cmd, args, cwd } = getBackendBinary();

  const backendLog: string[] = [];

  backend = spawn(cmd, args, {
    cwd,
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      GLB_DIR: path.join(app.getPath("temp"), "cadviewer_glb"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  backend.stdout?.on("data", (d: Buffer) => {
    const s = d.toString();
    backendLog.push(s);
    process.stdout.write(`[backend] ${s}`);
  });
  backend.stderr?.on("data", (d: Buffer) => {
    const s = d.toString();
    backendLog.push(s);
    process.stderr.write(`[backend] ${s}`);
  });

  backend.on("exit", (code, signal) => {
    backendStatus = code === 0 ? "stopped" : "error";
    if (code !== 0 && !app.isQuitting) {
      const tail = backendLog.slice(-20).join("").trim();
      console.error(`[backend] exited (code=${code} signal=${signal})\n${tail}`);
      mainWindow?.webContents.send("setup:progress", {
        stage: "backend",
        percent: 0,
        message: `Startup failed (exit ${code}):\n${tail.slice(0, 300)}`,
      });
    }
  });

  try {
    await waitForBackend(BACKEND_PORT);
    backendStatus = "ready";
    sendProgress("backend", 100, "Backend ready.");
    return { ok: true };
  } catch (err) {
    backendStatus = "error";
    const tail = backendLog.slice(-20).join("").trim();
    return { ok: false, reason: `${String(err)}\n\n${tail}`.trim() };
  }
});

// ---------------------------------------------------------------------------
// IPC: backend:status
// ---------------------------------------------------------------------------

ipcMain.handle("backend:status", () => backendStatus);

// ---------------------------------------------------------------------------
// Create window — called immediately on app ready
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#020617",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  const rendererUrl = app.isPackaged
    ? `file://${path.join(__dirname, "../renderer/index.html")}`
    : "http://localhost:5173";

  mainWindow.loadURL(rendererUrl);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Electron {
    interface App {
      isQuitting?: boolean;
    }
  }
}

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("will-quit", () => {
  if (backend && !backend.killed) {
    backend.kill("SIGTERM");
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.whenReady().then(async () => {
  createWindow();
  // Start backend immediately — no setup screen needed
  try {
    const { cmd, args, cwd } = getBackendBinary();
    const backendLog: string[] = [];

    backendStatus = "starting";

    backend = spawn(cmd, args, {
      cwd,
      env: {
        ...process.env,
        PORT: String(BACKEND_PORT),
        GLB_DIR: path.join(app.getPath("temp"), "cadviewer_glb"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    backend.stdout?.on("data", (d: Buffer) => {
      const s = d.toString();
      backendLog.push(s);
      process.stdout.write(`[backend] ${s}`);
    });
    backend.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      backendLog.push(s);
      process.stderr.write(`[backend] ${s}`);
    });

    backend.on("exit", (code, signal) => {
      backendStatus = code === 0 ? "stopped" : "error";
      if (code !== 0 && !app.isQuitting) {
        const tail = backendLog.slice(-20).join("").trim();
        console.error(`[backend] exited (code=${code} signal=${signal})\n${tail}`);
        mainWindow?.webContents.send("setup:progress", {
          stage: "backend",
          percent: 0,
          message: `Startup failed (exit ${code}):\n${tail.slice(0, 300)}`,
        });
      }
    });

    await waitForBackend(BACKEND_PORT);
    backendStatus = "ready";
    mainWindow?.webContents.send("setup:progress", {
      stage: "backend",
      percent: 100,
      message: "ready",
    });
  } catch (err) {
    backendStatus = "error";
    console.error("[backend] failed to start:", err);
    mainWindow?.webContents.send("setup:progress", {
      stage: "backend",
      percent: 0,
      message: String(err),
    });
  }
});
