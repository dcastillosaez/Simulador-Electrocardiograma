"""Genera el icono base de la aplicación, sin dependencias.

Un PNG cuadrado con el fondo del monitor y un latido en verde fósforo, los dos
colores que ya usa el tema oscuro (`packages/ui-system/tokens/tokens.py`). Se
escribe con `zlib` y `struct` a propósito: añadir Pillow al proyecto para dibujar
una onda cada varios meses no sale a cuenta.

    python apps/desktop/tools/generar_icono.py
    npx tauri icon apps/desktop/tools/icono-base.png

El segundo comando es el que produce el `.ico` y los tamaños que pide cada
plataforma.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

LADO = 512
FONDO = (0x11, 0x13, 0x15)
TRAZO = (0x37, 0xFF, 0x90)
GROSOR = 14

# Un latido, en coordenadas relativas al lienzo: línea de base, P, QRS y T.
# Los valores son proporciones, así que el dibujo escala con `LADO`.
LATIDO = [
    (0.00, 0.50), (0.18, 0.50),
    (0.24, 0.42), (0.30, 0.50),          # P
    (0.36, 0.50), (0.40, 0.62),          # Q
    (0.46, 0.16), (0.52, 0.66),          # R y S
    (0.56, 0.50), (0.68, 0.50),
    (0.76, 0.36), (0.84, 0.50),          # T
    (1.00, 0.50),
]


def _lienzo() -> list[list[tuple[int, int, int]]]:
    return [[FONDO] * LADO for _ in range(LADO)]


def _punto(pixeles, x: int, y: int) -> None:
    radio = GROSOR // 2
    for dy in range(-radio, radio + 1):
        for dx in range(-radio, radio + 1):
            if dx * dx + dy * dy > radio * radio:
                continue  # redondo, no cuadrado: el trazo no tiene esquinas
            px, py = x + dx, y + dy
            if 0 <= px < LADO and 0 <= py < LADO:
                pixeles[py][px] = TRAZO


def _segmento(pixeles, x0: int, y0: int, x1: int, y1: int) -> None:
    pasos = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(pasos + 1):
        t = i / pasos
        _punto(pixeles, round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t))


def _png(pixeles) -> bytes:
    crudo = b"".join(
        b"\x00" + b"".join(struct.pack("3B", *p) for p in fila) for fila in pixeles
    )

    def trozo(tipo: bytes, datos: bytes) -> bytes:
        cuerpo = tipo + datos
        return struct.pack(">I", len(datos)) + cuerpo + struct.pack(
            ">I", zlib.crc32(cuerpo) & 0xFFFFFFFF
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + trozo(b"IHDR", struct.pack(">IIBBBBB", LADO, LADO, 8, 2, 0, 0, 0))
        + trozo(b"IDAT", zlib.compress(crudo, 9))
        + trozo(b"IEND", b"")
    )


def main() -> None:
    pixeles = _lienzo()
    puntos = [(round(x * (LADO - 1)), round(y * (LADO - 1))) for x, y in LATIDO]
    for (x0, y0), (x1, y1) in zip(puntos, puntos[1:]):
        _segmento(pixeles, x0, y0, x1, y1)

    destino = Path(__file__).with_name("icono-base.png")
    destino.write_bytes(_png(pixeles))
    print(f"escrito {destino} ({destino.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
