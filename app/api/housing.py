from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import require_any_permission, require_permission
from app.core.state import store
from app.core.housing_scope import scoped_data
from app.core.housing_scope import is_housing_monitor, monitor_guest_tree
from app.services.common import ServiceError, clean_str, now_iso, paged
from app.services.housing import (
    bed_by_id,
    building_by_id,
    buildings_tree,
    cancel_rotation,
    create_beds,
    create_building,
    create_room,
    delete_bed,
    delete_building,
    delete_room,
    execute_rotation,
    resident_on_bed,
    room_by_id,
    schedule_rotation,
    update_bed,
    update_building,
    update_room,
    used_bed_ids,
)

router = APIRouter(prefix="/api/housing", tags=["housing"])


def _bed_payload(data: dict[str, Any], bed: dict[str, Any]) -> dict[str, Any]:
    room = room_by_id(data, bed.get("roomId")) or {}
    building = building_by_id(data, room.get("buildingId")) or {}
    occupant = resident_on_bed(data, str(bed.get("id")))
    return {
        **bed,
        "roomName": clean_str(room.get("name")),
        "buildingId": room.get("buildingId"),
        "buildingName": clean_str(building.get("name")),
        "occupied": bool(occupant),
        "residentId": (occupant or {}).get("id"),
        "residentName": (occupant or {}).get("name", ""),
        "employeeCode": (occupant or {}).get("employeeCode", ""),
    }




def _classified_buildings_tree(
    data: dict[str, Any],
    user: dict[str, Any],
) -> list[dict[str, Any]]:
    """Add canonical housing type and scope monitor building visibility."""
    items = buildings_tree(data)

    source_by_id = {
        str(building.get("id")): building
        for building in data.get("buildings", [])
        if isinstance(building, dict)
    }

    from app.services.housing import normalize_housing_type

    for item in items:
        original = source_by_id.get(str(item.get("id")), {})
        raw_type = original.get("housingType", item.get("housingType"))
        item["housingType"] = normalize_housing_type(raw_type) or "internal"

    role_id = str(user.get("roleId") or "")
    if not role_id:
        role_id = "r_housing" if user.get("role") == "housingSupervisor" else ""

    if role_id == "r_housing":
        assigned_type = normalize_housing_type(user.get("housingType"))
        if assigned_type not in {"internal", "external"}:
            return []

        return [
            item for item in items
            if item.get("housingType") == assigned_type
        ]

    return items


@router.get("/tree")
def tree(user: dict[str, Any] = Depends(require_any_permission("housing.view", "guests.manage"))):
    data = scoped_data(store.read(), user)
    items = _classified_buildings_tree(data, user)
    if is_housing_monitor(user, data.get("roles")):
        items = monitor_guest_tree(data, items)
    return {"buildings": items, "generatedAt": now_iso()}


@router.get("/buildings")
def list_buildings(user: dict[str, Any] = Depends(require_permission("housing.view"))):
    data = scoped_data(store.read(), user)
    items = _classified_buildings_tree(data, user)
    return {"items": items, "total": len(items)}


@router.post("/buildings", status_code=201)
def add_building(payload: dict[str, Any], user: dict[str, Any] = Depends(require_permission("housing.manage"))):
    with store.atomic() as data:
        building = create_building(data, payload, user)
        return building


@router.put("/buildings/{building_id}")
@router.patch("/buildings/{building_id}")
def edit_building(
    building_id: str,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(require_permission("housing.manage")),
):
    with store.atomic() as data:
        building = building_by_id(data, building_id)
        if not building:
            raise HTTPException(status_code=404, detail="المبنى غير موجود")
        return update_building(data, building, payload, user)


@router.delete("/buildings/{building_id}")
def remove_building(building_id: str, user: dict[str, Any] = Depends(require_permission("housing.manage"))):
    with store.atomic() as data:
        building = building_by_id(data, building_id)
        if not building:
            raise HTTPException(status_code=404, detail="المبنى غير موجود")
        name = building.get("name")
        delete_building(data, building, user)
        return {"ok": True, "message": f"تم حذف المبنى {name}"}


@router.post("/buildings/{building_id}/rooms", status_code=201)
def add_room(
    building_id: str,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(require_permission("housing.manage")),
):
    with store.atomic() as data:
        building = building_by_id(data, building_id)
        if not building:
            raise HTTPException(status_code=404, detail="المبنى غير موجود")
        return create_room(data, building, payload, user)


@router.get("/rooms")
def list_rooms(
    buildingId: str = "",
    user: dict[str, Any] = Depends(require_permission("housing.view")),
):
    data = scoped_data(store.read(), user)
    used = used_bed_ids(data)
    rooms: list[dict[str, Any]] = []
    for room in data.get("rooms", []):
        if buildingId and str(room.get("buildingId")) != str(buildingId):
            continue
        beds = [b for b in data.get("beds", []) if str(b.get("roomId")) == str(room.get("id"))]
        building = building_by_id(data, room.get("buildingId")) or {}
        rooms.append({
            **room,
            "buildingName": clean_str(building.get("name")),
            "bedCount": len(beds),
            "occupiedCount": len([b for b in beds if str(b.get("id")) in used]),
            "freeCount": len([b for b in beds if str(b.get("id")) not in used]),
        })
    return {"items": rooms, "total": len(rooms)}


