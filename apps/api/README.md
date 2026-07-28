# ecg-api

API y streaming del simulador de ECG. FastAPI, un solo worker de uvicorn.

## Desarrollo

    uv sync --extra dev
    docker compose -f ../../docker-compose.yml up -d db
    uv run alembic upgrade head
    uv run uvicorn ecg_api.main:app --reload

## Tests

    uv run pytest tests/unit          # sin Postgres
    uv run pytest tests/integration   # requiere el contenedor db arriba
