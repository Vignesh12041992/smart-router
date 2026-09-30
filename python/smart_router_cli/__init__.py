"""pipx entry point for smart-router.

The router itself is written in Node.js. This wrapper installs the matching
npm package into a private folder on first use, then runs it with the same
arguments. Works on Windows (cmd / PowerShell), macOS and Linux.
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

__version__ = "1.0.0"

NPM_PACKAGE = "laya-smart-router"
GIT_FALLBACK = "https://github.com/Vignesh12041992/smart-router/tarball/main"
MIN_NODE_MAJOR = 20


def _cache_root() -> Path:
    if os.environ.get("SMART_ROUTER_HOME"):
        return Path(os.environ["SMART_ROUTER_HOME"])
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = str(Path.home() / "Library" / "Caches")
    else:
        base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "laya-smart-router"


def _fail(msg: str) -> int:
    print(f"smart-router: {msg}", file=sys.stderr)
    return 1


def _node_ok(node: str) -> bool:
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return False
    match = re.match(r"v(\d+)", out.strip())
    return bool(match) and int(match.group(1)) >= MIN_NODE_MAJOR


def _install(npm: str, spec: str, prefix: Path) -> bool:
    prefix.mkdir(parents=True, exist_ok=True)
    print(f"smart-router: first run, installing {spec} (one time)...", file=sys.stderr)
    cmd = [npm, "install", "--prefix", str(prefix), "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error", spec]
    env = dict(os.environ)
    # Laya runs on CPU; skip onnxruntime's optional multi-hundred-MB GPU download.
    env.setdefault("ONNXRUNTIME_NODE_INSTALL", "skip")
    return subprocess.run(cmd, stdout=sys.stderr, env=env).returncode == 0


def main() -> int:
    node = shutil.which("node")
    npm = shutil.which("npm")
    if not node or not _node_ok(node):
        return _fail(f"Node.js {MIN_NODE_MAJOR}+ is required. Install it from https://nodejs.org and try again.")

    custom_spec = os.environ.get("SMART_ROUTER_NPM_SPEC")
    specs = [custom_spec] if custom_spec else [f"{NPM_PACKAGE}@{__version__}", GIT_FALLBACK]
    prefix = _cache_root() / (custom_spec and re.sub(r"[^A-Za-z0-9._-]+", "_", custom_spec)[-60:] or __version__)
    cli = prefix / "node_modules" / NPM_PACKAGE / "dist" / "cli.js"

    if not cli.exists():
        if not npm:
            return _fail("npm was not found. It comes with Node.js: https://nodejs.org")
        if not any(_install(npm, spec, prefix) and cli.exists() for spec in specs):
            shutil.rmtree(prefix, ignore_errors=True)
            return _fail("could not install the Node package. Check your internet connection and try again.")

    try:
        return subprocess.run([node, str(cli), *sys.argv[1:]]).returncode
    except KeyboardInterrupt:
        return 130
