"""Pydantic models used by Pranava HomeFlow Phase 1."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


def _uuid() -> str:
    return str(uuid.uuid4())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Base ----------

class Base(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


# ---------- Auth ----------

class LoginRequest(Base):
    email: str
    password: str


class TokenResponse(Base):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshRequest(Base):
    refresh_token: str


# ---------- Role / Department ----------

class Role(Base):
    id: str = Field(default_factory=_uuid)
    code: str
    name: str
    description: Optional[str] = None
    is_super_admin: bool = False


class DepartmentBase(Base):
    name: str
    code: str
    active: bool = True


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(Base):
    name: Optional[str] = None
    code: Optional[str] = None
    active: Optional[bool] = None


class Department(DepartmentBase):
    id: str = Field(default_factory=_uuid)
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)


# ---------- User ----------

class UserBase(Base):
    email: str
    name: str
    phone: Optional[str] = None
    role_id: str
    department_id: Optional[str] = None
    manager_id: Optional[str] = None
    active: bool = True
    assigned_project_ids: list[str] = Field(default_factory=list)


class UserCreate(UserBase):
    password: str


class UserUpdate(Base):
    email: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    role_id: Optional[str] = None
    department_id: Optional[str] = None
    manager_id: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = None
    assigned_project_ids: Optional[list[str]] = None


class UserOut(UserBase):
    id: str
    created_at: str
    updated_at: str


class UserInDB(UserBase):
    id: str = Field(default_factory=_uuid)
    password_hash: str
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)


# ---------- Project ----------

ProjectType = Literal["Apartment", "Villa"]
ProjectStatus = Literal["Active", "Handover", "Closed"]


class ProjectBase(Base):
    code: str
    name: str
    type: ProjectType
    location: str
    status: ProjectStatus = "Active"


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(Base):
    code: Optional[str] = None
    name: Optional[str] = None
    type: Optional[ProjectType] = None
    location: Optional[str] = None
    status: Optional[ProjectStatus] = None


class Project(ProjectBase):
    id: str = Field(default_factory=_uuid)
    created_at: str = Field(default_factory=_now_iso)


# ---------- Unit ----------

UnitStatus = Literal["Available", "Booked", "Registered", "Handed Over"]


class UnitBase(Base):
    project_id: str
    code: str
    tower: Optional[str] = None
    floor: Optional[str] = None
    unit_no: str
    unit_type: Optional[str] = None
    carpet_area_sqft: float
    facing: Optional[str] = None
    parking_count: int = 0
    status: UnitStatus = "Available"
    base_price_inr: float


class UnitCreate(UnitBase):
    pass


class UnitUpdate(Base):
    project_id: Optional[str] = None
    code: Optional[str] = None
    tower: Optional[str] = None
    floor: Optional[str] = None
    unit_no: Optional[str] = None
    unit_type: Optional[str] = None
    carpet_area_sqft: Optional[float] = None
    facing: Optional[str] = None
    parking_count: Optional[int] = None
    status: Optional[UnitStatus] = None
    base_price_inr: Optional[float] = None


class Unit(UnitBase):
    id: str = Field(default_factory=_uuid)
    created_at: str = Field(default_factory=_now_iso)


# ---------- Customer ----------

NriStatus = Literal["Resident", "NRI", "OCI"]
CommunicationPref = Literal["Email", "Phone", "WhatsApp"]
KycStatus = Literal["Pending", "Received", "Verified", "Rejected"]


class ApplicantBase(Base):
    name: str
    relation: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    pan: Optional[str] = None
    kyc_status: KycStatus = "Pending"


class ApplicantCreate(ApplicantBase):
    pass


class Applicant(ApplicantBase):
    id: str = Field(default_factory=_uuid)


class CustomerBase(Base):
    primary_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    nri_status: NriStatus = "Resident"
    communication_pref: CommunicationPref = "Email"
    address_line: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None


class CustomerCreate(CustomerBase):
    applicants: list[ApplicantCreate] = Field(default_factory=list)


class CustomerUpdate(Base):
    primary_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    nri_status: Optional[NriStatus] = None
    communication_pref: Optional[CommunicationPref] = None
    address_line: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    applicants: Optional[list[ApplicantCreate]] = None


class Customer(CustomerBase):
    id: str = Field(default_factory=_uuid)
    code: str
    applicants: list[Applicant] = Field(default_factory=list)
    created_at: str = Field(default_factory=_now_iso)


# ---------- Booking ----------

BookingStatus = Literal["Draft", "Confirmed", "Cancelled"]


class BookingBase(Base):
    project_id: str
    unit_id: str
    customer_id: str
    sales_owner_id: str
    crm_owner_id: Optional[str] = None
    booking_date: str  # DD MMM YYYY or ISO; stored as ISO string
    agreement_value_inr: float
    booking_amount_inr: float
    payment_plan: Optional[str] = None
    status: BookingStatus = "Draft"
    cancellation_reason: Optional[str] = None
    notes: Optional[str] = None


class BookingCreate(Base):
    project_id: str
    unit_id: str
    customer_id: str
    sales_owner_id: str
    crm_owner_id: Optional[str] = None
    booking_date: str
    agreement_value_inr: float
    booking_amount_inr: float
    payment_plan: Optional[str] = None
    notes: Optional[str] = None


class BookingUpdate(Base):
    sales_owner_id: Optional[str] = None
    crm_owner_id: Optional[str] = None
    booking_date: Optional[str] = None
    agreement_value_inr: Optional[float] = None
    booking_amount_inr: Optional[float] = None
    payment_plan: Optional[str] = None
    notes: Optional[str] = None


class BookingTransition(Base):
    to_status: BookingStatus
    reason: Optional[str] = None


class Booking(BookingBase):
    id: str = Field(default_factory=_uuid)
    code: str
    created_at: str = Field(default_factory=_now_iso)
