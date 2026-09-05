# Which Python files CI lints and type-checks. Sourced by both
# .github/workflows/ci.yml and scripts/ci-local.sh so the two can never drift.
#
# v1's ~17k carried lines are deliberately absent: they were moved, not
# rewritten, and they gain types and lint compliance as each module is ported
# (TASKS Vivek 12-15). Add a path here in the same PR that ports it.
#
# Paths are relative to services/api.

RUFF_TARGETS="
kernel/db.py
kernel/errors.py
kernel/pagination.py
kernel/middleware.py
kernel/health.py
kernel/idempotency.py
kernel/identity/session.py
kernel/identity/otp.py
kernel/identity/google.py
kernel/identity/oauth_state.py
kernel/identity/rbac.py
kernel/identity/redact.py
kernel/identity/principal.py
kernel/identity/middleware.py
kernel/identity/router.py
kernel/identity/auth_utils.py
kernel/events/append.py
kernel/events/catalogue.py
kernel/events/consumers.py
kernel/events/router.py
kernel/jobs
kernel/files/router.py
kernel/files/service.py
kernel/files/ownership.py
kernel/files/port.py
kernel/files/handlers.py
kernel/notifications/port.py
seeds/config
tests
app.py
settings.py
"

# mypy runs --strict on these (pyproject: [[tool.mypy.overrides]] kernel.*, domain.*),
# so the list is narrower: no v1 file, and no 2.0 file that imports one untyped.
MYPY_TARGETS="
kernel/db.py
kernel/errors.py
kernel/pagination.py
kernel/identity/session.py
kernel/identity/otp.py
kernel/identity/google.py
kernel/identity/rbac.py
kernel/identity/redact.py
kernel/identity/principal.py
kernel/events/append.py
kernel/events/catalogue.py
kernel/events/consumers.py
kernel/events/router.py
kernel/jobs
kernel/files/router.py
kernel/files/service.py
kernel/files/ownership.py
kernel/files/port.py
kernel/files/handlers.py
"
