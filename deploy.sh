#!/usr/bin/env bash

set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="${SERVICE_NAME:-cv-resume-app}"

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

cd "${APP_DIR}"

echo "Deploying from ${APP_DIR}"

git pull --ff-only
npm ci
npm run build
${SUDO} systemctl restart "${SERVICE_NAME}"
${SUDO} systemctl status "${SERVICE_NAME}" --no-pager --lines=20
