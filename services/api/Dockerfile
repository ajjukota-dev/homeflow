# One image, everywhere (technical/10 §1): the API and both SPAs.
#
# Stage 1 builds apps/workspace and apps/my-pranava-home; stage 2 copies their
# dist/ into services/api/static/, which app.py serves by Host header
# (technical/09 §7). Nothing in the image knows whether it is on a laptop or ECS.
FROM node:22-alpine AS web
WORKDIR /w
COPY package.json package-lock.json .npmrc ./
COPY packages ./packages
COPY apps/workspace ./apps/workspace
COPY apps/my-pranava-home ./apps/my-pranava-home
RUN npm ci --no-audit --no-fund
RUN npm run build -w @homeflow/workspace -w @homeflow/my-pranava-home

FROM python:3.12-slim

# WeasyPrint's native stack (technical/10 §1)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 fonts-noto-core \
      curl \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app
RUN pip install --no-cache-dir uv==0.11.9

COPY services/api/pyproject.toml services/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY services/api ./
COPY --from=web /w/apps/workspace/dist ./static/workspace
COPY --from=web /w/apps/my-pranava-home/dist ./static/customer

EXPOSE 8001
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=6 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8001/health')"

ENTRYPOINT ["sh", "./entrypoint.sh"]
