/**
 * Electron main process.
 *
 * Startup sequence:
 *  1. Open the BrowserWindow immediately
 *  2. Renderer drives setup via IPC (check Python → download → install → start backend)
 *  3. Kill backend on app quit
 */

import { app, BrowserWindow, ipcMain, shell, net } from "electron";
import { spawn, execFile, ChildProcess } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Port the Python backend listens on.
const BACKEND_PORT = 48_321;

// Embeddable Python 3.11 zip (Windows) — ~12 MB, no system install needed
const PYTHON_EMBED_URL =
  "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip";
// get-pip bootstrap script
const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";

// Where the app-local Python lives (inside Electron userData, never in PATH)
function getEmbedDir(): string {
  return path.join(app.getPath("userData"), "python-embedded");
}

// Bundled zip shipped inside the installer under resources/python/
function getBundledZipPath(): string | null {
  const p = app.isPackaged
    ? path.join(process.resourcesPath, "python", "python-3.11-embed-amd64.zip")
    : path.join(__dirname, "../../build-resources/python/python-3.11-embed-amd64.zip");
  return fs.existsSync(p) ? p : null;
}

// The venv Python executable (used by backend at runtime on all platforms)
function getVenvPython(): string {
  const venvDir = path.join(app.getPath("userData"), "cadviewer-venv");
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python3");
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

  const backendDir = path.join(__dirname, "../../backend");
  const python = process.platform === "win32" ? "python" : "python3";
  return getBackendBinaryWithPython(python, backendDir);
}

