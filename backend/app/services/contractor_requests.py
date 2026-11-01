from __future__ import annotations

from typing import Any

from app.services.common import (
    ServiceError,
    add_audit,
    add_notification,
    age_on,
    clean_str,
    new_id,
    normalize_card,
    now_iso,
    parse_date,
)
from app.services.housing import (
    assign_bed,
    contractor_by_id,
    contractor_free,
    contractor_payload,
    free_beds_for_contractor,
    resident_by_id,
    residents_for_contractor,
    room_by_id,
)


STAGE_LABELS = {
    "department": "مدير الإدارة",
    "security": "مشرف الأمن",
    "visitor": "مراقب الزوار",
    "housing": "مراقب السكن",
    "done": "مكتمل",
    "rejected": "مرفوض",
}

STAGE_PERMISSION = {
    "department": "requests.department",
    "security": "requests.security",
    "visitor": "requests.visitor",
    "housing": "requests.supervise",
}


def _int_setting(name: str, default: int) -> int:
    try:
        from app.core.config import settings

        return int(getattr(settings, name, default) or default)
    except Exception:
        return default


def min_worker_age() -> int:
    return max(1, _int_setting("minWorkerAge", 18))


def max_worker_age() -> int:
    return _int_setting("maxWorkerAge", 60)


def previous_exclusions_for(data: dict[str, Any], card: Any) -> list[dict[str, Any]]:
    """استبعادات سابقة لنفس رقم البطاقة — تُعرض لمراحل الاعتماد قبل التسكين."""
    card_normalized = normalize_card(card)
    if not card_normalized:
        return []
    exclusions: list[dict[str, Any]] = []
    for old in sorted(
        (r for r in data.get("contractorRequests", []) if r.get("requestType") == "remove_worker"),
        key=lambda r: clean_str(r.get("createdAt")),
        reverse=True,
    ):
        old_card = normalize_card(old.get("workerCardNumber"))
        if not old_card or old_card != card_normalized:
            continue
        contractor_name = clean_str(old.get("contractorName"))
        exclusions.append({
            "at": clean_str(old.get("reviewedAt")) or clean_str(old.get("createdAt")) or "",
            "contractorId": old.get("contractorId"),
            "contractorName": contractor_name,
            "contractor": contractor_name,
            "reason": clean_str(old.get("reason")) or clean_str(old.get("reviewNotes")),
            "notes": clean_str(old.get("reviewNotes")),
        })
    return exclusions


