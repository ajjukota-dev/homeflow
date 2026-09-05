"""Global search across customers, units, projects, bookings."""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, Query

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, scoped_customer_ids,
)
from kernel.mongo import get_db


router = APIRouter(tags=["search"])


def _rx(q: str) -> re.Pattern:
    return re.compile(re.escape(q), re.IGNORECASE)


@router.get("/search")
async def global_search(
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(8, ge=1, le=25),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    rx = _rx(q.strip())

    # Phase 9: project scope
    all_access = is_all_projects_user(current_user)
    project_scope = None if all_access else (get_project_scope(current_user) or [])
    if not all_access and not project_scope:
        return {"query": q, "customers": [], "units": [], "projects": [], "bookings": []}
    cust_scope = None
    if not all_access:
        cust_scope = await scoped_customer_ids(current_user) or []

    cust_filter: dict = {
        "$or": [
            {"primary_name": rx},
            {"email": rx},
            {"phone": rx},
            {"code": rx},
        ]
    }
    if cust_scope is not None:
        if not cust_scope:
            customers = []
        else:
            cust_filter["id"] = {"$in": cust_scope}
    if cust_scope is None or cust_scope:
        customers = await db.customers.find(
            cust_filter,
            {"_id": 0, "id": 1, "code": 1, "primary_name": 1, "email": 1, "phone": 1, "city": 1},
        ).limit(limit).to_list(limit)

    unit_filter: dict = {"$or": [{"code": rx}, {"unit_no": rx}, {"tower": rx}]}
    if project_scope is not None:
        unit_filter["project_id"] = {"$in": project_scope}
    units = await db.units.find(
        unit_filter,
        {"_id": 0, "id": 1, "code": 1, "project_id": 1, "unit_no": 1, "status": 1, "unit_type": 1},
    ).limit(limit).to_list(limit)

    proj_filter: dict = {"$or": [{"code": rx}, {"name": rx}, {"location": rx}]}
    if project_scope is not None:
        proj_filter["id"] = {"$in": project_scope}
    projects = await db.projects.find(
        proj_filter,
        {"_id": 0, "id": 1, "code": 1, "name": 1, "type": 1, "location": 1, "status": 1},
    ).limit(limit).to_list(limit)

    book_filter: dict = {"$or": [{"code": rx}, {"notes": rx}]}
    if project_scope is not None:
        book_filter["project_id"] = {"$in": project_scope}
    bookings = await db.bookings.find(
        book_filter,
        {
            "_id": 0,
            "id": 1,
            "code": 1,
            "project_id": 1,
            "unit_id": 1,
            "customer_id": 1,
            "status": 1,
            "agreement_value_inr": 1,
        },
    ).limit(limit).to_list(limit)

    return {
        "query": q,
        "customers": customers,
        "units": units,
        "projects": projects,
        "bookings": bookings,
    }
