#!/usr/bin/env bash
# Rotor Interface GS232B - Server Starter
# Startet den Python-Server fuer die Rotor-Interface-Anwendung

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1

echo "========================================"
echo "Rotor Interface GS232B - Server"
echo "========================================"
echo

if command -v python3 >/dev/null 2>&1; then
    PYTHON=python3
elif command -v python >/dev/null 2>&1; then
    PYTHON=python
else
    echo "FEHLER: Python ist nicht installiert oder nicht im PATH!"
    echo "Bitte installieren Sie Python 3.10 oder hoeher."
    echo
    read -r -p "Druecke Enter zum Beenden..."
    exit 1
fi

if ! "$PYTHON" --version >/dev/null 2>&1; then
    echo "FEHLER: Python ist nicht ausfuehrbar."
    echo
    read -r -p "Druecke Enter zum Beenden..."
    exit 1
fi

if [ ! -d "server" ]; then
    echo "FEHLER: server/ Verzeichnis wurde nicht gefunden!"
    echo "Bitte pruefen Sie, ob die Projektstruktur vollstaendig ist."
    echo
    read -r -p "Druecke Enter zum Beenden..."
    exit 1
fi

load_ports() {
    local ports
    ports="$("$PYTHON" - <<'PY'
import json
from pathlib import Path

default_http = 8081
default_ws = 8082
config_path = Path("data/web-settings.json")

if not config_path.exists():
    print(f"{default_http}\n{default_ws}")
    raise SystemExit(0)

try:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    http_port = int(config.get("serverHttpPort", default_http))
    ws_port = int(config.get("serverWebSocketPort", default_ws))
    print(f"{http_port}\n{ws_port}")
except Exception:
    print(f"{default_http}\n{default_ws}")
PY
)"
    HTTP_PORT="$(echo "$ports" | sed -n '1p')"
    WS_PORT="$(echo "$ports" | sed -n '2p')"
}

stop_old_server_processes() {
    local pids pid
    pids="$(pgrep -f '[Pp]ython.*-m server\.main' 2>/dev/null || true)"
    if [ -z "$pids" ]; then
        return 0
    fi

    while read -r pid; do
        [ -z "$pid" ] && continue
        echo "Beende alten Server-Prozess (PID ${pid})..."
        kill "$pid" 2>/dev/null || true
    done <<< "$pids"

    sleep 1

    pids="$(pgrep -f '[Pp]ython.*-m server\.main' 2>/dev/null || true)"
    while read -r pid; do
        [ -z "$pid" ] && continue
        kill -9 "$pid" 2>/dev/null || true
    done <<< "$pids"
}

HTTP_PORT=8081
WS_PORT=8082

while true; do
    HTTP_PORT=8081
    WS_PORT=8082

    stop_old_server_processes

    if [ -f "data/web-settings.json" ]; then
        echo "Lade Ports aus data/web-settings.json..."
        load_ports
    fi

    echo
    echo "Server wird initialisiert..."
    echo "  HTTP-Port: ${HTTP_PORT}"
    echo "  WebSocket-Port: ${WS_PORT}"
    echo
    echo "API-Dokumentation:"
    echo "  GET /api/openapi.json - OpenAPI 3.1 Spezifikation"
    echo "    http://localhost:${HTTP_PORT}/api/openapi.json"
    echo "  GET /api/docs - Swagger UI (interaktiv, inkl. \"Try it out\")"
    echo "    http://localhost:${HTTP_PORT}/api/docs"
    echo "  GET /api/redoc - ReDoc-Ansicht"
    echo "    http://localhost:${HTTP_PORT}/api/redoc"
    echo "========================================"
    echo

    set +e
    "$PYTHON" -m server.main --port "$HTTP_PORT" --websocket-port "$WS_PORT"
    EXIT_CODE=$?
    set -e

    if [ "$EXIT_CODE" -eq 42 ]; then
        echo
        echo "========================================"
        echo "Server wird neu gestartet..."
        echo "========================================"
        sleep 2
        echo
        continue
    fi

    if [ "$EXIT_CODE" -eq 0 ]; then
        echo
        echo "Server wurde normal beendet."
    else
        echo
        echo "Server wurde mit Fehler beendet (Code: ${EXIT_CODE})"
    fi

    echo
    read -r -p "Druecke Enter zum Beenden..."
    exit "$EXIT_CODE"
done
