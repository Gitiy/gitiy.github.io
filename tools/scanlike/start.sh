#!/usr/bin/env bash
# ScanLike 本地启动脚本（macOS / Linux / Git Bash）
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8765}"

if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "[!] 未找到 Python。可用任意静态服务器打开本目录，例如： npx --yes serve -l $PORT ."
  exit 1
fi

echo ""
echo "  ScanLike 已启动： http://127.0.0.1:$PORT/"
echo "  按 Ctrl+C 停止。"
echo ""

( sleep 1; command -v xdg-open >/dev/null 2>&1 && xdg-open "http://127.0.0.1:$PORT/" || command -v open >/dev/null 2>&1 && open "http://127.0.0.1:$PORT/" ) >/dev/null 2>&1 &

exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
