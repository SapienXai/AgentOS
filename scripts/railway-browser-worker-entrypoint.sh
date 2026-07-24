#!/bin/sh
set -eu

umask 077

if [ "${RAILWAY_ENVIRONMENT_ID:-}" != "" ] && [ "${RAILWAY_VOLUME_MOUNT_PATH:-}" != "/data" ]; then
  echo "Secure browser worker requires a dedicated Railway volume mounted at /data." >&2
  exit 1
fi

if [ "${AGENTOS_BROWSER_WORKER_TOKEN:-}" = "" ]; then
  echo "AGENTOS_BROWSER_WORKER_TOKEN is required." >&2
  exit 1
fi

if [ "${PORT:-}" = "" ]; then
  echo "PORT is required and must match the private worker URL port." >&2
  exit 1
fi

mkdir -p /data/browser-profiles
chown node:node /data /data/browser-profiles
chmod 0700 /data/browser-profiles

worker_script="/agentos/scripts/secure-browser-worker.mjs"

if [ ! -f "$worker_script" ] && [ -f /browser-worker/scripts/secure-browser-worker.mjs ]; then
  worker_script="/browser-worker/scripts/secure-browser-worker.mjs"
fi

if [ ! -f "$worker_script" ]; then
  echo "secure-browser-worker.mjs is missing from the Railway image." >&2
  exit 1
fi

exec gosu node:node node "$worker_script"
