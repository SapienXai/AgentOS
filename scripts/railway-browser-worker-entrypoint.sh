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

exec gosu node:node node /browser-worker/scripts/secure-browser-worker.mjs
