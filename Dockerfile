# One container: both SPAs (static) + the API (03-platform-deploy.md).
# Each app/service keeps its own package-lock.json (no npm workspaces), so
# each stage installs and builds independently.

# ---- workspace (staff app) ----
FROM node:20-slim AS workspace-build
WORKDIR /repo/apps/workspace
COPY apps/workspace/package.json apps/workspace/package-lock.json ./
RUN npm ci
COPY apps/workspace/ ./
RUN npm run build

# ---- my-pranava-home (customer portal) — served under /home ----
FROM node:20-slim AS portal-build
WORKDIR /repo/apps/my-pranava-home
COPY apps/my-pranava-home/package.json apps/my-pranava-home/package-lock.json ./
RUN npm ci
COPY apps/my-pranava-home/ ./
ENV BASE_PATH=/home/
RUN npm run build

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

COPY services/api/package.json services/api/package-lock.json ./
COPY --from=api-deps /repo/services/api/node_modules ./node_modules

COPY services/api/src ./src
COPY services/api/migrations ./migrations
COPY services/api/tsconfig.json ./tsconfig.json
COPY --from=workspace-build /repo/apps/workspace/dist ./public/workspace
COPY --from=portal-build /repo/apps/my-pranava-home/dist ./public/portal

EXPOSE 8080
CMD ["npm", "start"]
