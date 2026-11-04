(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,24914,t=>{"use strict";var e=t.i(91392);let a=[{key:"department",label:"اعتماد الإدارة",field:"departmentApprover",at:"departmentApprovedAt"},{key:"security",label:"الاعتماد الأمني",field:"securityApprover",at:"securityApprovedAt"},{key:"visitor",label:"اعتماد الزوار",field:"visitorApprover",at:"visitorApprovedAt"},{key:"housing",label:"اعتماد السكن",field:"housingApprover",at:"housingApprovedAt"}];function o(t){return String(t??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}t.s(["printGuestOfficialForm",0,function(t){let a=t.formNo||"غير مُصدَر",r=t.housing?[["المبنى",t.housing.buildingName||"—"],["الغرفة",t.housing.roomName||"—"],["السرير",t.housing.bedLabel||"—"],["نوع السكن","external"===t.housing.housingType?"خارجي":"داخلي"]]:[],i=[["اسم الزائر",t.name],["رقم البطاقة",t.cardNumber||"—"],["تاريخ الميلاد",t.birthDate?(0,e.formatDate)(t.birthDate):"—"],["مكان الميلاد",t.birthPlace||"—"],["من جهة",t.fromPlace||"—"],["الإدارة",t.department||"—"],["جهة الاعتماد",t.approvalBy||"—"],["غرض الزيارة",t.visitPurpose||"—"],["بداية الإقامة",t.startDate?(0,e.formatDate)(t.startDate):"—"],["عدد الأيام",null!=t.days?String(t.days):"—"],["نهاية الإقامة",t.endDate?(0,e.formatDate)(t.endDate):"—"],["الحالة",t.statusLabel||String(t.status??"")]],d=(t.extensions||[]).map(t=>`<li>تمديد ${o(String(t.days))} يوم — ${o(t.approvalBy||"النظام")}${!1===t.sameHousing&&t.newBedLabel?` → سرير جديد: ${o(t.newBedLabel)}`:""} \xb7 ${o(t.at?(0,e.formatDateTime)(t.at):"—")}${t.reason?` (${o(t.reason)})`:""}</li>`).join(""),n="ended"===t.status?`<tr><td>إنهاء الإقامة</td><td>${o(t.endDate?(0,e.formatDate)(t.endDate):"—")}${t.endedBy?` \xb7 بواسطة ${o(t.endedBy)}`:""}${t.endReason?` \xb7 السبب: ${o(t.endReason)}`:""}</td></tr>`:"",s=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${o(a)}</title><style>
  body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;margin:28px;color:#17202b}
  .sheet{max-width:820px;margin:0 auto;border:1px solid #b9c6d6;border-radius:10px;padding:26px 30px}
  .head{display:flex;justify-content:space-between;border-bottom:2px solid #7c4dbe;padding-bottom:10px}
  .head h1{font-size:19px;margin:0 0 4px;color:#3a2566}
  .head small{color:#5c6b7c}
  .form-no{font-size:15px;font-weight:800;color:#7c4dbe;white-space:nowrap}
  h2{font-size:14px;color:#3a2566;border-inline-start:4px solid #7c4dbe;padding-inline-start:8px;margin:20px 0 8px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  .data td{border:1px solid #ddd4ec;padding:7px 10px}
  .data td:first-child{background:#f7f4fc;width:32%;font-weight:700;color:#4a3573}
  .muted{color:#8794a5}
  ul{margin:6px 0;padding-inline-start:20px;font-size:12.5px}
  .sign{display:flex;justify-content:space-between;margin-top:34px;font-size:12.5px;color:#33475e}
  .sign b{display:block;margin-top:32px;border-top:1px solid #95a3b4;padding-top:4px;text-align:center}
  footer{margin-top:18px;font-size:11px;color:#8794a5;text-align:center}
  @media print{body{margin:10mm}}
</style></head><body><div class="sheet">
  <div class="head">
    <div>
      <h1>نظام إدارة السكن — نموذج تسكين زائر</h1>
      <small>الإدارة: ${o(t.department||"—")} \xb7 جهة الاعتماد: ${o(t.approvalBy||"—")}</small>
    </div>
    <div class="form-no">${o(a)}</div>
  </div>

  <h2>أولاً: بيانات الزائر</h2>
  <table class="data">
    ${i.map(([t,e])=>`<tr><td>${o(t)}</td><td>${o(e)}</td></tr>`).join("")}
  </table>

  ${r.length?`<h2>ثانياً: التسكين</h2><table class="data">${r.map(([t,e])=>`<tr><td>${o(t)}</td><td>${o(e)}</td></tr>`).join("")}</table>`:'<p class="muted">لم يتم تسكين الزائر بعد.</p>'}

  ${d?`<h2>التمديدات</h2><ul>${d}</ul>`:""}
  ${n?`<table class="data" style="margin-top:10px">${n}</table>`:""}

  <div class="sign">
    <span>توقيع مراقب الزوار<b></b></span>
    <span>توقيع أمين السكن<b></b></span>
    <span>توقيع الزائر<b></b></span>
  </div>
  <footer>نظام إدارة السكن \xb7 نموذج مؤرشف للطباعة الورقية أو حفظه PDF (طباعة → حفظ كـ PDF)</footer>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},150);}</script>
</body></html>`,l=window.open("","_blank","width=900,height=700");if(!l){let t=new Blob([s],{type:"text/html;charset=utf-8"}),e=URL.createObjectURL(t),o=document.createElement("a");o.href=e,o.download=`guest-form-${a}.html`,o.click(),URL.revokeObjectURL(e);return}l.document.open(),l.document.write(s),l.document.close()},"printOfficialRequestForm",0,function(t){let r="new_worker"===t.requestType,i=String(t.employeeCode||"").trim(),d=String(t.housingCode||"").trim(),n=i&&d?i===d?"الأكواد مطابقة":"الأكواد مختلفة":i?"كود مراقب السكن لم يُدخل":"",s=t.formNo||"غير مُصدَر (يُثبَّت عند الاكتمال)",l=(0,e.formatDateTime)(t.createdAt),p=[["اسم العامل",t.workerName],["نوع الطلب",r?"تسكين عامل إضافي":"استبعاد عامل"],["رقم البطاقة",t.workerCardNumber||"—"],["الرقم الوظيفي",t.employeeCode||"—"],["المسمى الوظيفي",t.jobTitle||"—"],["تاريخ الميلاد",t.workerBirthDate?(0,e.formatDate)(t.workerBirthDate):"—"],["مكان الميلاد",t.workerBirthPlace||"—"]];r?(p.push(["المتعهد/المقاول",t.contractorName]),p.push(["إدارة المتعهد",t.contractor?.department||"—"]),p.push(["السكن المخصّص",t.bedLabel?`${t.bedLabel}${t.roomName?` — غرفة ${t.roomName}`:""}`:"—"]),p.push(["كود مراقب الزوار",i||"—"]),p.push(["كود مراقب السكن",d||"—"]),n&&p.push(["حالة الأكواد",n])):(p.push(["المتعهد/المقاول",t.contractorName]),p.push(["سبب الاستبعاد",t.reason||t.reviewNotes||"—"]));let c=(t.history||[]).map((t,a)=>`<li><b>${o(t.by||"النظام")}</b> — ${o("approved"===t.action?"اعتماد":"rejected"===t.action?"رفض":"إرسال")} مرحلة ${o(t.stage)}${t.notes?` (${o(t.notes)})`:""} \xb7 ${o((0,e.formatDateTime)(t.at))}</li>`).join(""),h=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${o(s)}</title><style>
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
      <h1>نظام إدارة السكن — نموذج ${r?"تسكين عامل":"استبعاد عامل"}</h1>
      <small>تاريخ الإنشاء: ${o(l)} \xb7 المتعهد: ${o(t.contractorName)}${t.contractor?.department?` — ${o(t.contractor.department)}`:""}</small>
    </div>
    <div class="form-no">${o(s)}</div>
  </div>

  <h2>أولاً: بيانات العامل</h2>
  <table class="data">
    ${p.map(([t,e])=>`<tr><td>${o(t)}</td><td>${o(e)}</td></tr>`).join("")}
  </table>

  <h2>ثانياً: مسار الاعتمادات</h2>
  <table class="stages">
    <thead><tr><th>المرحلة</th><th>الاعتماد باسم</th><th>التاريخ والوقت</th><th>ملاحظات</th></tr></thead>
    <tbody>
      ${a.filter(t=>r||"housing"!==t.key).map(a=>{let r=String(t[a.field]||"")||"—",i=(0,e.formatDateTime)(function(t,e,a="approved"){let o=(t||[]).find(t=>t.stage===e&&t.action===a);return o?.at||""}(t.history,a.key))||String(t[a.at]||"")||"—",d=(t.history||[]).find(t=>t.stage===a.key&&"approved"===t.action)?.notes||"",n=void 0!==t.doneNotified?"✓":"";return`<tr><td>${o(a.label)}</td><td>${"—"===o(r)?'<span class="muted">لم يكتمل بعد</span>':o(r)+n}</td><td>${o(i)}</td><td>${o(d)}</td></tr>`}).join("")}
      <tr><td>الحالة النهائية</td><td colspan="3"><b>${o("done"===t.stage?"مكتمل":"rejected"===t.stage?"مرفوض":`قيد ${o(t.stageLabel||t.stage)}`)}</b>${t.reviewedAt&&"done"===t.stage?` \xb7 آخر مراجعة: ${o((0,e.formatDateTime)(t.reviewedAt))}`:""}</td></tr>
    </tbody>
  </table>

  ${Array.isArray(t.previousExclusions)&&t.previousExclusions.length>0?`<h2>ثالثاً: سجل الاستبعاد السابق</h2><ul>${t.previousExclusions.map(t=>`<li>${o(t.contractor||"متعهد")} \xb7 ${o(t.at?(0,e.formatDate)(t.at):"تاريخ غير محدد")} \xb7 السبب: ${o(t.reason)}</li>`).join("")}</ul>`:""}

  ${(t.history||[]).length?`<h2>سجل الحركة</h2><ul>${c}</ul>`:""}

  <div class="sign">
    <span>توقيع المتعهد/المقاول<b></b></span>
    <span>توقيع مدير الإدارة<b></b></span>
    <span>توقيع مشرف السكن<b></b></span>
  </div>
  <footer>نظام إدارة السكن \xb7 نموذج مؤرشف للطباعة الورقية أو حفظه PDF (طباعة → حفظ كـ PDF)</footer>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},150);}</script>
</body></html>`,m=window.open("","_blank","width=900,height=700");if(!m){let e=new Blob([h],{type:"text/html;charset=utf-8"}),a=URL.createObjectURL(e),o=document.createElement("a");o.href=a,o.download=`form-${s||t.id}.html`,o.click(),URL.revokeObjectURL(a);return}m.document.open(),m.document.write(h),m.document.close()}])},95468,t=>{"use strict";let e=(0,t.i(75254).default)("circle-check",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]]);t.s(["CheckCircle2",0,e],95468)},75787,t=>{"use strict";let e=(0,t.i(75254).default)("door-open",[["path",{d:"M11 20H2",key:"nlcfvz"}],["path",{d:"M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z",key:"au4z13"}],["path",{d:"M11 4H8a2 2 0 0 0-2 2v14",key:"74r1mk"}],["path",{d:"M14 12h.01",key:"1jfl7z"}],["path",{d:"M22 20h-3",key:"vhrsz"}]]);t.s(["DoorOpen",0,e],75787)},29573,t=>{"use strict";let e=(0,t.i(75254).default)("file-plus-2",[["path",{d:"M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4",key:"1pf5j1"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M3 15h6",key:"4e2qda"}],["path",{d:"M6 12v6",key:"1u72j0"}]]);t.s(["FilePlus2",0,e],29573)},94351,t=>{"use strict";let e=(0,t.i(75254).default)("house",[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",key:"5wwlr5"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"r6nss1"}]]);t.s(["Home",0,e],94351)},7233,t=>{"use strict";let e=(0,t.i(75254).default)("plus",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]);t.s(["Plus",0,e],7233)},3281,t=>{"use strict";let e=(0,t.i(75254).default)("printer",[["path",{d:"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2",key:"143wyd"}],["path",{d:"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6",key:"1itne7"}],["rect",{x:"6",y:"14",width:"12",height:"8",rx:"1",key:"1ue0tg"}]]);t.s(["Printer",0,e],3281)},27612,t=>{"use strict";let e=(0,t.i(75254).default)("trash-2",[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]]);t.s(["Trash2",0,e],27612)}]);