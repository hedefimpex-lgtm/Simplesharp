#!/bin/sh
# macOS / Linux: çift tıklayarak başlatın.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js bulunamadı. Lütfen https://nodejs.org adresinden LTS sürümünü kurun."
  open https://nodejs.org 2>/dev/null || xdg-open https://nodejs.org 2>/dev/null
  read -r _
  exit 1
fi
[ -d node_modules ] || npm install || { echo "Paketler indirilemedi."; read -r _; exit 1; }
npm run dev -- --open
