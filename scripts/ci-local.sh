#!/usr/bin/env bash
# Run what CI runs, in the order CI runs it, against the local compose stack.
#
#   npm run ci:local            everything
#   npm run ci:local -- backend just that job
#
# Jobs mirror .github/workflows/ci.yml one for one, so a green run here is a
# green run there. What it cannot mirror: the service containers (it uses the
# compose stack you already have) and the image job's fresh database.
#
# Prerequisites: docker compose stack up (`npm run stack:dev`), node, uv.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API="${HOMEFLOW_API:-http://localhost:8001}"
PGPORT="${POSTGRES_HOST_PORT:-5434}"
JOB="${1:-all}"

# The single source of truth for what CI lints and type-checks.
# shellcheck source=./ci-targets.sh
. "$ROOT/scripts/ci-targets.sh"

FAILED=()
step() {
  local name="$1"; shift
  printf '\n\033[1m── %s\033[0m\n' "$name"
  if "$@"; then
    printf '\033[32m   ok\033[0m  %s\n' "$name"
  else
    printf '\033[31m   FAILED\033[0m  %s\n' "$name"
    FAILED+=("$name")
  fi
}

require_stack() {
  if ! curl -fsS "$API/health" >/dev/null; then
    echo "The API is not answering at $API/health. Start it with: npm run stack:dev" >&2
    exit 1
  fi
}

# Run a command inside services/api in a subshell, so unquoted target lists split
# into argv on whitespace instead of being re-parsed as a shell string.
in_api() { ( cd services/api && "$@" ); }

job_backend() {
  step "backend · ruff"   in_api uv run ruff check $RUFF_TARGETS
  step "backend · mypy"   in_api uv run mypy $MYPY_TARGETS
  step "backend · pytest" sh -c "cd services/api && POSTGRES_HOST_PORT=$PGPORT uv run pytest -q"
}

job_frontend() {
  step "frontend · tsc"    npm run typecheck
  step "frontend · eslint" npm run lint
  step "frontend · vitest" npm test
  step "frontend · build"  npm run build
}

job_contract() {
  require_stack
  step "contract · openapi types are current" sh -c '
    npm run gen:api >/dev/null
    git diff --exit-code packages/ui/src/api/types.ts \
      || { echo "packages/ui/src/api/types.ts is stale - run: npm run gen:api"; exit 1; }'
  step "contract · schemathesis (no 5xx)" sh -c "
    set -e
    JAR=\$(mktemp)
    curl -sS -c \"\$JAR\" -o /dev/null '$API/auth/dev-login?user=aarti.rao@pranava.local'
    COOKIE=\$(grep -i hf_session \"\$JAR\" | awk '{print \$7}')
    [ -n \"\$COOKIE\" ] || { echo 'dev-login did not set a session (HOMEFLOW_DEV_LOGIN=1?)'; exit 1; }
    cd services/api
    MSYS_NO_PATHCONV=1 PYTHONIOENCODING=utf-8 PYTHONUTF8=1 uv run schemathesis run '$API/api/openapi.json' \
      --url '$API' \
      --include-path-regex '^/(api/v1|auth|me/session|health)' \
      --exclude-path-regex '(dev-login|dev-otp|logout|google)' \
      -H 'X-Requested-With: HomeFlow' -H \"Cookie: hf_session=\$COOKIE\" \
      --checks not_a_server_error --max-examples 20"
}

job_image() {
  step "image · docker build" docker build -t homeflow-api:ci -f services/api/Dockerfile .
  step "image · serves both apps by Host" sh -c '
    set -e
    docker rm -f homeflow-ci >/dev/null 2>&1 || true
    docker run -d --name homeflow-ci --network pranava-homeflow_default \
      --env-file .env -e TICKER_ENABLED=false -p 8002:8001 homeflow-api:ci >/dev/null
    for i in $(seq 1 45); do curl -fsS http://localhost:8002/health >/dev/null && break; sleep 2; done
    curl -fsS -H "Host: localhost:8001"    http://localhost:8002/ | grep -q "Pranava HomeFlow"
    curl -fsS -H "Host: my.localhost:8001" http://localhost:8002/ | grep -q "My Pranava Home"
    docker rm -f homeflow-ci >/dev/null'
}

job_e2e() {
  require_stack
  step "e2e · workspace"  sh -c '
    set -e
    VITE_DEV_LOGIN=1 npm run dev -w @homeflow/workspace >/tmp/hf-vite-ws.log 2>&1 &
    PID=$!; trap "kill $PID 2>/dev/null" EXIT
    npx wait-on http://localhost:5173 --timeout 120000
    npm run e2e -w @homeflow/workspace'
  step "e2e · my-pranava-home" sh -c '
    set -e
    npm run dev -w @homeflow/my-pranava-home >/tmp/hf-vite-cust.log 2>&1 &
    PID=$!; trap "kill $PID 2>/dev/null" EXIT
    npx wait-on http://localhost:5174 --timeout 120000
    npm run e2e -w @homeflow/my-pranava-home'
}

job_infra() {
  step "infra · cdk test"           npm test -w @homeflow/infra
  step "infra · cdk synth"          npm run synth
  step "infra · cdk synth staging"  sh -c "cd infra && npx cdk synth -c stage=staging >/dev/null"
}

case "$JOB" in
  backend)  job_backend ;;
  frontend) job_frontend ;;
  contract) job_contract ;;
  image)    job_image ;;
  e2e)      job_e2e ;;
  infra)    job_infra ;;
  all)      job_backend; job_frontend; job_contract; job_image; job_e2e; job_infra ;;
  *) echo "usage: ci-local.sh [backend|frontend|contract|image|e2e|infra|all]" >&2; exit 2 ;;
esac

printf '\n────────────────────────────────────────\n'
if [ ${#FAILED[@]} -eq 0 ]; then
  printf '\033[32mAll green.\033[0m\n'
else
  printf '\033[31m%d failed:\033[0m\n' "${#FAILED[@]}"
  printf '  - %s\n' "${FAILED[@]}"
  exit 1
fi
