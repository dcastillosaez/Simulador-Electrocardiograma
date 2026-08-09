"""Punto de entrada del backend empaquetado.

Lo que en desarrollo hace `uvicorn ecg_api.main:app --port 8000`, aquí lo hace
el propio ejecutable, porque dentro de un `.exe` no hay línea de comandos de
uvicorn a la que llamar.

Añade lo que un servidor no necesita y un escritorio sí:

- **Migrar antes de servir.** En un servidor las migraciones las lanza quien
  despliega; aquí no hay nadie, y la base de datos del usuario puede venir de
  una versión anterior de la aplicación.
- **Fallar sin romper.** Si la migración no sale, se arranca igualmente: el
  catálogo sale del motor y se puede simular sin historial. Es el modo
  degradado de la fase G3, y es lo que separa «no se guardarán las sesiones» de
  «el simulador no abre».
- **Anunciar el puerto.** El shell necesita saber en cuál se escucha, y lo
  elige el sistema operativo. Se imprime en la salida estándar en cuanto está,
  antes de que el servidor empiece a atender.

Argumentos (todos opcionales, todos con equivalente en variable de entorno):

    --port 0        0 = que el sistema elija uno libre
    --host 127.0.0.1
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import sys


def _puerto_libre(host: str) -> int:
    """Un puerto que el sistema declara libre ahora mismo.

    Se abre, se lee cuál tocó y se cierra. Entre eso y que uvicorn lo ocupe hay
    una ventana en la que otro proceso podría cogerlo; es improbable en un
    escritorio y la alternativa —pasarle a uvicorn el socket ya abierto— ata
    este código a detalles de su implementación.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


def main() -> int:
    parser = argparse.ArgumentParser(prog="ecg-api")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    log = logging.getLogger("ecg_api.entrypoint")

    from ecg_api.config import get_settings
    from ecg_api.db.migrator import upgrade_to_head

    settings = get_settings()

    try:
        upgrade_to_head(settings.database_url)
    except Exception:  # noqa: BLE001
        log.error(
            "no se pudo preparar la base de datos: se arranca sin historial",
            exc_info=True,
        )

    puerto = args.port or _puerto_libre(args.host)

    # El contrato con el shell: una línea de JSON en cuanto se sabe el puerto.
    # Una línea y no un fichero porque el shell ya está leyendo esta salida
    # para el log, y un fichero añadiría una carrera más al arranque.
    print(json.dumps({"event": "listening", "host": args.host, "port": puerto}))
    sys.stdout.flush()

    import uvicorn

    # El objeto, no la cadena "ecg_api.main:app". Uvicorn importa las cadenas
    # con el mecanismo normal de import, y dentro del ejecutable ese mecanismo
    # no encuentra el modulo: falla con "Could not import module" despues de
    # haber anunciado el puerto, que es la peor forma de fallar --el shell ya
    # cree que hay backend--.
    from ecg_api.main import app

    uvicorn.run(
        app,
        host=args.host,
        port=puerto,
        log_config=None,
        # Un solo worker, como el resto del proyecto: el estado de simulación
        # vive en memoria del proceso que sostiene cada WebSocket.
        workers=1,
    )
    return 0


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    raise SystemExit(main())
