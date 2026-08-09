# G3 revisada — la base de datos del escritorio

La especificación dejaba esta fase con una recomendación provisional
(«PostgreSQL local, por separación de riesgos») y una nota al margen: que quizá
el escritorio no necesitara motor de base de datos alguno. Esto es esa
conversación, con mediciones en vez de estimaciones.

Todo lo que sigue se ha comprobado ejecutándolo, no leyéndolo.

## 1. Cuánto acopla el código a PostgreSQL

Menos de lo que parecía. En todo el backend:

```
db/models.py:22   from sqlalchemy.dialects.postgresql import JSONB, UUID
db/models.py:43   spec:   mapped_column(JSONB)
db/models.py:58   params: mapped_column(JSONB)
db/seed.py:12     from sqlalchemy.dialects.postgresql import insert
```

Cuatro líneas en dos ficheros, más `UUID(as_uuid=True)` en las cuatro columnas
de identificador, más las dos migraciones que declaran esos mismos tipos. No
hay SQL escrito a mano en ninguna parte, ni funciones de PostgreSQL, ni tipos
exóticos. **El acoplamiento es de tipos, no de lógica.**

## 2. Los tipos genéricos, ¿degradan PostgreSQL?

Esta era la objeción seria: hacer el esquema portable podría empeorar el
servidor. Compilando cada tipo contra los dos dialectos:

| Tipo | PostgreSQL | SQLite |
|---|---|---|
| `sa.JSON()` | `JSON` | `JSON` |
| `sa.JSON().with_variant(JSONB(), "postgresql")` | **`JSONB`** | `JSON` |
| `sa.Uuid(as_uuid=True)` | **`UUID`** | `CHAR(32)` |
| `postgresql.UUID(as_uuid=True)` *(el actual)* | `UUID` | `UUID` |
| `sa.Numeric` / `sa.BigInteger` | `NUMERIC` / `BIGINT` | `NUMERIC` / `BIGINT` |

El resultado importa: con `with_variant`, **PostgreSQL sigue recibiendo
exactamente el mismo DDL que hoy** —`JSONB` y `UUID` nativos—, y SQLite recibe
lo que sabe entender. `sa.Uuid` ni siquiera necesita variante: ya emite el tipo
nativo en PostgreSQL.

Es decir: el esquema se puede hacer portable **sin cambiar una sola columna de
la base de datos del servidor**, y sin perder JSONB ni sus índices.

## 3. ¿Aguanta SQLite lo que la aplicación hace?

Prueba de concepto ejecutada contra `sqlite+aiosqlite`, reconstruyendo las tres
tablas con tipos genéricos y ejercitando el flujo real:

```
1. create_all sobre SQLite: OK
2. upsert idempotente: OK ('Ritmo sinusal normal (v2)', spec={...})
3. sesión + administraciones en un commit: OK
4. lectura: id=UUID  params=dict  duration=Decimal('12.5')
   administraciones ordenadas: ['verapamil', 'metoprolol']
5. FK sobre sesión inexistente: RECHAZADA (IntegrityError)
Tamaño del fichero: 28672 bytes
```

Los cinco puntos que había que despejar, despejados: el upsert del catálogo
funciona (SQLite tiene `ON CONFLICT DO UPDATE`), los tipos vuelven de la base
como `UUID`, `dict` y `Decimal` igual que con asyncpg, y el orden con desempate
por `id` se comporta igual.

### El detalle que casi se cuela

**SQLite no aplica claves foráneas salvo que se le pida en cada conexión.** La
prueba las rechaza porque el script activa `PRAGMA foreign_keys=ON` en el evento
`connect`. Sin esa línea, el punto 5 habría dicho «ACEPTADA».

Esto no es un tecnicismo: el bug que arreglamos hace dos días —las
administraciones insertándose antes que su sesión— **lo detectó Postgres al
rechazar la FK**. Con SQLite y sin el PRAGMA, ese bug habría escrito registros
huérfanos en silencio durante meses. Si se adopta SQLite, el PRAGMA no es
opcional y merece un test que verifique que está puesto.

## 4. Cuántos datos hay realmente

De la base de datos de desarrollo, después de meses de uso:

```
tamaño total de la base: 7927 kB
  rhythms:              12 filas, 144 kB
  sessions:             35 filas,  72 kB
  drug_administrations:  0 filas,  48 kB
```

