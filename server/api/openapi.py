"""OpenAPI/Swagger helpers for the Rotor Interface API."""

from __future__ import annotations

from typing import Any, Dict


def _security(require_session: bool) -> list[dict[str, list]]:
    """Return OpenAPI security requirements based on runtime session mode."""
    if require_session:
        return [{"XSessionID": []}]
    # optional session
    return [{"XSessionID": []}, {}]


def _server_url(handler: Any, state: Any) -> str:
    host = handler.headers.get("Host")
    scheme = handler.headers.get("X-Forwarded-Proto", "http")
    if host:
        return f"{scheme}://{host}"
    return f"http://localhost:{state.http_port}"


def _operation_doc(tag: str, summary: str, security: list[dict[str, list]]) -> dict[str, Any]:
    return {
        "tags": [tag],
        "summary": summary,
        "security": security,
        "responses": {"200": {"description": "OK"}},
    }


def build_openapi_spec(handler: Any, state: Any) -> Dict[str, Any]:
    """Build OpenAPI specification for the current server state."""
    require_session = bool(state.settings.get("serverRequireSession", False)) if state and state.settings else False
    op_security = _security(require_session)

    paths: Dict[str, Any] = {
        "/api/session": {
            "get": {
                "tags": ["Session"],
                "summary": "Get or create session",
                "responses": {
                    "200": {
                        "description": "Session information",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SessionResponse"}}},
                    }
                },
            }
        },
        "/api/settings": {
            "get": {
                "tags": ["Settings"],
                "summary": "Get all settings",
                "security": op_security,
                "responses": {
                    "200": {
                        "description": "Current settings",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Settings"}}},
                    }
                },
            },
            "post": {
                "tags": ["Settings"],
                "summary": "Update settings",
                "security": op_security,
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SettingsUpdateRequest"}}},
                },
                "responses": {
                    "200": {
                        "description": "Updated settings",
                        "content": {
                            "application/json": {"schema": {"$ref": "#/components/schemas/SettingsUpdateResponse"}}
                        },
                    }
                },
            },
        },
        "/api/config/ini": {
            "get": {
                "tags": ["Settings"],
                "summary": "Get rotor-config.ini content",
                "security": op_security,
                "responses": {"200": {"description": "INI content"}},
            }
        },
        "/api/rotor/connect": {
            "post": {
                "tags": ["Rotor"],
                "summary": "Connect serial port",
                "security": op_security,
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ConnectRequest"}}},
                },
                "responses": {"200": {"description": "Connected"}},
            }
        },
        "/api/rotor/disconnect": {
            "post": {
                "tags": ["Rotor"],
                "summary": "Disconnect serial port",
                "security": op_security,
                "responses": {"200": {"description": "Disconnected"}},
            }
        },
        "/api/rotor/manual": {
            "post": {
                "tags": ["Rotor"],
                "summary": "Start manual movement",
                "security": op_security,
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ManualMoveRequest"}}},
                },
                "responses": {"200": {"description": "Movement started"}},
            }
        },
        "/api/rotor/stop": {
            "post": {
                "tags": ["Rotor"],
                "summary": "Stop all motion",
                "security": op_security,
                "responses": {"200": {"description": "Stopped"}},
            }
        },
        "/api/rotor/command": {
            "post": {
                "tags": ["Rotor"],
                "summary": "Send direct GS-232B command",
                "security": op_security,
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CommandRequest"}}},
                },
                "responses": {"200": {"description": "Command accepted"}},
            }
        },
        "/api/rotor/set_target": {
            "post": {
                "tags": ["Rotor"],
                "summary": "Set calibrated target position",
                "security": op_security,
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SetTargetRequest"}}},
                },
                "responses": {"200": {"description": "Target accepted"}},
            }
        },
        "/api/rotor/set_target_raw": {
            "post": {
                "tags": ["Rotor"],
                "summary": "Set raw target position",
                "security": op_security,
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SetTargetRawRequest"}}},
                },
                "responses": {"200": {"description": "Target accepted"}},
            }
        },
        "/api/rotor/home": {
            "post": {
                "tags": ["Rotor"],
                "summary": "Move to home preset",
                "security": op_security,
                "responses": {"200": {"description": "Home movement started"}},
            }
        },
        "/api/rotor/park": {
            "post": {
                "tags": ["Rotor"],
                "summary": "Move to park preset",
                "security": op_security,
                "responses": {"200": {"description": "Park movement started"}},
            }
        },
        "/api/server/settings": {
            "get": {
                "tags": ["Server"],
                "summary": "Get server settings",
                "security": op_security,
                "responses": {
                    "200": {
                        "description": "Server settings",
                        "content": {
                            "application/json": {"schema": {"$ref": "#/components/schemas/ServerSettingsResponse"}}
                        },
                    }
                },
            },
            "post": {
                "tags": ["Server"],
                "summary": "Update server settings",
                "security": op_security,
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {"schema": {"$ref": "#/components/schemas/ServerSettingsUpdateRequest"}}
                    },
                },
                "responses": {"200": {"description": "Settings updated"}},
            },
        },
        "/api/server/restart": {
            "post": {
                "tags": ["Server"],
                "summary": "Restart server",
                "security": op_security,
                "responses": {"200": {"description": "Restart requested"}},
            }
        },
        "/api/docs": {
            "get": {
                "tags": ["Docs"],
                "summary": "Swagger UI",
                "responses": {"200": {"description": "HTML API documentation"}},
            }
        },
        "/api/openapi.json": {
            "get": {
                "tags": ["Docs"],
                "summary": "OpenAPI JSON",
                "responses": {"200": {"description": "OpenAPI specification"}},
            }
        },
        "/api/redoc": {
            "get": {
                "tags": ["Docs"],
                "summary": "ReDoc UI",
                "responses": {"200": {"description": "Alternative HTML API documentation"}},
            }
        },
    }

    for path, tag, summary, method in [
        ("/api/rotor/ports", "Rotor", "List serial ports", "get"),
        ("/api/rotor/status", "Rotor", "Get rotor status", "get"),
        ("/api/rotor/position", "Rotor", "Get extended rotor position", "get"),
        ("/api/clients", "Clients", "Get connected clients", "get"),
        ("/api/routes", "Routes", "Get routes", "get"),
        ("/api/routes/execution", "Routes", "Get route execution state", "get"),
        ("/api/routes", "Routes", "Create route", "post"),
        ("/api/routes/stop", "Routes", "Stop route execution", "post"),
        ("/api/routes/continue", "Routes", "Continue manual wait step", "post"),
    ]:
        if path not in paths:
            paths[path] = {}
        paths[path][method] = _operation_doc(tag, summary, op_security)

    paths["/api/clients/{id}/suspend"] = {
        "post": {
            "tags": ["Clients"],
            "summary": "Suspend client session",
            "security": op_security,
            "parameters": [{"name": "id", "in": "path", "required": True, "schema": {"type": "string"}}],
            "responses": {"200": {"description": "Client suspended"}},
        }
    }
    paths["/api/clients/{id}/resume"] = {
        "post": {
            "tags": ["Clients"],
            "summary": "Resume client session",
            "security": op_security,
            "parameters": [{"name": "id", "in": "path", "required": True, "schema": {"type": "string"}}],
            "responses": {"200": {"description": "Client resumed"}},
        }
    }
    paths["/api/routes/{id}"] = {
        "put": {
            "tags": ["Routes"],
            "summary": "Update route",
            "security": op_security,
            "parameters": [{"name": "id", "in": "path", "required": True, "schema": {"type": "string"}}],
            "responses": {"200": {"description": "Route updated"}},
        },
        "delete": {
            "tags": ["Routes"],
            "summary": "Delete route",
            "security": op_security,
            "parameters": [{"name": "id", "in": "path", "required": True, "schema": {"type": "string"}}],
            "responses": {"200": {"description": "Route deleted"}},
        },
    }
    paths["/api/routes/{id}/start"] = {
        "post": {
            "tags": ["Routes"],
            "summary": "Start route execution",
            "security": op_security,
            "parameters": [{"name": "id", "in": "path", "required": True, "schema": {"type": "string"}}],
            "responses": {"200": {"description": "Route started"}},
        }
    }

    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Rotor Interface GS232B API",
            "version": "2.0.0",
            "description": (
                "REST API for rotor control, route execution, session management, and settings. "
                "WebSocket events are available on the configured server WebSocket port."
            ),
        },
        "servers": [{"url": _server_url(handler, state), "description": "Current server"}],
        "tags": [
            {"name": "Session"},
            {"name": "Rotor"},
            {"name": "Settings"},
            {"name": "Server"},
            {"name": "Clients"},
            {"name": "Routes"},
            {"name": "Docs"},
        ],
        "paths": paths,
        "components": {
            "securitySchemes": {
                "XSessionID": {
                    "type": "apiKey",
                    "in": "header",
                    "name": "X-Session-ID",
                    "description": "Session ID from GET /api/session. Required when `serverRequireSession=true`.",
                }
            },
            "schemas": {
                "SessionResponse": {
                    "type": "object",
                    "properties": {"sessionId": {"type": "string"}, "status": {"type": "string"}},
                    "required": ["sessionId", "status"],
                },
                "ErrorResponse": {
                    "type": "object",
                    "properties": {"error": {"type": "string"}, "message": {"type": "string"}},
                    "required": ["error"],
                },
                "Settings": {
                    "type": "object",
                    "description": "Persisted settings from web-settings.json.",
                    "additionalProperties": True,
                },
                "SettingsUpdateRequest": {"type": "object", "additionalProperties": True},
                "SettingsUpdateResponse": {
                    "type": "object",
                    "properties": {
                        "status": {"type": "string"},
                        "settings": {"$ref": "#/components/schemas/Settings"},
                    },
                    "required": ["status", "settings"],
                },
                "ConnectRequest": {
                    "type": "object",
                    "properties": {
                        "port": {"type": "string"},
                        "baudRate": {"type": "integer", "default": 9600},
                    },
                    "required": ["port"],
                },
                "ManualMoveRequest": {
                    "type": "object",
                    "properties": {
                        "direction": {
                            "type": "string",
                            "enum": ["left", "right", "up", "down", "L", "R", "U", "D"],
                        }
                    },
                    "required": ["direction"],
                },
                "CommandRequest": {
                    "type": "object",
                    "properties": {"command": {"type": "string"}},
                    "required": ["command"],
                },
                "SetTargetRequest": {
                    "type": "object",
                    "properties": {"az": {"type": "number"}, "el": {"type": "number"}},
                    "required": ["az", "el"],
                },
                "SetTargetRawRequest": {
                    "type": "object",
                    "properties": {"az": {"type": "number"}, "el": {"type": "number"}},
                    "description": "At least one of az or el must be provided.",
                },
                "ServerSettingsResponse": {
                    "type": "object",
                    "properties": {
                        "httpPort": {"type": "integer"},
                        "webSocketPort": {"type": "integer"},
                        "pollingIntervalMs": {"type": "integer"},
                        "sessionTimeoutS": {"type": "integer"},
                        "maxClients": {"type": "integer"},
                        "loggingLevel": {"type": "string"},
                        "requireSession": {"type": "boolean"},
                    },
                },
                "ServerSettingsUpdateRequest": {
                    "type": "object",
                    "properties": {
                        "serverHttpPort": {"type": "integer"},
                        "serverWebSocketPort": {"type": "integer"},
                        "serverPollingIntervalMs": {"type": "integer"},
                        "serverSessionTimeoutS": {"type": "integer"},
                        "serverMaxClients": {"type": "integer"},
                        "serverLoggingLevel": {"type": "string"},
                        "serverRequireSession": {"type": "boolean"},
                    },
                    "additionalProperties": False,
                },
            },
        },
    }


