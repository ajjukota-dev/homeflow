# 03 · Identity and access

Two realms, one session table, no passwords. Staff sign in with Google Workspace; customers with an OTP to the mobile on their booking. Authorisation is three layers: RBAC matrix (what a role may do), RLS (which rows), redaction (which fields). Replaces v1's JWT + bcrypt + Emergent broker ([`../foundation/v1-reuse.md`](../foundation/v1-reuse.md) §4).

---

## 1. Staff sign-in — Google OIDC (server-side)

```
GET  /auth/google/start
     → generate state (32 random bytes) + PKCE verifier; store both in a short-lived signed cookie hf_oauth (10 min)
     → 302 to https://accounts.google.com/o/oauth2/v2/auth?client_id&redirect_uri&response_type=code
              &scope=openid email profile&state&code_challenge&hd=<GOOGLE_ALLOWED_HD>&prompt=select_account
GET  /auth/google/callback?code&state
     1. state must equal cookie; cookie deleted
     2. exchange code at token endpoint (authlib, server-side, client secret from settings)
     3. verify id_token: signature against Google JWKS (cached 6h), iss, aud = client_id, exp,
        email_verified = true, hd ∈ GOOGLE_ALLOWED_HD (list; e.g. pranava.in)
     4. user = SELECT … FROM "user" WHERE email = :email AND is_active   — no row → 403 NOT_PROVISIONED (page: "ask your admin")
     5. UPDATE "user" SET google_sub = :sub (first time), last_login_at = now()
     6. create session (§3), set cookie, emit event user.signed_in
     7. 302 to the `next` path stored at /start (validated: same-origin relative path only)
POST /auth/logout   → revoke session (revoked_at = now()), clear cookie, 204
```

Users are **provisioned**, never self-registered: `modules/admin` creates the `user` row with roles and project assignments; the first Google sign-in binds `google_sub`. Deactivating a user (`is_active = false`) also revokes all their sessions in the same transaction.

Local: the same code path against a dev OAuth client whose redirect URI is `http://localhost:8001/auth/google/callback`. Only when `ENV=local` and `HOMEFLOW_DEV_LOGIN=1`, `GET /auth/dev-login?user=<email>` creates a session for a seeded user; `app.py` refuses to start if `HOMEFLOW_DEV_LOGIN` is set with `ENV != local`.

---

## 2. Customer sign-in — OTP

```
POST /auth/otp/request   { phone }                        (phone normalised to E.164, +91 default)
     1. rate limit: ≤ 3 requests per phone per 10 min, ≤ 20 per IP per hour → 429 (counted from otp_challenge)
     2. customer = SELECT c.* FROM customer c JOIN booking_applicant ba … JOIN booking b …
                   WHERE c.primary_phone = :phone AND b.status IN ('active','crm_accepted','registered','handed_over')
        no match → still 200 { sent: true } (no enumeration); nothing is sent
     3. code = 6 digits from secrets.randbelow; INSERT otp_challenge(code_hash = sha256(code || SESSION_SECRET), expires_at = now()+5 min)
     4. enqueue job notify.send (template otp_login, channel whatsapp, fallback sms) — same transaction
POST /auth/otp/verify    { phone, code }
     1. latest unconsumed, unexpired challenge for phone; attempts < 5 else 423 LOCKED
     2. constant-time compare of hashes; mismatch → attempts += 1, 401
     3. consumed_at = now(); create session realm=customer (§3); cookie; event customer.signed_in
```

A customer with several bookings (or several projects) gets one session; the portal lets them switch booking. Consent to WhatsApp OTP is implied by the booking's contact details; marketing consent is separate (`customer.consent`).

---

## 3. Sessions

| Field | Staff | Customer |
|---|---|---|
| Cookie | `hf_session`; `HttpOnly; Secure; SameSite=Lax; Path=/`; host-only (no `Domain`) | same name, set on `my.` host — the two hosts never share cookies |
| Token | 32 random bytes, base64url; DB stores `sha256(token)` only | same |
| Idle timeout | 12 h (`last_seen_at` refreshed at most once per 5 min) | 30 d |
| Absolute | 7 d | 90 d |
| Revocation | logout, deactivation, admin "sign out everywhere", `session.revoked_at` | same |

`session_middleware`: read cookie → hash → `SELECT … WHERE token_hash AND revoked_at IS NULL AND expires_at > now()` → build `Principal` → `request.state.principal`. No cookie or no row → `Anonymous`. The lookup is one indexed primary-key read per request; no cache needed at this scale.

---

## 4. Principal

```python
@dataclass(frozen=True)
class Principal:
    realm: Literal["staff", "customer"]
    user_id: UUID | None
    customer_id: UUID | None
    role_ids: frozenset[str]          # staff only
    project_ids: frozenset[UUID]      # staff: from project_team_assignment effective today; customer: projects of own bookings
    all_projects: bool                # any role with role.all_projects (super_admin, management)
    display_name: str
    session_id: UUID
```

