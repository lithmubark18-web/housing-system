import type { ContractorRequest } from "./types";
import { formatDate, formatDateTime } from "./format";

const STAGE_ORDER: Array<{ key: string; label: string; field: string; at: string }> = [
  { key: "department", label: "اعتماد الإدارة", field: "departmentApprover", at: "departmentApprovedAt" },
  { key: "security", label: "الاعتماد الأمني", field: "securityApprover", at: "securityApprovedAt" },
  { key: "visitor", label: "اعتماد الزوار", field: "visitorApprover", at: "visitorApprovedAt" },
  { key: "housing", label: "اعتماد السكن", field: "housingApprover", at: "housingApprovedAt" },
];

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function approvalEntryAt(history: ContractorRequest["history"], stage: string, action = "approved"): string {
  const entry = (history || []).find((item) => item.stage === stage && item.action === action);
  return entry?.at || "";
}

/**
 * نموذج رسمي منسق لطلب تسكين/استبعاد عامل — للطباعة والأرشفة.
 * يعرض كل بيانات الطلب مع الاعتمادات وترتيبها المرحلي.
 */
export function printOfficialRequestForm(request: ContractorRequest): void {
  const isAdd = request.requestType === "new_worker";
  const formNo = request.formNo || `غير مُصدَر (يُثبَّت عند الاكتمال)`;
  const created = formatDateTime(request.createdAt);

  const workerRows: Array<[string, string]> = [
    ["اسم العامل", request.workerName],
    ["نوع الطلب", isAdd ? "تسكين عامل إضافي" : "استبعاد عامل"],
    ["رقم البطاقة", request.workerCardNumber || "—"],
    ["كود الموظف", request.employeeCode || "—"],
    ["المسمى الوظيفي", request.jobTitle || "—"],
    ["تاريخ الميلاد", request.workerBirthDate ? formatDate(request.workerBirthDate) : "—"],
    ["مكان الميلاد", request.workerBirthPlace || "—"],
  ];

  if (isAdd) {
    workerRows.push(["المتعهد/المقاول", request.contractorName]);
    workerRows.push(["إدارة المتعهد", request.contractor?.department || "—"]);
    workerRows.push(["السكن المخصّص", request.bedLabel ? `${request.bedLabel}${request.roomName ? ` — غرفة ${request.roomName}` : ""}` : "—"]);
  } else {
    workerRows.push(["المتعهد/المقاول", request.contractorName]);
    workerRows.push(["سبب الاستبعاد", request.reason || request.reviewNotes || "—"]);
  }

  const stageRow = (stage: (typeof STAGE_ORDER)[number]) => {
    const approver = String((request as unknown as Record<string, string>)[stage.field] || "") || "—";
    const at = formatDateTime(approvalEntryAt(request.history, stage.key)) || String((request as unknown as Record<string, string>)[stage.at] || "") || "—";
    const note = (request.history || []).find((item) => item.stage === stage.key && item.action === "approved")?.notes || "";
    const done = (request as Record<string, unknown>)["doneNotified"] !== undefined ? "✓" : "";
    return `<tr><td>${esc(stage.label)}</td><td>${esc(approver) === "—" ? '<span class="muted">لم يكتمل بعد</span>' : esc(approver) + done}</td><td>${esc(at)}</td><td>${esc(note)}</td></tr>`;
  };

  const historyRows = (request.history || [])
    .map(
      (entry, index) =>
        `<li><b>${esc(entry.by || "النظام")}</b> — ${esc(entry.action === "approved" ? "اعتماد" : entry.action === "rejected" ? "رفض" : "إرسال")} مرحلة ${esc(entry.stage)}${entry.notes ? ` (${esc(entry.notes)})` : ""} · ${esc(formatDateTime(entry.at))}</li>`,
    )
    .join("");

  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(formNo)}</title><style>
  body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;margin:28px;color:#17202b}
  .sheet{max-width:820px;margin:0 auto;border:1px solid #b9c6d6;border-radius:10px;padding:26px 30px}
  .head{display:flex;justify-content:space-between;border-bottom:2px solid #1769e0;padding-bottom:10px}
  .head h1{font-size:19px;margin:0 0 4px;color:#0f2b52}
  .head small{color:#5c6b7c}
  .form-no{font-size:15px;font-weight:800;color:#1769e0;white-space:nowrap}
  h2{font-size:14px;color:#0f2b52;border-inline-start:4px solid #1769e0;padding-inline-start:8px;margin:20px 0 8px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  .data td{border:1px solid #d7dfe8;padding:7px 10px}
  .data td:first-child{background:#f4f7fb;width:32%;font-weight:700;color:#28425e}
  .stages th,.stages td{border:1px solid #d7dfe8;padding:7px 10px;text-align:right;font-size:12.5px}
  .stages th{background:#eef4ff;color:#28425e}
  .muted{color:#8794a5}
  ul{margin:6px 0;padding-inline-start:20px;font-size:12.5px}
  .sign{display:flex;justify-content:space-between;margin-top:34px;font-size:12.5px;color:#33475e}
  .sign b{display:block;margin-top:32px;border-top:1px solid #95a3b4;padding-top:4px;text-align:center}
  footer{margin-top:18px;font-size:11px;color:#8794a5;text-align:center}
  @media print{body{margin:10mm}.page-break{page-break-after:always}}
</style></head><body><div class="sheet">
  <div class="head">
    <div>
      <h1>نظام إدارة السكن — نموذج ${isAdd ? "تسكين عامل" : "استبعاد عامل"}</h1>
      <small>تاريخ الإنشاء: ${esc(created)} · المتعهد: ${esc(request.contractorName)}${request.contractor?.department ? ` — ${esc(request.contractor.department)}` : ""}</small>
    </div>
    <div class="form-no">${esc(formNo)}</div>
  </div>

  <h2>أولاً: بيانات العامل</h2>
  <table class="data">
    ${workerRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}
  </table>

  <h2>ثانياً: مسار الاعتمادات</h2>
  <table class="stages">
    <thead><tr><th>المرحلة</th><th>الاعتماد باسم</th><th>التاريخ والوقت</th><th>ملاحظات</th></tr></thead>
    <tbody>
      ${STAGE_ORDER.filter((s) => isAdd || s.key !== "housing").map(stageRow).join("")}
      <tr><td>الحالة النهائية</td><td colspan="3"><b>${esc(request.stage === "done" ? "مكتمل" : request.stage === "rejected" ? "مرفوض" : `قيد ${esc(request.stageLabel || request.stage)}`)}</b>${request.reviewedAt && request.stage === "done" ? ` · آخر مراجعة: ${esc(formatDateTime(request.reviewedAt))}` : ""}</td></tr>
    </tbody>
  </table>

  ${Array.isArray(request.previousExclusions) && request.previousExclusions.length > 0 ? `<h2>ثالثاً: سجل الاستبعاد السابق</h2><ul>${request.previousExclusions.map((e) => `<li>${esc(e.contractor || "متعهد")} · ${esc(e.at ? formatDate(e.at) : "تاريخ غير محدد")} · السبب: ${esc(e.reason)}</li>`).join("")}</ul>` : ""}

  ${(request.history || []).length ? `<h2>سجل الحركة</h2><ul>${historyRows}</ul>` : ""}

  <div class="sign">
    <span>توقيع المتعهد/المقاول<b></b></span>
    <span>توقيع مدير الإدارة<b></b></span>
    <span>توقيع مشرف السكن<b></b></span>
  </div>
  <footer>نظام إدارة السكن · نموذج مؤرشف للطباعة الورقية أو حفظه PDF (طباعة → حفظ كـ PDF)</footer>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},150);}</script>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) {
    // حظر النوافذ المنبثقة: احفظ نسخة أرشيف HTML وتنزيلها
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `form-${formNo || request.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
