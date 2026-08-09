"""El token de arranque del modo escritorio.

En escritorio el backend escucha en `127.0.0.1`, y esa dirección la alcanza
cualquier proceso del mismo equipo: otro programa, un script, una pestaña del
navegador que el usuario tenga abierta. El token es lo que distingue a la
ventana del simulador —que lo recibió del shell que lo generó— de todo lo
demás.

No es autenticación de usuario y no pretende serlo. Es la misma idea que la
«clave de aula» del análisis de seguridad, con la ventaja de que aquí nadie
tiene que teclearla: la genera el shell en cada arranque y muere con él.

Dónde viaja:

- **REST**: cabecera `X-ECG-Token`.
- **WebSocket**: subprotocolo del handshake. Es la única vía limpia, porque el
  navegador no deja poner cabeceras en `new WebSocket(url)` y un token en la
  query string acabaría en los logs del servidor y en el historial.
"""

from __future__ import annotations

import hmac
import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("ecg_api.desktop_auth")

TOKEN_HEADER = "x-ecg-token"

# Rutas que siguen abiertas con el token puesto. `/api/health` es la que el
# propio shell consulta para saber si el backend ya responde, y en ese momento
# todavía no ha podido entregarle el token a nadie.
PUBLIC_PATHS = frozenset({"/api/health"})


def token_matches(expected: str, presented: str | None) -> bool:
    """Comparación en tiempo constante.

    Con `==`, el tiempo de respuesta depende de cuántos caracteres coinciden, y
    eso permite adivinar el token carácter a carácter. Es un ataque poco
    práctico contra un secreto que dura lo que dura una sesión, pero
    `compare_digest` no cuesta nada y evita tener que razonarlo.
    """
    if not expected:
        return True  # sin token configurado, no hay puerta que guardar
    if not presented:
        return False
    return hmac.compare_digest(expected, presented)


class DesktopTokenMiddleware(BaseHTTPMiddleware):
    """Exige el token en las rutas REST cuando el modo escritorio está activo."""

    async def dispatch(self, request: Request, call_next):
        settings = getattr(request.app.state, "settings", None)
        expected = getattr(settings, "desktop_token", "") if settings else ""

        if expected and request.url.path not in PUBLIC_PATHS:
            if not token_matches(expected, request.headers.get(TOKEN_HEADER)):
                logger.warning(
                    "petición sin token válido: %s %s",
                    request.method,
                    request.url.path,
                )
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Falta el token de la aplicación."},
                )

        return await call_next(request)
