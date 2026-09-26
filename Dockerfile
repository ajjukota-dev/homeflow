# One container: both SPAs (static) + the API (03-platform-deploy.md).
# Frontends share the root lockfile and @homeflow/ui. The API keeps its own
# lockfile. Per-app package-lock.json files do not exist.

# ---- frontends (staff workspace + customer portal) ----
FROM node:20-slim AS frontend-build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/ui ./packages/ui
COPY apps ./apps
RUN npm ci
RUN npm --prefix apps/workspace run build
ENV BASE_PATH=/home/
RUN npm --prefix apps/my-pranava-home run build

# ---- api runtime deps (production only) ----
FROM node:20-slim AS api-deps
WORKDIR /repo/services/api
COPY services/api/package.json services/api/package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----
# Playwright's own image (built FROM node:20, per their Dockerfile) ships
# Chromium and every apt dependency it needs already installed — the pdf
# port (HTML → PDF) just works. Chosen over `node:20-slim` + `playwright
# install --with-deps` because that apt-get step is flaky behind this
# environment's Docker network (deb.debian.org DNS failures); the
# pre-baked image needs no package install at build time. Version pinned
# to match the `playwright` npm package in services/api/package.json.
FROM mcr.microsoft.com/playwright:v1.49.0-noble AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA

COPY services/api/package.json services/api/package-lock.json ./
COPY --from=api-deps /repo/services/api/node_modules ./node_modules

COPY services/api/src ./src
COPY services/api/migrations ./migrations
COPY services/api/tsconfig.json ./tsconfig.json
COPY --from=frontend-build /repo/apps/workspace/dist ./public/workspace
COPY --from=frontend-build /repo/apps/my-pranava-home/dist ./public/portal

EXPOSE 8080
CMD ["npm", "start"]
