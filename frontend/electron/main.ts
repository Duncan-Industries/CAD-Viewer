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

// The python executable for this app
function getAppPython(): string {
  if (process.platform === "win32") {
    return path.join(getEmbedDir(), "python.exe");
  }
  // macOS / Linux: venv inside userData
  const venvDir = path.join(app.getPath("userData"), "python-venv");
  return process.platform === "darwin"
    ? path.join(venvDir, "bin", "python3")
    : path.join(venvDir, "bin", "python3");
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
  // 1. Check if app-local Python is already set up
  if (appPythonExists()) {
    try {
      const version = await runPython(getAppPython(), ["--version"]);
      return { found: true, version: version.trim(), embedded: true };
    } catch {
      // embedded Python broken, fall through
    }
  }

  // 2. Check system Python (only used as a venv bootstrap on Mac/Linux)
  if (process.platform !== "win32") {
    const candidates = ["python3", "python"];
    for (const cmd of candidates) {
      try {
        const version = await runPython(cmd, ["--version"]);
        const match = version.match(/Python (\d+)\.(\d+)/);
        if (match && parseInt(match[1]) === 3 && parseInt(match[2]) >= 9) {
          return { found: true, version: version.trim(), cmd, embedded: false };
        }
      } catch {
        // not available
      }
    }
  }

  return { found: false };
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
    const destPath = path.join(
      app.getPath("userData"),
      "python-3.11-embed.zip",
    );
    await downloadFile(PYTHON_EMBED_URL, destPath, "Downloading Python 3.11 (embedded)…");
    return destPath;
  }

  // macOS / Linux: just need get-pip.py once the venv is created
  const destPath = path.join(app.getPath("userData"), "get-pip.py");
  await downloadFile(GET_PIP_URL, destPath, "Downloading pip bootstrap…");
  return destPath; // path not used directly on these platforms
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
  if (process.platform === "win32") {
    await installEmbeddedWindows(zipOrPipPath);
  } else {
    await installVenvUnix();
  }
  sendProgress("install", 100, "Python environment ready.");
  return true;
});

/**
 * Windows: extract embeddable zip → patch python311._pth → bootstrap pip
 * → install backend deps. Everything lives in userData/python-embedded/.
 */
async function installEmbeddedWindows(zipPath: string): Promise<void> {
  const embedDir = getEmbedDir();
  fs.mkdirSync(embedDir, { recursive: true });

  sendProgress("install", 5, "Extracting Python…");

  // Use PowerShell Expand-Archive (built-in on all modern Windows)
  await spawnPromise("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${embedDir}'`,
  ]);

  sendProgress("install", 30, "Configuring embedded Python…");

  // The embeddable zip ships with python311._pth which has `import site`
  // commented out — uncomment it so pip packages are importable.
  const pthFiles = fs
    .readdirSync(embedDir)
    .filter((f) => f.endsWith("._pth"));
  for (const pth of pthFiles) {
    const pthPath = path.join(embedDir, pth);
    let content = fs.readFileSync(pthPath, "utf8");
    content = content.replace(/^#import site/m, "import site");
    fs.writeFileSync(pthPath, content, "utf8");
  }

  sendProgress("install", 40, "Bootstrapping pip…");

  // Download get-pip.py into the embed dir and run it
  const getPipPath = path.join(embedDir, "get-pip.py");
  await downloadFile(GET_PIP_URL, getPipPath, "Downloading pip…");

  const pyExe = getAppPython();
  await spawnPromise(pyExe, [getPipPath, "--no-warn-script-location"]);

  sendProgress("install", 60, "Installing backend dependencies…");

  const requirementsTxt = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "requirements.txt")
    : path.join(__dirname, "../../backend/requirements.txt");

  await spawnPromise(pyExe, [
    "-m",
    "pip",
    "install",
    "--no-warn-script-location",
    "-r",
    requirementsTxt,
  ]);
}

/**
 * macOS / Linux: create a venv inside userData using whatever system python3
 * is available, then pip-install backend deps into it.
 */
async function installVenvUnix(): Promise<void> {
  const venvDir = path.join(app.getPath("userData"), "python-venv");

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

  await spawnPromise(systemPython, ["-m", "venv", "--upgrade-deps", venvDir]);

  sendProgress("install", 40, "Installing backend dependencies…");

  const pyExe = getAppPython();
  const requirementsTxt = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "requirements.txt")
    : path.join(__dirname, "../../backend/requirements.txt");

  await spawnPromise(pyExe, ["-m", "pip", "install", "-r", requirementsTxt]);
}

function spawnPromise(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout?.on("data", (d: Buffer) =>
      process.stdout.write(`[setup] ${d.toString()}`),
    );
    proc.stderr?.on("data", (d: Buffer) =>
      process.stderr.write(`[setup] ${d.toString()}`),
    );
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command '${cmd} ${args.join(" ")}' exited with code ${code}`));
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