Loaded in `kernel/identity/principal.py::load(session_row)` with two queries (roles, project assignments). `project_ids` for staff = projects where the user is `primary_owner`, `backup_owner`, or a member of an assigned team, with `effective_from <= today < coalesce(effective_to, 'infinity')`.

---

## 5. CSRF

Cookies are `SameSite=Lax`, both apps are same-origin with their API, and every non-GET request must carry `X-Requested-With: HomeFlow`. A browser cannot add that header cross-site without a CORS preflight, and CORS is not enabled. `csrf_middleware` returns 403 `CSRF_HEADER_MISSING` otherwise. `/auth/google/callback` (GET) and `/auth/otp/*` (POST, pre-session, but still requires the header from the SPA) follow the same rule.

---

## 6. RLS context

`kernel/db.py::tx(principal)`:

```python
async with engine.begin() as conn:
    await conn.execute(text("SELECT set_config('app.realm', :realm, true), set_config('app.user_id', :uid, true), "
                            "set_config('app.customer_id', :cid, true), set_config('app.project_ids', :pids, true), "
                            "set_config('app.all_projects', :all, true)"), {...})
    yield Tx(conn, principal)
```

`set_config(..., true)` = `SET LOCAL`: scoped to the transaction, so pooled connections never leak a context. `Anonymous` sets `app.realm = 'none'` — every policy evaluates false, so an unauthenticated request that reaches SQL sees nothing even if a route forgot `require()`.

Jobs run with a **system principal**: `realm = 'staff'`, `all_projects = true`, `actor = {type: system}`. The ticker is the only code allowed to construct it.

---

## 7. RBAC matrix

`permission(role_id, module, level, modifiers)` is seeded from v1's `rbac_matrix.py` (`_ALL_MODULES` × `CANONICAL_ROLES`) and edited in Policy Studio. Levels order: `none < read_status_only < read_limited < read < write < admin`.

```python
def require(module: str, action: Literal["read","write","admin"]) -> Depends:
    async def dep(request) -> Principal:
        p = request.state.principal
        if p.realm == "customer": raise AppError("FORBIDDEN") if module != "customer_portal" else p
        if not any(level_of(r, module) >= NEEDED[action] for r in p.role_ids): raise AppError("FORBIDDEN", module=module)
        return p
```

The matrix is loaded into memory at startup and reloaded on `permission` change (a `config.changed` event → job `config.reload`). Module names = the folders in `modules/` plus the kernel surfaces (`actions`, `files`, `events`).

**Hard write fences** beyond the matrix (from [`../foundation/gates.md`](../foundation/gates.md) A.7): endpoints that write `unit_progress_state`, `change_gate_rule`, `handover_gate.override`, `qa_evidence` are additionally guarded by `require_role_in({...})` with an explicit role set. A CI test enumerates those routes and asserts that `sales` and `crm` roles get 403.

---

## 8. Field-level redaction

Carried from v1's `rbac_redact.py`, made data-driven: `permission.modifiers` holds `hidden_fields` (removed) and `masked_fields` (e.g. PAN → `XXXXX1234F`) per role per module. Applied in `kernel/identity/redact.py::redact(model, principal, module)` after the response model is built, before serialisation. Response models never include internal-only fields for customer routes in the first place (08 §5); redaction is the staff-side second line.

Sensitive by default (masked unless `level = admin` or the module's modifiers say otherwise): `pan`, `aadhaar`, bank account numbers, `customer.consent`, `salary`/income fields on applicants.

---

## 9. Audit of identity

Events: `user.provisioned`, `user.deactivated`, `user.signed_in`, `user.signed_out`, `customer.signed_in`, `session.revoked`, `permission.changed`. Each `session` row keeps `ip` and `user_agent`. Failed OTP attempts are countable from `otp_challenge` (retained 30 days, then pruned by `job.prune`).

---

## 10. Threat checklist (must hold; tested in `tests/security/`)

- Session token never logged; only its hash is stored. `SESSION_SECRET` rotation invalidates OTP hashes only, not sessions.
- Open redirect: `next` must be a relative path starting with `/` and not `//`.
- OTP: 5-minute expiry, 5 attempts, per-phone and per-IP rate limits, no user enumeration, constant-time compare.
- Google: `hd` claim enforced server-side (the `hd` request parameter is only a UI hint); `email_verified` required.
- Customer realm cannot reach any non-`customer_portal` route (matrix) and cannot see any non-own row (RLS) — both tested.
- Deactivated user: sessions revoked in the same transaction as `is_active = false`.
- A request with no session reaches SQL with `app.realm = 'none'` and reads zero rows.