@router.put("/rooms/{room_id}")
@router.patch("/rooms/{room_id}")
def edit_room(
    room_id: str,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(require_permission("housing.manage")),
):
    with store.atomic() as data:
        room = room_by_id(data, room_id)
        if not room:
            raise HTTPException(status_code=404, detail="الغرفة غير موجودة")
        return update_room(data, room, payload, user)


@router.delete("/rooms/{room_id}")
def remove_room(room_id: str, user: dict[str, Any] = Depends(require_permission("housing.manage"))):
    with store.atomic() as data:
        room = room_by_id(data, room_id)
        if not room:
            raise HTTPException(status_code=404, detail="الغرفة غير موجودة")
        delete_room(data, room, user)
        return {"ok": True, "message": "تم حذف الغرفة"}


@router.post("/rooms/{room_id}/beds", status_code=201)
def add_beds(
    room_id: str,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(require_permission("housing.manage")),
):
    with store.atomic() as data:
        room = room_by_id(data, room_id)
        if not room:
            raise HTTPException(status_code=404, detail="الغرفة غير موجودة")
        beds = create_beds(data, room, payload, user)
        return {"items": [_bed_payload(data, b) for b in beds], "created": len(beds)}


@router.get("/beds")
def list_beds(
    buildingId: str = "",
    roomId: str = "",
    freeOnly: bool = False,
    q: str = "",
    page: int = 1,
    pageSize: int = 100,
    user: dict[str, Any] = Depends(require_permission("housing.view")),
):
    data = scoped_data(store.read(), user)
    used = used_bed_ids(data)
    rows: list[dict[str, Any]] = []
    needle = clean_str(q).lower()
    for bed in data.get("beds", []):
        room = room_by_id(data, bed.get("roomId")) or {}
        if buildingId and str(room.get("buildingId")) != str(buildingId):
            continue
        if roomId and str(bed.get("roomId")) != str(roomId):
            continue
        if freeOnly and str(bed.get("id")) in used:
            continue
        item = _bed_payload(data, bed)
        if needle and needle not in " ".join(
            clean_str(item.get(k)).lower() for k in ("label", "roomName", "buildingName", "residentName", "employeeCode")
        ):
            continue
        rows.append(item)
    return paged(rows, page, pageSize)


@router.put("/beds/{bed_id}")
@router.patch("/beds/{bed_id}")
def edit_bed(
    bed_id: str,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(require_permission("housing.manage")),
):
    with store.atomic() as data:
        bed = bed_by_id(data, bed_id)
        if not bed:
            raise HTTPException(status_code=404, detail="السرير غير موجود")
        update_bed(data, bed, payload, user)
        return _bed_payload(data, bed)


@router.delete("/beds/{bed_id}")
def remove_bed(bed_id: str, user: dict[str, Any] = Depends(require_permission("housing.manage"))):
    with store.atomic() as data:
        bed = bed_by_id(data, bed_id)
        if not bed:
            raise HTTPException(status_code=404, detail="السرير غير موجود")
        delete_bed(data, bed, user)
        return {"ok": True, "message": "تم حذف السرير"}


def _rotation_payload(data: dict[str, Any], rotation: dict[str, Any]) -> dict[str, Any]:
    from app.services.housing import resident_by_id

    bed = bed_by_id(data, rotation.get("bedId")) or {}
    room = room_by_id(data, bed.get("roomId")) or {}
    building = building_by_id(data, room.get("buildingId")) or {}
    outgoing = resident_by_id(data, rotation.get("outgoingResidentId")) or {}
    incoming = resident_by_id(data, rotation.get("incomingResidentId")) or {}
    return {
        **rotation,
        "bedLabel": clean_str(bed.get("label")),
        "roomName": clean_str(room.get("name")),
        "buildingName": clean_str(building.get("name")),
        "outgoingName": clean_str(outgoing.get("name")),
        "incomingName": clean_str(incoming.get("name")),
    }


@router.get("/rotations")
def list_rotations(
    status: str = "",
    user: dict[str, Any] = Depends(require_permission("housing.view")),
):
    data = scoped_data(store.read(), user)
    rows = data.get("rotations", [])
    if status:
        rows = [r for r in rows if clean_str(r.get("status")) == status]
    return {"items": [_rotation_payload(data, r) for r in rows], "total": len(rows)}


@router.post("/rotations", status_code=201)
def add_rotation(payload: dict[str, Any], user: dict[str, Any] = Depends(require_permission("housing.manage"))):
    with store.atomic() as data:
        rotation = schedule_rotation(data, payload, user)
        return _rotation_payload(data, rotation)


@router.post("/rotations/{rotation_id}/execute")
def run_rotation(rotation_id: str, user: dict[str, Any] = Depends(require_permission("housing.manage"))):
    with store.atomic() as data:
        rotation = next((r for r in data.get("rotations", []) if str(r.get("id")) == str(rotation_id)), None)
        if not rotation:
            raise HTTPException(status_code=404, detail="التناوب غير موجود")
        execute_rotation(data, rotation, user)
        return _rotation_payload(data, rotation)


@router.post("/rotations/{rotation_id}/cancel")
def stop_rotation(rotation_id: str, user: dict[str, Any] = Depends(require_permission("housing.manage"))):
    with store.atomic() as data:
        rotation = next((r for r in data.get("rotations", []) if str(r.get("id")) == str(rotation_id)), None)
        if not rotation:
            raise HTTPException(status_code=404, detail="التناوب غير موجود")
        cancel_rotation(data, rotation, user)
        return _rotation_payload(data, rotation)
