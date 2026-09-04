#!/usr/bin/env bash
# Aplica límite de subida en Nginx (Lightsail / api.sistema.biznaga.com.mx).
set -euo pipefail

CONF_NAME="00-biznaga-upload-limits.conf"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SCRIPT_DIR}/../nginx/conf.d/${CONF_NAME}"

if [[ ! -f "$SRC" ]]; then
  echo "No se encontró: $SRC" >&2
  exit 1
fi

sudo cp "$SRC" "/etc/nginx/conf.d/${CONF_NAME}"
sudo nginx -t
sudo systemctl reload nginx

echo "OK: Nginx recargado con client_max_body_size 50M"
sudo grep -R "client_max_body_size" /etc/nginx/ 2>/dev/null || true
