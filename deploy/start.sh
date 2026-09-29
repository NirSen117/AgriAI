#!/bin/sh
set -eu

mkdir -p /app/data
uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 &
backend_pid=$!

cleanup() {
  kill "$backend_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

nginx -g "daemon off;"
