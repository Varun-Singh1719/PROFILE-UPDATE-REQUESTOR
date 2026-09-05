#!/usr/bin/env bash
# Restore /app/backend/.env and /app/frontend/.env from the persisted copies in
# /app/memory/env/ (the real .env files are git-ignored, so they disappear in
# every fresh container). Run at the start of a session:
#     bash /app/scripts/restore_env.sh && sudo supervisorctl restart all
#
# The frontend REACT_APP_BACKEND_URL is container-specific: if the platform
# exposes $preview_endpoint we use it, otherwise the saved value is kept.
set -euo pipefail
ROOT=/app
SRC=$ROOT/memory/env

if [ ! -f "$ROOT/backend/.env" ]; then
  cp "$SRC/backend.env.txt" "$ROOT/backend/.env"
  echo "restored backend/.env"
else
  echo "backend/.env already present — left untouched"
fi

if [ ! -f "$ROOT/frontend/.env" ]; then
  cp "$SRC/frontend.env.txt" "$ROOT/frontend/.env"
  if [ -n "${preview_endpoint:-}" ]; then
    sed -i "s#^REACT_APP_BACKEND_URL=.*#REACT_APP_BACKEND_URL=${preview_endpoint}#" "$ROOT/frontend/.env"
  fi
  echo "restored frontend/.env ($(grep REACT_APP_BACKEND_URL "$ROOT/frontend/.env"))"
else
  echo "frontend/.env already present — left untouched"
fi
