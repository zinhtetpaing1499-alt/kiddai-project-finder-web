#!/bin/bash
set -e
APP_DIR="$HOME/Library/Application Support/Kiddai/SketchUp Helper"
mkdir -p "$APP_DIR"
PYTHON="$(command -v python3 || true)"
if ! "$PYTHON" -c 'import sys' >/dev/null 2>&1; then
  osascript -e 'display dialog "Python 3 is required once. After it finishes installing, paste the script in Terminal again." buttons {"OK"} default button "OK"'
  open "https://www.python.org/downloads/"
  exit 1
fi
cat > "$APP_DIR/sketchup_helper.py" << 'HELPER'
#!/usr/bin/env python3
"""Local helper for the Kiddai site. Leave this window open.

The website finds the .skp file. This program downloads it and opens SketchUp.
It listens only on this computer: http://127.0.0.1:17341
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 17341
MAX_BYTES = 800 * 1024 * 1024
FILE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,}$")
ALLOWED_ORIGINS = {
    "https://kiddai.netlify.app",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
}


def save_dir() -> Path:
    folder = Path.home() / "Kiddai" / "SketchUp"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def safe_file_name(name: str) -> str:
    cleaned = Path(name.replace("\\", "/")).name.strip()
    cleaned = re.sub(r'[<>:"|?*]', "_", cleaned)
    if not cleaned.lower().endswith(".skp"):
        cleaned = f"{cleaned or 'model'}.skp"
    return cleaned[:180]


def find_sketchup() -> tuple[str, str]:
    if sys.platform == "darwin":
        applications = Path("/Applications")
        matches = sorted(applications.glob("SketchUp*/SketchUp.app"), reverse=True)
        if matches:
            return str(matches[0]), matches[0].parent.name
        return "", ""
    if sys.platform == "win32":
        roots = [
            os.environ.get("ProgramFiles", r"C:\Program Files"),
            os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        ]
        found: list[Path] = []
        for root in roots:
            base = Path(root) / "SketchUp"
            if base.is_dir():
                found.extend(base.glob("SketchUp*/SketchUp.exe"))
        found.sort(reverse=True)
        if found:
            return str(found[0]), found[0].parent.name
    return "", ""


def open_model(path: Path) -> str:
    app_path, app_label = find_sketchup()
    if sys.platform == "darwin":
        if app_path:
            subprocess.Popen(["open", "-a", app_path, str(path)])
            return app_label or "SketchUp"
        subprocess.Popen(["open", str(path)])
        return "the default app"
    if sys.platform == "win32":
        if app_path:
            subprocess.Popen([app_path, str(path)])
            return app_label or "SketchUp"
        os.startfile(path)  # type: ignore[attr-defined]
        return "the default app"
    subprocess.Popen(["xdg-open", str(path)])
    return "the default app"


def stamp_path(path: Path) -> Path:
    return Path(f"{path}.kiddai")


def read_stamp(path: Path) -> str:
    stamp = stamp_path(path)
    if not stamp.is_file():
        return ""
    return stamp.read_text(encoding="ascii").strip()


def write_stamp(path: Path, version: str) -> None:
    if version:
        stamp_path(path).write_text(f"{version}\n", encoding="ascii")


def drive_version(file_id: str, access_token: str) -> str:
    request = urllib.request.Request(
        "https://www.googleapis.com/drive/v3/files/"
        f"{urllib.request.quote(file_id)}?fields=modifiedTime,size&supportsAllDrives=true",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        info = json.loads(response.read().decode("utf-8"))
    modified = str(info.get("modifiedTime", "")).strip()
    size = str(info.get("size", "")).strip()
    if not modified or not size:
        return ""
    return f"{modified}|{size}"


def download_model(file_id: str, access_token: str, destination: Path) -> None:
    url = (
        "https://www.googleapis.com/drive/v3/files/"
        f"{urllib.request.quote(file_id)}?alt=media&supportsAllDrives=true"
    )
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
    temporary = Path(f"{destination}.downloading")
    try:
        response = urllib.request.urlopen(request, timeout=180)
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise RuntimeError("Google access expired. Connect Google in Settings, then try again.") from error
        raise RuntimeError(f"Could not download the SketchUp file ({error.code}).") from error
    except urllib.error.URLError as error:
        raise RuntimeError("Could not reach Google Drive.") from error

    total = 0
    try:
        with response, temporary.open("wb") as output:
            while True:
                chunk = response.read(256 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise RuntimeError("This SketchUp file is too large to open from the helper.")
                output.write(chunk)
        if total == 0:
            raise RuntimeError("The SketchUp file from Drive was empty.")
        temporary.replace(destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def refresh_access_token(refresh_token: str, refresh_url: str) -> str:
    request = urllib.request.Request(
        refresh_url,
        data=json.dumps({"refreshToken": refresh_token}).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    token = str(payload.get("access_token", "")).strip()
    if not token:
        raise RuntimeError("Google access expired. Connect Google in Settings, then open the file again.")
    return token


def delete_drive_file(file_id: str, access_token: str) -> None:
    request = urllib.request.Request(
        "https://www.googleapis.com/drive/v3/files/"
        f"{urllib.request.quote(file_id)}?supportsAllDrives=true",
        method="DELETE",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    with urllib.request.urlopen(request, timeout=30):
        return


def upload_model(file_id: str, access_token: str, path: Path) -> str:
    size = path.stat().st_size
    start = urllib.request.Request(
        "https://www.googleapis.com/upload/drive/v3/files/"
        f"{urllib.request.quote(file_id)}?uploadType=resumable&supportsAllDrives=true&fields=id,modifiedTime,size",
        data=b"{}",
        method="PATCH",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": "application/octet-stream",
            "X-Upload-Content-Length": str(size),
        },
    )
    with urllib.request.urlopen(start, timeout=60) as response:
        session = response.headers.get("Location")
    if not session:
        raise RuntimeError("Could not start saving the SketchUp file back to Drive.")
    with path.open("rb") as handle:
        body = handle.read()
    put = urllib.request.Request(
        session,
        data=body,
        method="PUT",
        headers={
            "Content-Type": "application/octet-stream",
            "Content-Length": str(len(body)),
        },
    )
    with urllib.request.urlopen(put, timeout=300) as response:
        raw = response.read().decode("utf-8")
        if response.status not in (200, 201):
            raise RuntimeError("Could not save the SketchUp file back to Drive.")
    info = json.loads(raw) if raw.strip() else {}
    returned_id = str(info.get("id", "")).strip()
    if returned_id and returned_id != file_id:
        try:
            delete_drive_file(returned_id, access_token)
        except Exception:
            pass
        raise RuntimeError("Drive made a new file. That copy was removed. The original file was not replaced.")
    modified = str(info.get("modifiedTime", "")).strip()
    saved_size = str(info.get("size", "")).strip()
    if modified and saved_size:
        return f"{modified}|{saved_size}"
    return ""


def upload_saved_model(file_id: str, token_box: dict[str, str], path: Path) -> str:
    try:
        version = upload_model(file_id, token_box["access"], path)
    except urllib.error.HTTPError as error:
        if error.code != 401 or not token_box.get("refresh") or not token_box.get("url"):
            raise
        token_box["access"] = refresh_access_token(token_box["refresh"], token_box["url"])
        version = upload_model(file_id, token_box["access"], path)
    write_stamp(path, version)
    return version


WATCH_LOCK = threading.Lock()
WATCH_GENERATION: dict[str, int] = {}


def watch_saved_model(path: Path, file_id: str, token_box: dict[str, str], generation: int) -> None:
    time.sleep(2)
    try:
        stat = path.stat()
    except FileNotFoundError:
        return
    baseline = (stat.st_size, stat.st_mtime_ns)
    stamp = stamp_path(path)
    if stamp.is_file() and stat.st_mtime > stamp.stat().st_mtime:
        baseline = (-1, -1)
    while True:
        with WATCH_LOCK:
            if WATCH_GENERATION.get(file_id) != generation:
                return
        time.sleep(2)
        try:
            stat = path.stat()
        except FileNotFoundError:
            continue
        current = (stat.st_size, stat.st_mtime_ns)
        if current == baseline or stat.st_size == 0:
            continue
        time.sleep(1)
        try:
            quiet = path.stat()
        except FileNotFoundError:
            continue
        stable = (quiet.st_size, quiet.st_mtime_ns)
        if stable != current or quiet.st_size == 0:
            continue
        try:
            upload_saved_model(file_id, token_box, path)
            baseline = stable
            print(f"Saved {path.name} back to Drive.", flush=True)
        except Exception as error:
            print(f"Could not save {path.name} back to Drive: {error}", flush=True)


def start_save_watch(path: Path, file_id: str, access_token: str, refresh_token: str, refresh_url: str) -> None:
    with WATCH_LOCK:
        WATCH_GENERATION[file_id] = WATCH_GENERATION.get(file_id, 0) + 1
        generation = WATCH_GENERATION[file_id]
    token_box = {"access": access_token, "refresh": refresh_token, "url": refresh_url}
    threading.Thread(
        target=watch_saved_model,
        args=(path, file_id, token_box, generation),
        daemon=True,
    ).start()


class HelperHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:
        sys.stdout.write("[sketchup-helper] " + (format % args) + "\n")

    def allowed_origin(self) -> str:
        origin = self.headers.get("Origin", "").strip()
        return origin if origin in ALLOWED_ORIGINS else ""

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Private-Network", "true")
        origin = self.allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        origin = self.allowed_origin()
        self.send_response(204 if origin else 403)
        self.send_header("Access-Control-Allow-Private-Network", "true")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] != "/health":
            self.send_json(404, {"ok": False, "error": "Not found."})
            return
        self.send_json(200, {"ok": True})

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != "/open":
            self.send_json(404, {"ok": False, "error": "Not found."})
            return
        if not self.allowed_origin():
            self.send_json(403, {"ok": False, "error": "This site is not allowed to use the helper."})
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > 100000:
            self.send_json(400, {"ok": False, "error": "The open request was not valid."})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            self.send_json(400, {"ok": False, "error": "The open request was not valid."})
            return
        file_id = str(payload.get("fileId", "")).strip()
        file_name = safe_file_name(str(payload.get("fileName", "")))
        access_token = str(payload.get("accessToken", "")).strip()
        refresh_token = str(payload.get("refreshToken", "")).strip()
        refresh_url = str(payload.get("refreshUrl", "")).strip()
        origin = self.allowed_origin()
        if not origin or not refresh_url.startswith(f"{origin}/"):
            refresh_token = ""
            refresh_url = ""
        if not FILE_ID_PATTERN.match(file_id) or not access_token:
            self.send_json(400, {"ok": False, "error": "The SketchUp file id was not valid."})
            return
        destination = save_dir() / file_name
        try:
            version = ""
            try:
                version = drive_version(file_id, access_token)
            except Exception:
                version = ""
            same_version = destination.is_file() and bool(version) and read_stamp(destination) == version
            if not same_version:
                download_model(file_id, access_token, destination)
                write_stamp(destination, version)
            opened_with = open_model(destination)
            start_save_watch(destination, file_id, access_token, refresh_token, refresh_url)
        except Exception as error:
            self.send_json(500, {"ok": False, "error": str(error) or "Could not open SketchUp."})
            return
        self.send_json(200, {"ok": True, "fileName": file_name, "openedWith": opened_with})


def main() -> None:
    try:
        server = ThreadingHTTPServer((HOST, PORT), HelperHandler)
    except OSError:
        print(f"The SketchUp helper is already running on {HOST}:{PORT}.", flush=True)
        print("Leave that window open and use SketchUp on the website.", flush=True)
        return
    print(f"Kiddai SketchUp helper is ready at http://{HOST}:{PORT}", flush=True)
    print("Leave this window open. The website can now open .skp files in SketchUp.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nHelper stopped.")


if __name__ == "__main__":
    main()
HELPER
PLIST="$HOME/Library/LaunchAgents/com.kiddai.sketchup-helper.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.kiddai.sketchup-helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$APP_DIR/sketchup_helper.py</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$APP_DIR/helper.log</string>
  <key>StandardErrorPath</key>
  <string>$APP_DIR/helper.log</string>
</dict>
</plist>
EOF
UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/com.kiddai.sketchup-helper" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl enable "gui/$UID_NUM/com.kiddai.sketchup-helper" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$UID_NUM/com.kiddai.sketchup-helper"
osascript -e 'display dialog "The SketchUp helper is installed and running. It stays on this computer and starts when the computer starts." buttons {"OK"} default button "OK"'
