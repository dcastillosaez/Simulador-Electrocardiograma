# Despliegue fuera del portátil

Todo lo que hay en esta carpeta sobra mientras el simulador corra en
`localhost`, que es como lo levanta `arrancar.bat`. Empieza a hacer falta en el
momento en que alguien se conecta desde otro equipo.

## Qué cambia al salir a la red

`arrancar.bat` lanza uvicorn sin `--host`, y el valor por defecto es
`127.0.0.1`: hoy la API es inalcanzable desde otra máquina. Ponerla en la red
es añadir `--host 0.0.0.0`, y ese es el cambio que convierte en reales todos
los riesgos del análisis de seguridad. Si lo haces, hazlo con el proxy delante
y no a pelo.

## TLS

`Caddyfile` termina TLS y reenvía a la API en local. Caddy obtiene y renueva el
certificado por su cuenta si el servidor tiene nombre público; para un aula sin
nombre, `tls internal` emite uno de su CA local que hay que instalar en los
equipos.

Un certificado que el navegador rechaza es peor que no tener TLS: enseña a los
alumnos a pulsar «continuar de todos modos», y esa costumbre no se queda en el
aula.

Sin TLS, el día que haya login la contraseña viaja en claro por la red del
centro. Por eso el orden importa: TLS antes que login, no después.

## La API detrás del proxy

```bash
TRUST_PROXY=true uv run uvicorn ecg_api.main:app --host 127.0.0.1 --port 8000
```

Dos condiciones que van juntas:

- **`--host 127.0.0.1`**: la API solo escucha para el proxy. Si escuchara en
  `0.0.0.0`, cualquiera de la red podría saltarse el proxy.
- **`TRUST_PROXY=true`**: hace que la API lea `X-Forwarded-For` para saber
  quién es cada cliente. Sin esto, el aforo por cliente cuenta a todo el mundo
  como el proxy y se convierte en un segundo límite global.

Activar `TRUST_PROXY` **sin** un proxy delante es peor que no activarlo: la
cabecera la escribe cualquiera, y rotándola en cada conexión se consiguen
plazas infinitas.

## Aforo

Los valores por defecto (`Settings` en `apps/api/src/ecg_api/config.py`) van
holgados para un aula y apretados para un script:

| Variable | Por defecto | Qué controla |
|---|---|---|
| `MAX_WS_CONNECTIONS` | 50 | Simulaciones simultáneas en todo el proceso |
| `MAX_WS_CONNECTIONS_PER_CLIENT` | 5 | Cuántas puede abrir una misma máquina |
| `MAX_WS_MESSAGE_BYTES` | 65536 | Tamaño máximo de un mensaje de control |

Súbelos con cuidado: el techo real no es este número sino la CPU de la máquina,
porque un solo proceso sostiene todas las simulaciones.

## Orígenes permitidos

`CORS_ORIGINS` lista los orígenes del frontend, separados por comas. Vale tanto
para las rutas REST como para el WebSocket, que comprueba la cabecera `Origin`
del handshake.