def build_swagger_ui_html(
    spec_url: str = "/api/openapi.json",
    assets_base: str = "/api/docs/assets",
) -> str:
    escaped_spec = spec_url.replace('"', "&quot;")
    escaped_css = f"{assets_base}/swagger-ui.css".replace('"', "&quot;")
    escaped_js = f"{assets_base}/swagger-ui-bundle.js".replace('"', "&quot;")
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Rotor Interface API Docs</title>
    <link rel="stylesheet" href="{escaped_css}" />
    <style>body {{ margin: 0; }} .topbar {{ display: none; }}</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="{escaped_js}"></script>
    <script>
      window.ui = SwaggerUIBundle({{
        url: "{escaped_spec}",
        dom_id: "#swagger-ui",
        deepLinking: true,
        tryItOutEnabled: true,
        displayRequestDuration: true
      }});
    </script>
  </body>
</html>
"""


def build_redoc_html(spec_url: str = "/api/openapi.json") -> str:
    escaped_spec = spec_url.replace('"', "&quot;")
    escaped_js = "/api/docs/assets/redoc.standalone.js".replace('"', "&quot;")
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Rotor Interface API ReDoc</title>
  </head>
  <body>
    <redoc spec-url="{escaped_spec}"></redoc>
    <script src="{escaped_js}"></script>
  </body>
</html>
"""
