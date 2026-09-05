#!/bin/sh
# Container start: migrate under an advisory lock, seed config, then serve.
# The lock makes two tasks starting together safe (technical/02 §7).
set -e

alembic upgrade head

if [ -f seeds/config/__init__.py ] || [ -f seeds/config.py ]; then
  echo "[entrypoint] seeding config"
  python -m seeds.config
else
  echo "[entrypoint] no seeds.config yet - skipping"
fi

exec uvicorn app:app --host 0.0.0.0 --port 8001 --workers 1 ${UVICORN_EXTRA_ARGS}
