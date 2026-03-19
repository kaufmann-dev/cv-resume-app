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
echo "WARNING: This deploy will discard all local commits, tracked changes, and untracked files in this repository."

if [[ "${CONFIRM_DEPLOY:-}" != "YES" ]]; then
  read -r -p "Type YES to continue: " confirmation

  if [[ "${confirmation}" != "YES" ]]; then
    echo "Deployment cancelled."
    exit 1
  fi
fi

UPSTREAM_REF="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}')"

git fetch --prune
git reset --hard "${UPSTREAM_REF}"
git clean -fd
git pull --ff-only
npm ci
npm run build
${SUDO} systemctl restart "${SERVICE_NAME}"
${SUDO} systemctl status "${SERVICE_NAME}" --no-pager --lines=20
