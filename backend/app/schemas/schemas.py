from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=300)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=300)
    new_password: str = Field(min_length=6, max_length=300)


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=300)


class StatusRequest(BaseModel):
    status: str = ""
    leaveUntil: str | None = None


class AssignBedRequest(BaseModel):
    bedId: str


class BulkAssignRequest(BaseModel):
    residentIds: list[str] = Field(default_factory=list)
    buildingId: str | None = None
    roomId: str | None = None
    bedId: str | None = None


class ApproveRequest(BaseModel):
    notes: str = ""
    employeeCode: str = ""
    bedId: str = ""


class RejectRequest(BaseModel):
    notes: str = ""


class RequestStatusRequest(BaseModel):
    status: str
    notes: str = ""


class RestoreRequest(BaseModel):
    confirm: str
    data: dict[str, Any]


class LinkWorkersRequest(BaseModel):
    residentIds: list[str] = Field(default_factory=list)


class BulkResidentsRequest(BaseModel):
    residents: list[dict[str, Any]] = Field(default_factory=list)
    replace: bool = False
