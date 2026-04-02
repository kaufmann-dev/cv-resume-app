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

RED=$'\033[1;31m'
YELLOW=$'\033[1;33m'
RESET=$'\033[0m'

echo "Deploying from ${APP_DIR}"
echo "${RED}WARNING:${RESET} ${YELLOW}This deploy will discard all local commits, tracked changes, and untracked files in this repository.${RESET}"

if [[ "${CONFIRM_DEPLOY:-}" != "y" ]]; then
  read -r -p "$(printf "${YELLOW}Type y to continue:${RESET} ")" confirmation

  if [[ "${confirmation}" != "y" ]]; then
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
${SUDO} chown www-data:www-data cv.json resume.json passcodes.json
${SUDO} chmod 664 cv.json resume.json passcodes.json
${SUDO} systemctl restart "${SERVICE_NAME}"
${SUDO} systemctl status "${SERVICE_NAME}" --no-pager --lines=20