# PyInstaller spec file for the CADViewer backend.
# Run with:  pyinstaller cadviewer-api.spec

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

# Collect all hidden imports needed by cadquery / trimesh / fastapi
hidden_imports = [
    # Our app modules (belt-and-suspenders — run.py imports them directly)
    "main",
    "services",
    "services.cad_processor",
    "services.annotation_extractor",
    "models",
    "models.schemas",
    # FastAPI / uvicorn
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "anyio",
    "anyio._backends._asyncio",
    "email.mime.text",
    "email.mime.multipart",
    # Pydantic
    "pydantic.deprecated.class_validators",
    # cadquery / OCP  (these are large; collect everything)
    "cadquery",
    "OCP",
    # trimesh
    "trimesh",
    "trimesh.exchange.gltf",
    "trimesh.exchange.obj",
    "trimesh.exchange.stl",
    "pygltflib",
]

datas = []
binaries = []

for package_name in ("cadquery", "OCP", "trimesh", "pygltflib"):
    package_datas, package_binaries, package_hidden_imports = collect_all(package_name)
    datas += package_datas
    binaries += package_binaries
    for hidden_import in package_hidden_imports + collect_submodules(package_name):
        if hidden_import not in hidden_imports:
            hidden_imports.append(hidden_import)

a = Analysis(
    ["run.py"],
    pathex=[str(Path(".").resolve())],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "IPython", "jupyter"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# Remove test / example data to keep binary smaller
a.datas = [d for d in a.datas if not any(
    ex in d[0] for ex in ["test", "example", "sample", "doc"]
)]

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="cadviewer-api",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # keep console so errors are visible during dev
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
