"""Aforo del servidor de simulación.

El estado de cada simulación vive en memoria del proceso que sostiene su
WebSocket, y ese proceso es **uno solo** por diseño (ver `main.py`). No hay
otro worker que absorba la carga: cada conexión abre cuatro tareas de fondo y
genera doce canales a 500 Hz, así que un puñado de sockets abiertos desde un
script deja sin servicio a una clase entera.

Por eso el aforo no es una medida opcional de endurecimiento sino de
supervivencia, y por eso vive aquí y no en el proxy: el proxy sabe de
peticiones HTTP por segundo, no de cuántas simulaciones está sosteniendo este
proceso ahora mismo.

Nada de esto es asíncrono a propósito. Las operaciones son un incremento y una
comparación sobre estructuras en memoria, y el bucle de eventos es único: un
lock añadiría contención y una superficie de error (un `await` mal puesto entre
la comprobación y la reserva es precisamente cómo se cuela una conexión de más)
a cambio de nada.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ConnectionLimiter:
    """Cuántas conexiones se aceptan, en total y por cliente.

    El límite por cliente existe además del global porque el reparto importa:
    con solo un tope global, un cliente con un bucle se lleva las cincuenta
    plazas y el aula se queda fuera sin que el servidor haya llegado a
    considerarse lleno.
    """

    max_total: int
    max_per_client: int
    _per_client: dict[str, int] = field(default_factory=dict)
    _total: int = 0

    @property
    def total(self) -> int:
        return self._total

    def count_for(self, client: str) -> int:
        return self._per_client.get(client, 0)

    def try_acquire(self, client: str) -> bool:
        """Reserva una plaza. `False` si no queda sitio —y entonces no reserva
        nada: quien recibe `False` no debe llamar a `release`."""
        if self._total >= self.max_total:
            return False
        if self._per_client.get(client, 0) >= self.max_per_client:
            return False
        self._per_client[client] = self._per_client.get(client, 0) + 1
        self._total += 1
        return True

    def release(self, client: str) -> None:
        remaining = self._per_client.get(client, 0) - 1
        if remaining > 0:
            self._per_client[client] = remaining
        else:
            # Se borra la entrada en vez de dejarla a cero: el diccionario lo
            # indexa la IP del cliente, así que conservar las que ya no tienen
            # conexiones convierte esto en una fuga de memoria proporcional al
            # número de direcciones que hayan pasado por el servidor.
            self._per_client.pop(client, None)
        self._total = max(0, self._total - 1)


def client_key(host: str | None, forwarded_for: str | None, trust_proxy: bool) -> str:
    """Con qué identidad se cuenta a un cliente.

    Detrás de un proxy —que es como hay que servir esto con TLS— todas las
    conexiones llegan con la IP del proxy, y el límite por cliente se
    convertiría en un segundo límite global que el primer usuario agota. La IP
    real está en `X-Forwarded-For`.

    Esa cabecera la puede escribir cualquiera, así que solo se lee cuando el
    despliegue declara que hay un proxy de confianza delante. Sin esa
    declaración, un atacante rotaría la cabecera en cada conexión y tendría
    plazas infinitas: creerse un `X-Forwarded-For` sin proxy delante es peor
    que no mirar la IP.
    """
    if trust_proxy and forwarded_for:
        first = forwarded_for.split(",")[0].strip()
        if first:
            return first
    return host or "desconocido"
