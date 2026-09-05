"""presign -> PUT -> confirm -> 302, against the compose MinIO (technical/08 §1)."""
from __future__ import annotations

import hashlib
from uuid import UUID, uuid4

import asyncpg
import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import text

from kernel.db import tx
from kernel.files.port import MAX_BYTES, s3, signer
from kernel.identity import session as session_mod
from kernel.identity.principal import SYSTEM, Principal
from kernel.jobs.registry import HANDLERS
from settings import settings
from tests.security.conftest import CSRF

pytestmark = pytest.mark.integration

PDF = b"%PDF-1.7\n% a real enough pdf for a checksum\n%%EOF\n"


@pytest.fixture
async def staff(client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection) -> dict:
    """A super_admin cookie: `files` needs write on the parent module too."""
    await owner.execute(
        "INSERT INTO user_role_assignment (user_id, role_id) VALUES ($1, 'super_admin')"
        " ON CONFLICT DO NOTHING",
        world["user"],
    )
    r = await client.get("/auth/dev-login", params={"user": world["email"]})
    return {session_mod.COOKIE_NAME: r.cookies[session_mod.COOKIE_NAME]}


async def _presign(client: AsyncClient, cookies: dict, **overrides) -> httpx.Response:
    body = {
        "entity_type": "snag",
        "entity_id": str(uuid4()),
        "filename": "before-repair.pdf",
        "content_type": "application/pdf",
        "size_bytes": len(PDF),
    }
    body.update(overrides)
    return await client.post("/api/v1/files/presign", headers=CSRF, cookies=cookies, json=body)


async def test_presign_put_confirm_download(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection, staff: dict
) -> None:
    r = await _presign(client, staff, entity_id=str(world["snag"]))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    file_id = data["file_id"]

    # The browser PUTs straight to MinIO. From the host that is localhost:9000.
    async with httpx.AsyncClient() as raw:
        put = await raw.put(
            data["upload"]["url"], content=PDF, headers=data["upload"]["headers"]
        )
    assert put.status_code == 200, put.text

    confirmed = await client.post(
        f"/api/v1/files/{file_id}/confirm", headers=CSRF, cookies=staff
    )
    assert confirmed.status_code == 200, confirmed.text
    body = confirmed.json()["data"]
    assert body["status"] == "ready"
    assert body["size_bytes"] == len(PDF)
    assert body["sha256"] == hashlib.sha256(PDF).hexdigest()

    row = await owner.fetchrow("SELECT * FROM file_object WHERE id = $1", UUID(file_id))
    assert row["s3_key"] == f"{world['project']}/snag/{world['snag']}/{file_id}"
    assert row["project_id"] == world["project"]
    head = s3().head_object(Bucket=settings.S3_BUCKET, Key=row["s3_key"])
    assert head["ContentLength"] == len(PDF)

    attached = await owner.fetch(
        "SELECT subject FROM event WHERE event_type = 'file.attached'"
        " AND subject->>'file_id' = $1", file_id
    )
    assert len(attached) == 1

    got = await client.get(f"/api/v1/files/{file_id}", cookies=staff)
    assert got.status_code == 302
    async with httpx.AsyncClient() as raw:
        fetched = await raw.get(got.headers["location"])
    assert fetched.status_code == 200
    assert fetched.content == PDF
    s3().delete_object(Bucket=settings.S3_BUCKET, Key=row["s3_key"])


async def test_a_content_type_off_the_list_is_refused(
    client: AsyncClient, world: dict[str, UUID], staff: dict
) -> None:
    r = await _presign(
        client, staff, entity_id=str(world["snag"]), content_type="application/x-msdownload"
    )
    assert r.status_code == 400
    assert r.json()["errors"][0]["field"] == "content_type"


async def test_a_file_over_fifty_megabytes_is_refused(
    client: AsyncClient, world: dict[str, UUID], staff: dict
) -> None:
    r = await _presign(client, staff, entity_id=str(world["snag"]), size_bytes=MAX_BYTES + 1)
    assert r.status_code == 400
    assert r.json()["errors"][0]["field"] == "size_bytes"


async def test_an_unknown_entity_type_cannot_carry_files(
    client: AsyncClient, world: dict[str, UUID], staff: dict
) -> None:
    r = await _presign(client, staff, entity_type="secret_ledger")
    assert r.status_code == 400
    assert r.json()["errors"][0]["field"] == "entity_type"


async def test_a_parent_the_caller_cannot_see_is_404(
    client: AsyncClient, world: dict[str, UUID], staff: dict
) -> None:
    r = await _presign(client, staff, entity_id=str(uuid4()))
    assert r.status_code == 404
    assert r.json()["errors"][0]["code"] == "NOT_FOUND"