**35 sesiones ocupan 72 KB.** Y las 12 filas de `rhythms` son un reflejo del
catálogo del motor, no datos del usuario: se reconstruyen solas en cada
arranque. Los datos que hay que preservar de verdad, a este ritmo, crecerían
unos 2 KB por sesión.

Poner un motor de base de datos de 200 MB, con su proceso, su cluster, su
`initdb` y su procedimiento de actualización de versión mayor, para custodiar
eso, es desproporcionado. Y no es una cuestión de eficiencia sino de superficie
de fallo: cada una de esas piezas es algo que puede romperse en el portátil de
alguien a quien no podemos asistir.

## 5. Qué pasa hoy sin base de datos

Verificado arrancando la API contra un puerto donde no hay nada:

```
ConnectionRefusedError: [WinError 1225] El equipo remoto rechazó la conexión
ERROR:    Application startup failed. Exiting.
```

**La aplicación entera no arranca.** No es que se pierda el historial: no hay
simulador. Y eso ocurre a pesar de que el catálogo de ritmos sale del motor y
de que la parte de escritura ya tolera fallos —`_maybe_persist`, en el handler
del WebSocket, registra el fallo y sigue—.

Lo que lo impide es una sola línea del `lifespan`: `seed_catalog`, que siembra
la tabla que ancla la clave foránea. Es la mitad del modo degradado ya
construida y la otra mitad sin construir.

## 6. Decisión revisada

**Opción B: SQLite en escritorio, PostgreSQL en servidor.** Cambio respecto a la
recomendación provisional de la especificación, y por estos motivos:

1. El riesgo que justificaba empezar por PostgreSQL —tocar el esquema y romper
   el servidor— **resulta ser evitable**: con `with_variant` el DDL de
   PostgreSQL no cambia en absoluto.
2. El trabajo real es de un par de días (cuatro líneas de tipos, el `insert` del
   `seed` elegido por dialecto, las dos migraciones y el PRAGMA), frente a las
   varias semanas de empaquetar, inicializar, actualizar y desinstalar un
   PostgreSQL portable.
3. Lo que se guarda son 2 KB por sesión.
4. Cada pieza que no se instala es una pieza que no falla en casa del usuario.
   Un fichero no tiene cluster que corromper, ni puerto que colisionar, ni
   servicio que se quede arrancado.
5. La copia de seguridad pasa de `pg_dump` a copiar un fichero, y la
   restauración, a pegarlo.

### Lo que cuesta esta opción, dicho claro

**Dos motores es soporte de dos motores.** La ventaja real de la Opción A era
que lo que se prueba en desarrollo es exactamente lo que corre en casa del
usuario. Con B, eso deja de ser cierto, y la única forma de que el soporte de
SQLite sea real y no teórico es **ejecutar la suite de integración contra los
dos**. Si eso no se hace, SQLite se romperá en algún commit y nadie se enterará
hasta que un usuario lo reporte.

Esa es la condición de la decisión, no una mejora opcional.

### Cuándo habría que reconsiderarlo

Si el escritorio pasa a necesitar consultas analíticas sobre el historial,
varios usuarios sobre la misma base, o sincronización con un servidor. Nada de
eso está en el roadmap actual; si entra, se reevalúa.

## 7. G3, reescrita

| Tarea | Qué implica | Estado |
|---|---|---|
| Esquema portable | `with_variant(JSONB)` en las dos columnas JSON, `sa.Uuid` en las cuatro de identificador | El DDL de PostgreSQL no cambia |
| `seed.py` | Elegir el `insert` del dialecto activo | Dos líneas |
| Migraciones | Reescribir las dos revisiones con los tipos portables | Seguro para bases ya migradas: el DDL de PostgreSQL es idéntico y una revisión aplicada no se vuelve a ejecutar |
| `PRAGMA foreign_keys=ON` | En el evento `connect` del engine de SQLite | Con test que lo verifique |
| Alembic programático | `Config` con `script_location` absoluto, sin depender del directorio de trabajo | Ya identificado en la especificación |
| **Modo degradado** | Que `seed_catalog` fallando no impida arrancar; endpoints de sesiones respondiendo un error claro | Es el criterio de aceptación de G3 |
| CI con dos motores | La suite de integración contra PostgreSQL y contra SQLite | Condición de la decisión |
| Primer arranque | Crear el fichero y migrar | Trivial comparado con `initdb` |

El criterio de aceptación de la fase no cambia, pero ahora se puede enunciar más
fuerte: **el simulador arranca, simula, mide y administra fármacos con la base
de datos borrada, y lo dice.**