function getBackendBinaryWithPython(
  pythonExe: string,
  cwd?: string,
): { cmd: string; args: string[]; cwd?: string } {
  const backendDir = cwd ??
    (app.isPackaged
      ? path.join(process.resourcesPath, "backend")
      : path.join(__dirname, "../../backend"));
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
// IPC: python:check — checks for app-local embedded Python first, then system
// ---------------------------------------------------------------------------

ipcMain.handle("python:check", async () => {
  const bundled = getBundledZipPath() !== null;

  // 1. Check if app-local venv is already set up
  if (appPythonExists()) {
    try {
      const version = await runPython(getAppPython(), ["--version"]);
      return { found: true, version: version.trim(), embedded: true, bundled };
    } catch {
      // venv broken, fall through
    }
  }

  // 2. Check system Python (used as venv bootstrap on Mac/Linux)
  if (process.platform !== "win32") {
    const candidates = ["python3", "python"];
    for (const cmd of candidates) {
      try {
        const version = await runPython(cmd, ["--version"]);
        const match = version.match(/Python (\d+)\.(\d+)/);
        if (match && parseInt(match[1]) === 3 && parseInt(match[2]) >= 9) {
          return { found: true, version: version.trim(), cmd, embedded: false, bundled };
        }
      } catch {
        // not available
      }
    }
  }

  return { found: false, bundled };
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
// IPC: python:download — download embeddable zip (Win) or get-pip (Mac/Linux)
// ---------------------------------------------------------------------------

ipcMain.handle("python:download", async () => {
  if (process.platform === "win32") {
    // Use bundled zip if available — no download needed
    const bundled = getBundledZipPath();
    if (bundled) {
      sendProgress("download", 100, "Using bundled Python runtime.");
      return bundled;
    }
    const destPath = path.join(app.getPath("userData"), "python-3.11-embed.zip");
    await downloadFile(PYTHON_EMBED_URL, destPath, "Downloading Python 3.11 (embedded)…");
    return destPath;
  }

  // macOS / Linux: venv is created from system python3, no zip needed
  return null;
});

async function downloadFile(
  url: string,
  destPath: string,
  label: string,
): Promise<void> {
  sendProgress("download", 0, label);
  await new Promise<void>((resolve, reject) => {
    const request = net.request(url);
    request.on("response", (response) => {
      const total = parseInt(
        (response.headers["content-length"] as string) || "0",
        10,
      );
      let received = 0;
      const out = fs.createWriteStream(destPath);
      response.on("data", (chunk: Buffer) => {
        received += chunk.length;
        out.write(chunk);
        if (total > 0) {
          const pct = Math.round((received / total) * 100);
          sendProgress("download", pct, `${label} ${pct}%`);
        }
      });
      response.on("end", () => out.end(() => resolve()));
      response.on("error", (err: Error) => { out.destroy(); reject(err); });
    });
    request.on("error", reject);
    request.end();
  });
  sendProgress("download", 100, "Download complete.");
}

// ---------------------------------------------------------------------------
// IPC: python:install — sets up app-local Python (never touches system PATH)
// ---------------------------------------------------------------------------

ipcMain.handle("python:install", async (_event, zipOrPipPath: string) => {
  // Clean up any stale partial installs so retries start fresh
  const venvDir = path.join(app.getPath("userData"), "cadviewer-venv");
  if (fs.existsSync(venvDir)) {
    fs.rmSync(venvDir, { recursive: true, force: true });
  }

  if (process.platform === "win32") {
    await installEmbeddedWindows(zipOrPipPath);
  } else {
    await installVenvUnix();
  }
  sendProgress("install", 100, "Python environment ready.");
  return true;
});

/**
 * Windows: extract embeddable zip → use it to create a proper venv →
 * pip-install backend deps into the venv.
 * The venv has a full site-packages layout, so heavy binary wheels work.
 * The embeddable zip itself is only used as the Python interpreter seed.
 */
async function installEmbeddedWindows(zipPath: string): Promise<void> {
  const embedDir = getEmbedDir();
  const venvDir = path.join(app.getPath("userData"), "cadviewer-venv");
  fs.mkdirSync(embedDir, { recursive: true });

  sendProgress("install", 5, "Extracting Python…");

  // Use PowerShell Expand-Archive (built-in on all modern Windows)
  await spawnPromise("powershell", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${embedDir}'`,
  ]);

  sendProgress("install", 20, "Bootstrapping pip…");

  // Patch _pth so the embedded interpreter can find its own stdlib
  const pthFiles = fs.readdirSync(embedDir).filter((f) => f.endsWith("._pth"));
  for (const pth of pthFiles) {
    const pthPath = path.join(embedDir, pth);
    let content = fs.readFileSync(pthPath, "utf8");
    content = content.replace(/^#import site/m, "import site");
    fs.writeFileSync(pthPath, content, "utf8");
  }

  // Bootstrap pip into the embeddable layout
  const getPipPath = path.join(embedDir, "get-pip.py");
  await downloadFile(GET_PIP_URL, getPipPath, "Downloading pip bootstrap…");
  const embedPy = path.join(embedDir, "python.exe");
  await spawnPromise(embedPy, [getPipPath, "--no-warn-script-location"]);

  sendProgress("install", 35, "Creating isolated Python environment…");

  // The embeddable zip does NOT ship venv or ensurepip.
  // Install virtualenv (pure Python wheel) into the embedded layout, then
  // use it to create a full venv that has a proper site-packages layout.
  await spawnPromise(embedPy, [
    "-m", "pip", "install", "--no-warn-script-location", "virtualenv",
  ]);
  await spawnPromise(embedPy, ["-m", "virtualenv", "--clear", venvDir]);

  sendProgress("install", 50, "Installing backend dependencies (this may take a while)…");

  const requirementsTxt = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "requirements.txt")
    : path.join(__dirname, "../../backend/requirements.txt");

  const venvPy = getVenvPython();
  await spawnPromise(venvPy, ["-m", "pip", "install", "--no-warn-script-location", "--upgrade", "pip"]);
  await spawnPromiseWithProgress(
    venvPy,
    ["-m", "pip", "install", "--no-warn-script-location", "-r", requirementsTxt],
    (line) => {
      const m = line.match(/(?:Collecting|Installing collected packages:|Successfully installed)\s+(.+)/);
      if (m) sendProgress("install", 60, `Installing: ${m[1].slice(0, 60)}`);
    },
  );
}

/**
 * macOS / Linux: create a venv inside userData using whatever system python3
 * is available, then pip-install backend deps into it.
 */
async function installVenvUnix(): Promise<void> {
  const venvDir = path.join(app.getPath("userData"), "cadviewer-venv");

  sendProgress("install", 10, "Creating Python virtual environment…");

  // Find a usable system python3
  const systemPython = await (async () => {
    for (const cmd of ["python3", "python"]) {
      try {
        await runPython(cmd, ["--version"]);
        return cmd;
      } catch { /* skip */ }
    }
    throw new Error(
      "No Python 3 found on this system. Please install Python 3.9+ from python.org.",
    );
  })();

  await spawnPromise(systemPython, ["-m", "venv", "--clear", venvDir]);

  sendProgress("install", 40, "Installing backend dependencies (this may take a while)…");

  const pyExe = getAppPython();
  const requirementsTxt = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "requirements.txt")
    : path.join(__dirname, "../../backend/requirements.txt");

  await spawnPromise(pyExe, ["-m", "pip", "install", "--upgrade", "pip"]);
  await spawnPromiseWithProgress(
    pyExe,
    ["-m", "pip", "install", "-r", requirementsTxt],
    (line) => {
      const m = line.match(/(?:Collecting|Installing collected packages:|Successfully installed)\s+(.+)/);
      if (m) sendProgress("install", 60, `Installing: ${m[1].slice(0, 60)}`);
    },
  );
}

function spawnPromiseWithProgress(
  cmd: string,
  args: string[],
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
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

function spawnPromise(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
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

  // Use app-local Python if available, otherwise fall back to getBackendBinary()
  const { cmd, args, cwd } = appPythonExists()
    ? getBackendBinaryWithPython(getAppPython())
    : getBackendBinary();

  backend = spawn(cmd, args, {
    cwd,
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      GLB_DIR: path.join(app.getPath("temp"), "cadviewer_glb"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  backend.stdout?.on("data", (d: Buffer) =>
    process.stdout.write(`[backend] ${d.toString()}`),
  );
  backend.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[backend] ${d.toString()}`),
  );

  backend.on("exit", (code, signal) => {
    backendStatus = code === 0 ? "stopped" : "error";
    if (code !== 0 && !app.isQuitting) {
      console.error(
        `[backend] exited unexpectedly (code=${code} signal=${signal})`,
      );
      mainWindow?.webContents.send("setup:progress", {
        stage: "backend",
        percent: 0,
        message: `Backend crashed (exit code ${code})`,
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
    return { ok: false, reason: String(err) };
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

// Open the window immediately — backend setup is driven by the renderer via IPC
app.whenReady().then(() => {
  createWindow();
});