def request_payload(data: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    item = dict(request)
    contractor = contractor_by_id(data, request.get("contractorId"))
    item["contractor"] = {
        "id": (contractor or {}).get("id"),
        "name": (contractor or {}).get("name"),
        "department": clean_str((contractor or {}).get("department")),
    }
    item["stageLabel"] = STAGE_LABELS.get(str(request.get("stage")), str(request.get("stage")))
    item["isAdd"] = request.get("requestType") == "new_worker"
    item["isPending"] = request.get("stage") not in {"done", "rejected"}
    item["typeLabel"] = "إضافة عامل" if item["isAdd"] else "استبعاد عامل"
    item["workerAge"] = age_on(request.get("workerBirthDate"))
    bed = None
    if request.get("bedId"):
        from app.services.housing import bed_by_id

        bed = bed_by_id(data, request.get("bedId"))
    item["bedLabel"] = clean_str((bed or {}).get("label"))
    room = room_by_id(data, (bed or {}).get("roomId"))
    item["roomName"] = clean_str((room or {}).get("name"))
    return item


def _notify_contractor_users(data: dict[str, Any], contractor_id: Any, title: str, body: str, actor: dict[str, Any] | None) -> None:
    user_ids = [
        str(u.get("id")) for u in data.get("users", [])
        if str(u.get("contractorId")) == str(contractor_id)
    ]
    if user_ids:
        add_notification(
            data,
            title=title,
            body=body,
            kind="request",
            user_ids=user_ids,
            link="/contractor",
            actor=actor,
        )


def _notify_stage(
    data: dict[str, Any],
    stage: str,
    title: str,
    body: str,
    actor: dict[str, Any] | None,
    contractor_id: Any = None,
) -> None:
    if stage == "housing" and contractor_id:
        contractor = contractor_by_id(data, contractor_id)
        building_ids = {str(v) for v in ((contractor or {}).get("buildingIds") or [])}
        kinds = set()
        for building in data.get("buildings", []):
            if str(building.get("id")) in building_ids:
                raw = str(building.get("housingType") or "internal").strip().casefold()
                kinds.add("external" if raw in {"external", "outside", "خارجي", "خارج", "سكن خارجي"} else "internal")
        if len(kinds) == 1:
            kind = next(iter(kinds))
            add_notification(
                data, title=title, body=body, kind="request",
                permission=("requests.housing_external" if kind == "external" else "requests.housing_internal"),
                link="/requests", actor=actor,
            )
        return
    permission = STAGE_PERMISSION.get(stage)
    if permission:
        add_notification(
            data, title=title, body=body, kind="request", permission=permission,
            link="/requests", actor=actor,
        )


def _find_worker(data: dict[str, Any], request: dict[str, Any]) -> list[dict[str, Any]]:
    contractor_id = request.get("contractorId")
    workers = residents_for_contractor(data, contractor_id)
    card = normalize_card(request.get("workerCardNumber"))
    code = clean_str(request.get("employeeCode"))
    name = clean_str(request.get("workerName"))
    matched = [
        w for w in workers
        if (card and normalize_card(w.get("cardNumber")) == card)
        or (code and clean_str(w.get("employeeCode")) == code)
        or (name and clean_str(w.get("name")) == name)
    ]
    return matched


def create_request(
    data: dict[str, Any],
    payload: dict[str, Any],
    actor: dict[str, Any] | None = None,
    *,
    forced_contractor_id: Any = None,
) -> dict[str, Any]:
    contractor_id = forced_contractor_id or payload.get("contractorId")
    contractor = contractor_by_id(data, contractor_id)
    if not contractor:
        raise ServiceError("المتعهد/المقاول غير موجود", 404)
    request_type = clean_str(payload.get("requestType")) or "new_worker"
    if request_type not in {"new_worker", "remove_worker"}:
        raise ServiceError("نوع الطلب غير معروف")
    worker_name = clean_str(payload.get("workerName"))
    if not worker_name:
        raise ServiceError("يرجى إدخال اسم العامل")
    card = normalize_card(payload.get("workerCardNumber"))
    employee_code = clean_str(payload.get("employeeCode"))
    job_title = clean_str(payload.get("jobTitle"))
    birth_date = payload.get("workerBirthDate")
    birth_place = clean_str(payload.get("workerBirthPlace"))
    reason = clean_str(payload.get("reason"))
    target_resident_id: str | None = None

    if request_type == "new_worker":
        if not card:
            raise ServiceError("يرجى إدخال رقم البطاقة")
        if not parse_date(birth_date):
            raise ServiceError("يرجى تحديد تاريخ الميلاد")
        if not birth_place:
            raise ServiceError("يرجى إدخال مكان الميلاد")
        age = age_on(birth_date)
        if age is not None and age < min_worker_age():
            raise ServiceError(f"لا يسمح بإضافة موظف أقل من {min_worker_age()} عاماً", 409)
        if max_worker_age() and age is not None and age > max_worker_age():
            raise ServiceError(f"لا يسمح بإضافة موظف أكبر من {max_worker_age()} عاماً", 409)
        for resident in data.get("residents", []):
            if normalize_card(resident.get("cardNumber")) == card:
                raise ServiceError("يوجد مقيم مسجّل بنفس رقم البطاقة مسبقاً", 409)
        for existing in data.get("contractorRequests", []):
            if (
                existing.get("requestType") == "new_worker"
                and existing.get("stage") not in {"done", "rejected"}
                and normalize_card(existing.get("workerCardNumber")) == card
            ):
                raise ServiceError("يوجد طلب إضافة قيد الاعتماد لنفس رقم البطاقة مسبقاً", 409)
        if contractor_free(data, contractor_id) <= 0:
            raise ServiceError(f"لا يوجد سرير متاح لدى المتعهد ({contractor.get('name')})", 409)
        stage = "department"
    else:
        matched = _find_worker(data, {
            "contractorId": contractor_id,
            "workerCardNumber": card,
            "employeeCode": employee_code,
            "workerName": worker_name,
        })
        if not matched:
            raise ServiceError("العامل غير موجود ضمن عمالة المتعهد", 404)
        target_resident_id = clean_str(matched[0].get("id"))
        for existing in data.get("contractorRequests", []):
            if (
                existing.get("contractorId") == contractor_id
                and existing.get("requestType") == "remove_worker"
                and existing.get("stage") not in {"done", "rejected"}
                and (
                    normalize_card(existing.get("workerCardNumber")) == card
                    or clean_str(existing.get("workerName")) == worker_name
                )
            ):
                raise ServiceError("يوجد طلب استبعاد قيد الاعتماد لهذا العامل مسبقاً", 409)
        stage = "department"

    item = {
        "id": new_id("CR-"),
        "contractorId": contractor.get("id"),
        "contractorName": clean_str(contractor.get("name")),
        "requestType": request_type,
        "workerName": worker_name,
        "employeeCode": employee_code,
        "jobTitle": job_title,
        "workerCardNumber": clean_str(payload.get("workerCardNumber")),
        "workerBirthDate": birth_date or None,
        "workerBirthPlace": birth_place,
        "buildingId": None,
        "bedId": None,
        # يُثبّت على سجل المقيم المستهدف عند إنشاء طلب الاستبعاد.
        "targetResidentId": target_resident_id,
        # استبعادات سابقة لنفس العامل تظهر لمراحل الاعتماد (طلب إضافة فقط).
        "previousExclusions": previous_exclusions_for(data, card) if request_type == "new_worker" else [],
        "reason": reason,
        "stage": stage,
        "createdAt": now_iso(),
        "departmentApprover": "",
        "housingApprover": "",
        "securityApprover": "",
        "visitorApprover": "",
        "reviewedAt": None,
        "reviewNotes": "",
        "submittedBy": clean_str((actor or {}).get("username")) or clean_str((actor or {}).get("name")),
        "history": [
            {
                "at": now_iso(),
                "action": "submitted",
                "stage": stage,
                "by": clean_str((actor or {}).get("name")),
                "notes": "",
            }
        ],
    }
    data.setdefault("contractorRequests", []).insert(0, item)
    add_audit(
        data, actor, "contractor_request_created", "contractor_request", item["id"],
        {"type": request_type, "worker": worker_name, "contractor": item["contractorName"]},
    )
    _notify_stage(
        data, stage,
        "طلب متعهد جديد" if request_type == "new_worker" else "طلب استبعاد عامل",
        f"{item['contractorName']} — {worker_name}",
        actor,
    )
    _notify_contractor_users(
        data, contractor.get("id"), "تم إرسال طلبك",
        f"{'إضافة' if request_type == 'new_worker' else 'استبعاد'} العامل {worker_name} — بانتظار {STAGE_LABELS.get(stage)}",
        actor,
    )
    return item


def _execute_add(
    data: dict[str, Any],
    request: dict[str, Any],
    actor: dict[str, Any] | None,
    bed_id: str = "",
) -> None:
    contractor = contractor_by_id(data, request.get("contractorId"))
    if not contractor:
        raise ServiceError("المتعهد/المقاول غير موجود", 404)
    if contractor_free(data, contractor.get("id")) <= 0:
        raise ServiceError("لا يوجد فراغ في السكن التابع للمتعهد", 409)
    free = free_beds_for_contractor(data, contractor.get("id"))
    if not free:
        raise ServiceError("لا يوجد سرير فعلي متاح في مباني المتعهد", 409)
    if bed_id:
        picked = [b for b in free if str(b.get("id")) == str(bed_id)]
        if not picked:
            raise ServiceError("السرير المحدد غير متاح لدى هذا المتعهد", 409)
        bed = picked[0]
    else:
        bed = free[0]
    room = room_by_id(data, bed.get("roomId"))
    if not room:
        raise ServiceError("الغرفة المرتبطة بالسرير غير موجودة", 409)
    employee_code = clean_str(request.get("employeeCode"))
    if not employee_code:
        raise ServiceError("يرجى إدخال كود الموظف قبل الاعتماد النهائي")
    resident = {
        "id": new_id("u"),
        "employeeCode": employee_code,
        "name": clean_str(request.get("workerName")),
        "jobTitle": clean_str(request.get("jobTitle")) or "عامل متعهد",
        "company": clean_str(request.get("contractorName")),
        "department": "متعهدون ومقاولون",
        "shift": "نهاري",
        "rotation": "",
        "serviceType": "سكن",
        "baseStatus": "متواجد",
        "manualStatus": None,
        "buildingId": room.get("buildingId"),
        "roomId": room.get("id"),
        "bedId": bed.get("id"),
        "checkInDate": now_iso(),
        "leaveUntil": None,
        "phone": "",
        "shiftTable": "",
        "dutyCycleStart": None,
        "dutyWorkDays": 0,
        "dutyRestDays": 0,
        "contractorId": contractor.get("id"),
        "gender": "",
        "transportType": "",
        "departureTime": "",
        "cardNumber": clean_str(request.get("workerCardNumber")),
        "birthDate": request.get("workerBirthDate"),
        "birthPlace": clean_str(request.get("workerBirthPlace")),
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    data.setdefault("residents", []).insert(0, resident)
    request["bedId"] = bed.get("id")
    request["buildingId"] = room.get("buildingId")
    _upsert_registered_worker(data, request, status="assigned", building_id=room.get("buildingId"), room_id=room.get("id"), bed_id=bed.get("id"))
    add_audit(
        data, actor, "contractor_worker_housed", "resident", resident["id"],
        {"worker": resident["name"], "bed": bed.get("label"), "contractor": contractor.get("name")},
    )


def _execute_remove(data: dict[str, Any], request: dict[str, Any], actor: dict[str, Any] | None) -> None:
    target_id = clean_str(request.get("targetResidentId"))
    if target_id:
        # حذف السجل المستهدف تحديداً — لا نطابق بالاسم/الكود حتى لا يُحذف عامل جديد
        # أُضيف بنفس الكود بعد إنشاء الطلب.
        matched = [r for r in data.get("residents", []) if str(r.get("id")) == target_id]
        if not matched:
            raise ServiceError("السجل المستهدف للاستبعاد غير موجود", 404)
    else:
        # طلبات قديمة لا تحمل معرّفاً: تُطابق بالاسم/الكود وتُحذف أول سجل واحد فقط.
        matched = _find_worker(data, request)[:1]
        if not matched:
            raise ServiceError("العامل غير موجود ضمن عمالة المتعهد", 404)
    ids = {str(w.get("id")) for w in matched}
    data["residents"] = [r for r in data.get("residents", []) if str(r.get("id")) not in ids]
    for worker in data.get("contractorWorkers", []):
        if str(worker.get("contractorId")) != str(request.get("contractorId")):
            continue
        if (
            (request.get("workerCardNumber") and normalize_card(worker.get("cardNumber")) == normalize_card(request.get("workerCardNumber")))
            or clean_str(worker.get("fullName")) == clean_str(request.get("workerName"))
            or (request.get("employeeCode") and clean_str(worker.get("employeeCode")) == clean_str(request.get("employeeCode")))
        ):
            worker["status"] = "removed"
            worker["gateStatus"] = "removed"
            worker["buildingId"] = None
            worker["roomId"] = None
            worker["bedId"] = None
            worker["updatedAt"] = now_iso()
    add_audit(
        data, actor, "contractor_worker_removed", "contractor_request", request.get("id"),
        {"worker": request.get("workerName"), "count": len(matched)},
    )


def _upsert_registered_worker(
    data: dict[str, Any],
    request: dict[str, Any],
    *,
    status: str,
    building_id: Any = None,
    room_id: Any = None,
    bed_id: Any = None,
) -> None:
    card = normalize_card(request.get("workerCardNumber"))
    name = clean_str(request.get("workerName"))
    for worker in data.get("contractorWorkers", []):
        if str(worker.get("contractorId")) != str(request.get("contractorId")):
            continue
        if (card and normalize_card(worker.get("cardNumber")) == card) or (name and clean_str(worker.get("fullName")) == name):
            worker.update({
                "fullName": name,
                "employeeCode": clean_str(request.get("employeeCode")),
                "jobTitle": clean_str(request.get("jobTitle")),
                "status": status,
                "gateStatus": "approved",
                "awarenessStatus": worker.get("awarenessStatus") or "completed",
                "buildingId": building_id,
                "roomId": room_id,
                "bedId": bed_id,
                "cardNumber": clean_str(request.get("workerCardNumber")),
                "birthDate": request.get("workerBirthDate"),
                "birthPlace": clean_str(request.get("workerBirthPlace")),
                "updatedAt": now_iso(),
            })
            return
    data.setdefault("contractorWorkers", []).insert(0, {
        "id": new_id("cw_"),
        "contractorId": request.get("contractorId"),
        "fullName": name,
        "jobTitle": clean_str(request.get("jobTitle")),
        "employeeCode": clean_str(request.get("employeeCode")),
        "status": status,
        "gateStatus": "approved",
        "awarenessStatus": "completed",
        "buildingId": building_id,
        "roomId": room_id,
        "bedId": bed_id,
        "cardNumber": clean_str(request.get("workerCardNumber")),
        "birthDate": request.get("workerBirthDate"),
        "birthPlace": clean_str(request.get("workerBirthPlace")),
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    })


def approve_request(
    data: dict[str, Any],
    request: dict[str, Any],
    stage: str,
    actor: dict[str, Any],
    *,
    employee_code: str = "",
    notes: str = "",
    bed_id: str = "",
) -> dict[str, Any]:
    if stage not in STAGE_PERMISSION:
        raise ServiceError("مرحلة الاعتماد غير معروفة")
    if request.get("stage") != stage:
        raise ServiceError(f"الطلب ليس بانتظار {STAGE_LABELS.get(stage)}", 409)
    is_add = request.get("requestType") == "new_worker"
    actor_name = clean_str(actor.get("name")) or STAGE_LABELS.get(stage, "")

    if stage == "visitor" and is_add:
        code = clean_str(employee_code) or clean_str(request.get("employeeCode"))
        if not code:
            raise ServiceError("يرجى إدخال كود الموظف قبل الاعتماد")
        age = age_on(request.get("workerBirthDate"))
        if age is not None and age < min_worker_age():
            raise ServiceError(f"لا يسمح بإضافة موظف أقل من {min_worker_age()} عاماً", 409)
        request["employeeCode"] = code

    if stage == "housing" and is_add:
        # مشرف السكن يحدد الغرفة والسرير بنفسه من أسرّة المتعهد المتاحة.
        bed_id_clean = clean_str(bed_id) or clean_str(request.get("bedId"))
        if not bed_id_clean:
            raise ServiceError("يرجى تحديد السرير المتاح قبل الاعتماد")
        _execute_add(data, request, actor, bed_id=bed_id_clean)
    elif stage == "visitor" and not is_add:
        _execute_remove(data, request, actor)

    if stage == "department":
        request["departmentApprover"] = actor_name
        request["stage"] = "security"
    elif stage == "security":
        request["securityApprover"] = actor_name
        request["stage"] = "visitor"
    elif stage == "visitor":
        request["visitorApprover"] = actor_name
        request["stage"] = "housing" if is_add else "done"
    else:
        request["housingApprover"] = actor_name
        request["stage"] = "done"

    request["reviewedAt"] = now_iso()
    request["reviewNotes"] = clean_str(notes)
    history = request.setdefault("history", [])
    history.append({
        "at": now_iso(),
        "action": "approved",
        "stage": stage,
        "by": actor_name,
        "notes": clean_str(notes),
    })

    add_audit(
        data, actor, f"contractor_request_approved_{stage}", "contractor_request", request.get("id"),
        {"worker": request.get("workerName"), "nextStage": request.get("stage")},
    )
    title = "تم اعتماد مرحلة من طلبك" if request.get("stage") != "done" else "تم اعتماد طلبك"
    _notify_contractor_users(
        data, request.get("contractorId"), title,
        f"{request.get('workerName')} — المرحلة الحالية: {STAGE_LABELS.get(str(request.get('stage')), '-')}",
        actor,
    )
    if request.get("stage") not in {"done", "rejected"}:
        _notify_stage(
            data, str(request.get("stage")), "طلب بانتظار اعتمادك",
            f"{request.get('contractorName')} — {request.get('workerName')}",
            actor,
            contractor_id=request.get("contractorId"),
        )
    return request


def reject_request(
    data: dict[str, Any],
    request: dict[str, Any],
    actor: dict[str, Any],
    notes: str = "",
) -> dict[str, Any]:
    if request.get("stage") in {"done", "rejected"}:
        raise ServiceError("الطلب مغلق مسبقاً", 409)
    stage = str(request.get("stage"))
    default_note = {
        "department": "مرفوض من مدير الإدارة",
        "security": "مرفوض من مشرف الأمن",
        "visitor": "مرفوض من مراقب الزوار",
        "housing": "مرفوض من مراقب السكن",
    }.get(stage, "مرفوض")
    request["stage"] = "rejected"
    request["reviewedAt"] = now_iso()
    request["reviewNotes"] = clean_str(notes) or default_note
    history = request.setdefault("history", [])
    history.append({
        "at": now_iso(),
        "action": "rejected",
        "stage": stage,
        "by": clean_str(actor.get("name")),
        "notes": request["reviewNotes"],
    })
    add_audit(
        data, actor, "contractor_request_rejected", "contractor_request", request.get("id"),
        {"reason": request["reviewNotes"]},
    )
    _notify_contractor_users(
        data, request.get("contractorId"), "تم رفض طلبك",
        f"{request.get('workerName')} — {request['reviewNotes']}",
        actor,
    )
    return request


def pending_counts(data: dict[str, Any]) -> dict[str, int]:
    counts = {"department": 0, "security": 0, "visitor": 0, "housing": 0, "done": 0, "rejected": 0, "total": 0}
    for request in data.get("contractorRequests", []):
        stage = str(request.get("stage"))
        if stage in counts:
            counts[stage] += 1
        if stage not in {"done", "rejected"}:
            counts["total"] += 1
    return counts


def close_request_completed(
    data: dict[str, Any],
    request: dict[str, Any],
    actor: dict[str, Any] | None,
    *,
    reason: str = "",
    resident: dict[str, Any] | None = None,
) -> None:
    """إغلاق طلب إضافة عامل كـ«مكتمل» خارج مسار الاعتماد (تسكين مباشر من إدارة السكن)."""
    contractor = contractor_by_id(data, request.get("contractorId"))
    actor_name = clean_str((actor or {}).get("name")) or "إدارة السكن"
    if resident is not None:
        request["bedId"] = resident.get("bedId")
        request["buildingId"] = resident.get("buildingId")
        # ربط المقيم بالمتعهد إذا كان السجل بلا منسوب
        if not resident.get("contractorId"):
            resident["contractorId"] = request.get("contractorId")
        if not clean_str(resident.get("company")):
            resident["company"] = clean_str(contractor.get("name")) if contractor else ""
        resident["updatedAt"] = now_iso()
        _upsert_registered_worker(
            data,
            request,
            status="assigned",
            building_id=resident.get("buildingId"),
            room_id=resident.get("roomId"),
            bed_id=resident.get("bedId"),
        )
    request["stage"] = "done"
    request["housingApprover"] = actor_name
    request["reviewedAt"] = now_iso()
    request["reviewNotes"] = clean_str(reason) or "اكتمل سكن العامل من إدارة السكن"
    request.setdefault("history", []).append({
        "at": now_iso(),
        "action": "completed_directly",
        "stage": "housing",
        "by": actor_name,
        "notes": request["reviewNotes"],
    })
    add_audit(
        data, actor, "contractor_request_completed_directly",
        "contractor_request", request.get("id"),
        {"worker": request.get("workerName"), "reason": request["reviewNotes"]},
    )
    _notify_contractor_users(
        data, request.get("contractorId"), "اكتمل سكن العامل",
        f"{request.get('workerName')} — تم استكمال الطلب وتحديد السكن",
        actor,
    )


def sync_direct_assignment(data: dict[str, Any], resident: dict[str, Any], actor: dict[str, Any] | None) -> int:
    """عند تسكين ساكن مباشرة من صفحة السكان: إغلاق آلي لطلبات الإضافة المعلقة المطابقة.

    تُقبل المطابقة الحاسمة فقط:
    - بطاقة/رقم هوية متطابق، أو
    - الاسم متطابق حرفياً + السجل منسوب لنفس المتعهد.
    """
    card = normalize_card(resident.get("cardNumber"))
    name = clean_str(resident.get("name"))
    if not card and not name:
        return 0
    closed = 0
    for request in data.get("contractorRequests", []):
        if request.get("stage") in {"done", "rejected"} or request.get("requestType") != "new_worker":
            continue
        request_card = normalize_card(request.get("workerCardNumber"))
        request_name = clean_str(request.get("workerName"))
        card_match = bool(card) and bool(request_card) and card == request_card
        name_match = bool(name) and bool(request_name) and name == request_name
        contractor_match = str(resident.get("contractorId") or "") == str(request.get("contractorId") or "")
        if not (card_match or (name_match and contractor_match)):
            continue
        close_request_completed(
            data, request, actor,
            reason="اكتمل سكن العامل مباشرة من إدارة السكن دون انتظار اعتماد المراحل",
            resident=resident,
        )
        closed += 1
    return closed
