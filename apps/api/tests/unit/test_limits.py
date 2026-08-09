from ecg_api.limits import ConnectionLimiter, client_key


def test_accepts_up_to_the_total_limit():
    limiter = ConnectionLimiter(max_total=2, max_per_client=10)

    assert limiter.try_acquire("a") is True
    assert limiter.try_acquire("b") is True
    assert limiter.try_acquire("c") is False
    assert limiter.total == 2


def test_a_single_client_cannot_take_every_seat():
    # Con solo un tope global, un cliente con un bucle se lleva las cincuenta
    # plazas y el aula se queda fuera sin que el servidor se considere lleno.
    limiter = ConnectionLimiter(max_total=10, max_per_client=2)

    assert limiter.try_acquire("mismo") is True
    assert limiter.try_acquire("mismo") is True
    assert limiter.try_acquire("mismo") is False
    assert limiter.try_acquire("otro") is True


def test_a_rejected_attempt_reserves_nothing():
    limiter = ConnectionLimiter(max_total=1, max_per_client=1)
    limiter.try_acquire("a")

    assert limiter.try_acquire("b") is False
    assert limiter.total == 1  # el rechazo no dejó una plaza a medio ocupar


def test_releasing_frees_the_seat():
    limiter = ConnectionLimiter(max_total=1, max_per_client=1)
    limiter.try_acquire("a")
    limiter.release("a")

    assert limiter.total == 0
    assert limiter.try_acquire("b") is True


def test_releasing_forgets_the_client():
    # El diccionario lo indexa la IP: conservar las entradas a cero es una
    # fuga de memoria proporcional a cuantas direcciones hayan pasado.
    limiter = ConnectionLimiter(max_total=5, max_per_client=5)
    limiter.try_acquire("a")
    limiter.release("a")

    assert limiter.count_for("a") == 0
    assert limiter._per_client == {}


def test_releasing_more_than_acquired_does_not_go_negative():
    limiter = ConnectionLimiter(max_total=5, max_per_client=5)
    limiter.release("fantasma")

    assert limiter.total == 0


class TestClientKey:
    def test_uses_the_socket_address_by_default(self):
        assert client_key("10.0.0.5", None, trust_proxy=False) == "10.0.0.5"

    def test_ignores_the_forwarded_header_without_a_trusted_proxy(self):
        # La cabecera la escribe cualquiera: rotarla en cada conexion daria
        # plazas infinitas. Creersela sin proxy delante es peor que no mirar.
        assert (
            client_key("10.0.0.5", "1.2.3.4", trust_proxy=False) == "10.0.0.5"
        )

    def test_reads_the_real_client_behind_a_trusted_proxy(self):
        # Detras del proxy todas las conexiones llegan con su IP, y el limite
        # por cliente se volveria un segundo limite global.
        assert (
            client_key("172.18.0.2", "1.2.3.4, 172.18.0.2", trust_proxy=True)
            == "1.2.3.4"
        )

    def test_falls_back_when_there_is_no_address_at_all(self):
        assert client_key(None, None, trust_proxy=False) == "desconocido"