async def test_an_internal_file_is_invisible_to_the_customer_realm(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection, staff: dict
) -> None:
    r = await _presign(client, staff, entity_id=str(world["snag"]))
    file_id = r.json()["data"]["file_id"]
    async with httpx.AsyncClient() as raw:
        await raw.put(
            r.json()["data"]["upload"]["url"], content=PDF,
            headers=r.json()["data"]["upload"]["headers"],
        )
    await client.post(f"/api/v1/files/{file_id}/confirm", headers=CSRF, cookies=staff)

    customer = Principal(realm="customer", customer_id=world["customer"], display_name="Kavya")
    from kernel.errors import AppError
    from kernel.files import service

    async with tx(customer) as t:
        with pytest.raises(AppError) as exc:
            await service.download_url(t, customer, UUID(file_id))
    assert exc.value.code == "NOT_FOUND"

    await owner.execute(
        "UPDATE file_object SET visibility = 'customer_facing' WHERE id = $1", UUID(file_id)
    )
    async with tx(customer) as t:
        url = await service.download_url(t, customer, UUID(file_id))
    assert url.startswith(str(settings.S3_PUBLIC_ENDPOINT_URL))
    key = await owner.fetchval("SELECT s3_key FROM file_object WHERE id = $1", UUID(file_id))
    s3().delete_object(Bucket=settings.S3_BUCKET, Key=key)


async def test_customer_facing_is_refused_on_an_internal_only_entity(
    client: AsyncClient, world: dict[str, UUID], staff: dict
) -> None:
    r = await _presign(
        client, staff, entity_type="unit", entity_id=str(world["unit"]),
        visibility="customer_facing",
    )
    assert r.status_code == 400
    assert r.json()["errors"][0]["field"] == "visibility"


async def test_prune_removes_an_abandoned_upload_and_its_orphan_object(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection, staff: dict
) -> None:
    r = await _presign(client, staff, entity_id=str(world["snag"]))
    file_id = UUID(r.json()["data"]["file_id"])
    async with httpx.AsyncClient() as raw:
        await raw.put(
            r.json()["data"]["upload"]["url"], content=PDF,
            headers=r.json()["data"]["upload"]["headers"],
        )
    key = await owner.fetchval("SELECT s3_key FROM file_object WHERE id = $1", file_id)
    await owner.execute(
        "UPDATE file_object SET created_at = now() - interval '2 days' WHERE id = $1", file_id
    )
    async with tx(SYSTEM) as t:
        await HANDLERS["file.prune"](t, {})
    assert await owner.fetchval("SELECT count(*) FROM file_object WHERE id = $1", file_id) == 0
    with pytest.raises(Exception):  # noqa: B017 — botocore's 404 class
        s3().head_object(Bucket=settings.S3_BUCKET, Key=key)


async def test_a_large_file_defers_its_checksum_to_a_job(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection, staff: dict
) -> None:
    big = b"x" * (5 * 1024 * 1024 + 1)
    r = await _presign(client, staff, entity_id=str(world["snag"]), size_bytes=len(big))
    file_id = UUID(r.json()["data"]["file_id"])
    async with httpx.AsyncClient(timeout=60.0) as raw:
        await raw.put(
            r.json()["data"]["upload"]["url"], content=big,
            headers=r.json()["data"]["upload"]["headers"],
        )
    confirmed = await client.post(f"/api/v1/files/{file_id}/confirm", headers=CSRF, cookies=staff)
    assert confirmed.json()["data"]["sha256"] is None
    queued = await owner.fetchval(
        "SELECT count(*) FROM job WHERE kind = 'file.checksum' AND dedupe_key = $1",
        f"file.checksum:{file_id}",
    )
    assert queued == 1
    async with tx(SYSTEM) as t:
        await HANDLERS["file.checksum"](t, {"file_id": str(file_id)})
    stored = await owner.fetchval("SELECT sha256 FROM file_object WHERE id = $1", file_id)
    assert stored == hashlib.sha256(big).digest()
    key = await owner.fetchval("SELECT s3_key FROM file_object WHERE id = $1", file_id)
    s3().delete_object(Bucket=settings.S3_BUCKET, Key=key)
    await owner.execute("DELETE FROM job WHERE dedupe_key = $1", f"file.checksum:{file_id}")


async def test_the_presigned_url_is_signed_for_the_browser_reachable_host() -> None:
    """SigV4 covers the Host header, so the URL is signed against the public endpoint
    rather than rewritten afterwards (technical/08 §1)."""
    assert settings.S3_PUBLIC_ENDPOINT_URL
    url = signer().generate_presigned_url(
        "get_object", Params={"Bucket": settings.S3_BUCKET, "Key": "a/b"}, ExpiresIn=60
    )
    assert url.startswith(settings.S3_PUBLIC_ENDPOINT_URL)
    assert "X-Amz-Signature=" in url


async def test_file_object_rows_are_project_scoped(
    world: dict[str, UUID], owner: asyncpg.Connection, staff: dict, client: AsyncClient
) -> None:
    r = await _presign(client, staff, entity_id=str(world["snag"]))
    file_id = UUID(r.json()["data"]["file_id"])
    stranger = Principal(realm="staff", user_id=uuid4(), role_ids=frozenset({"super_admin"}),
                         project_ids=frozenset({uuid4()}), display_name="Other Project")
    async with tx(stranger) as t:
        found = await t.conn.scalar(
            text("SELECT count(*) FROM file_object WHERE id = :id"), {"id": file_id}
        )
    assert found == 0
