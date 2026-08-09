"""Cabeceras de seguridad de las respuestas de la API.

Aquí van solo las que dependen de lo que sirve la aplicación, no del
despliegue. HSTS no está: solo tiene sentido detrás de TLS, en desarrollo esto
corre en claro, y una cabecera que ordena al navegador no volver a hablar en
claro con este host es difícil de retirar una vez emitida. Vive en el proxy
(ver `deploy/Caddyfile`), que es quien sabe si hay TLS.

La CSP del frontend tampoco está aquí: la escribe quien sirve el HTML. Esta es
la de las respuestas de la API, que son JSON y no deberían cargar nada de
nadie — si un día un fallo hace que un `detail` con HTML se interprete como
página, esta política lo deja sin script, sin marco y sin destino al que
enviar nada.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

API_SECURITY_HEADERS = {
    # Sin esto el navegador puede decidir por su cuenta que un JSON es HTML y
    # ejecutarlo; es la base de los XSS por confusión de tipo.
    "X-Content-Type-Options": "nosniff",
    # El simulador no se empotra en ningún sitio. `frame-ancestors` es la
    # forma moderna de `X-Frame-Options` y cubre más casos.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    # Que la URL de la API no viaje como referente a terceros. Hoy no hay nada
    # sensible en ella —y no debe haberlo, por eso los ids van en la ruta y no
    # en la query— pero el referente se filtra solo si no se dice nada.
    "Referrer-Policy": "no-referrer",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Añade las cabeceras a toda respuesta HTTP.

    No afecta al WebSocket: su handshake no pasa por aquí, y una vez abierto
    no hay cabeceras que poner. Lo que protege al WS es la comprobación de
    origen del propio handler.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        for name, value in API_SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        return response
