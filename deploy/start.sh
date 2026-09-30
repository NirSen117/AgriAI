#!/bin/sh
set -eu

mkdir -p /app/data
uvicorn backend.app.main:app --app-dir /app --host 127.0.0.1 --port 8000 &
backend_pid=$!

attempt=0
until python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=1)" >/dev/null 2>&1; do
  if ! kill -0 "$backend_pid" 2>/dev/null; then
    wait "$backend_pid"
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Backend did not become healthy within 30 seconds" >&2
    exit 1
  fi
  sleep 1
done

cleanup() {
  kill "$backend_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

nginx -g "daemon off;"
