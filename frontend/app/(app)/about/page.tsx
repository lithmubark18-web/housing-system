"use client";

import {
  AlertTriangle,
  ArrowLeftRight,
  BedDouble,
  BookOpen,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Hammer,
  Handshake,
  KeyRound,
  Layers,
  LogIn,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserRound,
  UsersRound,
  WifiOff,
  Wrench,
  Zap,
} from "lucide-react";
import { formatNumber } from "@/lib/format";
import { can, canAny, roleLabel } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import {
  Badge,
  InfoGrid,
  Loader,
  PageHead,
  SectionTitle,
  StatCard,
} from "@/components/ui";

const ROLE_PERMISSION_GROUPS: Record<string, string> = {
  dashboard: "لوحة المعلومات",
  residents: "السكان",
  housing: "السكن",
  operations: "المتابعة",
  requests: "الطلبات",
  contractors: "المتعهدون",
  reports: "التقارير",
  admin: "الإدارة",
  audit: "سجل العمليات",
};

const QUICK_START = [
  {
    icon: Building2,
    title: "1. أنشئ المباني والغرف",
    text: "من صفحة السكن أضف مبنى، ثم غرفاً، ثم أسرّة. يمكن إنشاء عدة أسرّة دفعة واحدة وتعديل تسميتها.",
  },
  {
    icon: UsersRound,
    title: "2. سجّل السكان",
    text: "أضف الموظفين يدوياً أو استوردهم من CSV. عيّن سريراً فردياً أو وزّع عدة سكان على غرفة/مبنى دفعة واحدة.",
  },
  {
    icon: ClipboardCheck,
    title: "3. تابع الحضور والدوام",
    text: "اضبط دورة الدوام (أيام عمل/راحة) وتُحسب الحالة تلقائياً: حاضر في أيام العمل وإجازة في أيام الراحة.",
  },
  {
    icon: Handshake,
    title: "4. اعتمد طلبات المتعهدين",
    text: "طلبات إضافة/استبعاد العمال تمر بمسار أمني ومرحلة الزوار (كود الموظف) ثم مرحلة السكن (كود مراقب السكن مع كود مراقب الزوار) قبل تنفيذ التسكين أو الإخلاء.",
  },
  {
    icon: ArrowLeftRight,
    title: "5. أدر التناوبات",
    text: "جدول تناوباً بين ساكن خارج وساكن جديد على نفس السرير، ثم نفّذه في التاريخ المحدد.",
  },
  {
    icon: BookOpen,
    title: "6. راقب وصدّر التقارير",
    text: "تقارير الحضور والإشغال والمتعهدين والطلبات والدوام قابلة للتصدير Excel/CSV وطباعة PDF.",
  },
];

const ADD_WORKFLOW = [
  { title: "الأمن", text: "مراجعة الطلب والبيانات الأساسية للعامل", permission: "requests.security" },
  { title: "الزوار", text: "التحقق من الرقم الوظيفي والهوية وإدخال كود الموظف", permission: "requests.visitor" },
  { title: "السكن", text: "مراقب السكن المختص (داخلي/خارجي) يخصص سريراً ويدخل كود مراقب السكن — تكتب الملاحظة تلقائياً: الأكواد مطابقة أو مختلفة", permission: "requests.housing_internal / requests.housing_external" },
  { title: "مكتمل", text: "إشعار المتعهد وإضافة العامل للسكن مع إصدار النموذج الرسمي", permission: "" },
];

const REMOVE_WORKFLOW = [
  { title: "السكن", text: "مراقب السكن المختص (داخلي/خارجي) يحدد السرير ويدخل كود مراقب السكن ثم ينفذ الإخلاء", permission: "requests.housing_internal / requests.housing_external" },
  { title: "الأمن", text: "مراجعة المخالصة والمغادرة", permission: "requests.security" },
  { title: "الزوار", text: "إغلاق الملف وإلغاء التصريح", permission: "requests.visitor" },
  { title: "مكتمل", text: "إشعار المتعهد وتحرير السرير", permission: "" },
];

const HOUSING_CARE = [
  {
    icon: Sparkles,
    title: "النظافة اليومية",
    items: [
      "إبقاء الغرفة والسرير والممرات والحمامات والمرافق المشتركة نظيفة باستمرار.",
      "وضع النفايات في الحاويات المخصصة وعدم تركها أمام الغرف أو في الممرات.",
      "عدم تخزين الأطعمة المكشوفة أو الأدوات التي تجذب الحشرات والقوارض.",
      "تنظيف مكان إعداد الطعام وتناول الطعام فور الانتهاء منه.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "السلامة العامة",
    items: [
      "منع التدخين داخل الغرف والممرات والمرافق المشتركة.",
      "منع إدخال أو تخزين مواد قابلة للاشتعال أو أسطوانات غاز داخل السكن.",
      "منع استخدام أجهزة طبخ أو تسخين غير مسموحة داخل الغرف.",
      "عدم إشغال مخارج الطوارئ أو وضع أي عوائق أمامها.",
      "إبلاغ الأمن فوراً عن أي حريق أو تسرب أو خطر محتمل.",
    ],
  },
  {
    icon: Hammer,
    title: "الأثاث والتجهيزات",
    items: [
      "عدم نقل الأسرّة أو الخزائن أو المكيفات من مكانها دون إذن مراقب السكن.",
      "عدم ثقب الجدران أو تركيب أرفف أو أجهزة أو توصيلات كهربائية إضافية.",
      "المحافظة على المفاتيح والبطاقات وعدم تسليمها لغير العامل المسجل.",
      "الإبلاغ عن أي تلف فور حدوثه بدل محاولة إصلاحه ذاتياً.",
    ],
  },
  {
    icon: Zap,
    title: "الكهرباء والمياه",
    items: [
      "إطفاء الأنوار والمكيفات والمراوح عند مغادرة الغرفة.",
      "إغلاق الصنابير جيداً وعدم إهدار المياه.",
      "عدم تشغيل أجهزة ذات قدرة عالية أو ربط وصلات كهربائية متعددة معاً.",
      "إبلاغ مراقب السكن فوراً عن أي تسرب مياه أو عطل كهربائي.",
    ],
  },
  {
    icon: UsersRound,
    title: "الانضباط والاستخدام",
    items: [
      "الالتزام بالسرير والغرفة المخصصين وعدم تغييرهما أو تبادلهما مع الآخرين.",
      "عدم استضافة أشخاص غير مسجلين أو المبيت خارج النطاق المخصص.",
      "الالتزام بأوقات الهدوء وعدم إزعاج بقية السكان.",
      "التعاون مع مراقب السكن والأمن وإظهار البطاقة عند الطلب.",
    ],
  },
  {
    icon: AlertTriangle,
    title: "المسؤولية عند الإضرار",
    items: [
      "المتعهد/المقاول مسؤول عن أي أضرار يسببها عماله في المبنى أو التجهيزات.",
      "تتحمل الشركة تكلفة الإصلاح أو الاستبدال عند إثبات الإهمال أو سوء الاستخدام.",
      "تكرار المخالفات يعرّض العامل للاستبعاد ويُسجّل في ملف المتعهد.",
      "عند إخلاء العامل يُسلّم السرير والعهدة بحالة جيدة قبل مغادرة السكن.",
    ],
  },
  {
    icon: Wrench,
    title: "الإبلاغ والمتابعة",
    items: [
      "تسجيل أي عطل أو مخالفة عبر مراقب السكن أو صفحة الطلبات.",
      "متابعة طلب الإصلاح حتى إغلاقه والتأكد من إتمام العمل.",
      "إبلاغ المتعهد عن أي تغيير في عدد العمال أو مواقعهم.",
      "الالتزام بتعليمات إدارة السكن والدفاع المدني في الحالات الطارئة.",
    ],
  },
];

const DEMO_ACCOUNTS = [
  { username: "admin", role: "مدير النظام", hint: "كل الصلاحيات" },
  { username: "himo", role: "ابراهيم حاميم", hint: "مراقب السكن الداخلي — كل السكنات ما عدا سكن المقاولين" },
  { username: "yusef", role: "يوسف الحميري", hint: "مراقب السكن الداخلي — كل السكنات ما عدا سكن المقاولين" },
  { username: "issa", role: "عيسى حمادي", hint: "مراقب السكن الخارجي — سكن المقاولين فقط" },
  { username: "burhan", role: "مشرف الأمن", hint: "الاعتماد الأمني للطلبات" },
  { username: "radwan", role: "مراقب الزوار", hint: "اعتماد الزوار وبوابة الزوار" },
  { username: "visitor", role: "مراقب الزوار", hint: "حساب ثانٍ لمراقب الزوار — نفس الصلاحيات" },
  { username: "ctr01 ~ ctr23 و ctr99", role: "متعهدون/مقاولون", hint: "بوابة المتعهد فقط — لكل متعهد حساب يبدأ بـ ctr" },
];

const ROLE_GUIDES: Array<{ title: string; any: string[]; icon?: "shield" | "door" | "users" | "book"; items: string[] }> = [
  {
    title: "مدير النظام",
    any: ["admin.users", "admin.settings"],
    items: [
      "إدارة المستخدمين والأدوار والصلاحيات وضبط إعدادات النظام",
      "نسخ احتياطي كامل (تنزيل/استعادة JSON) وسجل العمليات",
      "كل صلاحيات السكن والسكان والمتعهدين والطلبات والتقارير",
      "حذف ملفات الزوار (لمدير النظام فقط)",
    ],
  },
  {
    title: "مراقب السكن الداخلي — ابراهيم حاميم ويوسف الحميري",
    any: ["requests.housing_internal"],
    items: [
      "اعتماد طلبات تسكين/استبعاد عمال المباني الداخلية: سكن الادارين (C)، سكن الزائرين، العيادة، الفنيين، المتعهدين، المشرفين (A)، الهندسية، ر.الاقسام (B)، راس عيس",
      "سكن المقاولين (السكن الخارجي) خارج نطاقك — يملكه مراقب السكن الخارجي",
      "إدخال كود مراقب السكن عند الاعتماد والتحقق من مطابقته لكود مراقب الزوار",
      "تكليس أسرّة فقط ضمن المباني الداخلية، وتسكين الزوار الآتين إليها",
      "تسجيل الزائر وتسكينه وتمديده؛ بيانات وتقارير الزوار تظهر لمدير النظام فقط",
    ],
  },
  {
    title: "مراقب السكن الخارجي — عيسى حمادي",
    any: ["requests.housing_external"],
    items: [
      "اعتماد طلبات تسكين/استبعاد عمال سكن المقاولين (السكن الخارجي) حصرياً",
      "إدخال كود مراقب السكن عند الاعتماد ومطابقته مع كود مراقب الزوار",
      "تكليس أسرّة فقط من أسرّة سكن المقاولين المتاحة",
    ],
  },
  {
    title: "الزوار والنماذج الرسمية",
    any: ["guests.view", "requests.visitor"],
    items: [
      "بعد اعتماد التسكين يظهر زر «نموذج رسمي» — لطلبات العاملين وللزوار المُسكَّنين",
      "النموذج الرسمي يبرز كود المراقبَين وحالة مطابقتهما",
    ],
  },
  {
    title: "مشرف الأمن",
    any: ["requests.security"],
    items: [
      "الاعتماد أو الرفض الأمني لطلبات المتعهدين (إضافة/استبعاد)",
      "متابعة الحضور وحالة الأبواب للعمال ومراقبة الاستبعاد",
    ],
  },
  {
    title: "مراقب الزوار — radwan و visitor",
    any: ["requests.visitor", "guests.view"],
    items: [
      "الاعتماد أو الرفض في مرحلة الزوار وإدخال كود الموظف",
      "بوابة الزوار: تسجيل وتسكين وتمديد الزوار عند منحك صلاحية guests.manage",
      "بيانات وتقارير الزوار لا تظهر إلا لمدير النظام — الاعتمادات خارج النظام",
    ],
  },
  {
    title: "مدير إدارة المتعهد/المقاول",
    any: ["requests.supervise", "contractors.view"],
    items: [
      "اعتماد طلبات المتعهدين في مرحلة الإدارة لموظفي إدارته — قبل مشرف الأمن ومراقب الزوار",
      "عرض المتعهدين وعمالهم داخل نطاق إدارته فقط",
      "لوحة معلومات وطلب/تقارير مخصصة له",
    ],
  },
  {
    title: "متعهد",
    any: ["contractor.portal"],
    items: [
      "بوابة المتعهد: قائمة عمالك وسعتهم وطلباتك الجارية",
      "تقديم طلب إضافة عامل جديد أو استبعاد عامل قائم",
      "متابعة مراحل الاعتماد والإشعارات بعد التنفيذ",
    ],
  },
];

export default function AboutPage() {
  const { data, user, offline } = useApp();
  if (!data) return <Loader label="جارٍ تحميل الدليل..." />;

  // المشهد الإداري الكامل (جداول الأدوار والصلاحيات وحسابات الدخول) لمدير النظام فقط —
  // بقية الدوران (مدير الإدارة، المراقبون، الأمن، الزوار، المتعهد) يرون الدليل الخاص بدورهم فقط.
  const isAdminView = can(user, "admin.users") || can(user, "admin.settings");
  const visibleGuides = isAdminView
    ? ROLE_GUIDES
    : ROLE_GUIDES.filter((guide) => canAny(user, guide.any));

  // مسار الاعتماد يظهر لمن له علاقة بالطلبات أو المتعهدين فقط — وبلا أكواد صلاحيات لغير المدير.
  const canSeeWorkflow =
    isAdminView ||
    can(user, "contractor.portal") ||
    canAny(user, [
      "requests.supervise",
      "requests.department",
      "requests.security",
      "requests.visitor",
      "requests.housing_internal",
      "requests.housing_external",
    ]);

  // تعليمات الحفاظ على السكن تظهر للمتعهدين والمقاولين (ولمدير النظام لمراجعتها).
  const showHousingCare = isAdminView || can(user, "contractor.portal") || can(user, "contractors.manage");

  const permissions = data.permissions || [];
  const grouped = new Map<string, Array<{ id: string; label: string }>>();
  for (const permission of permissions) {
    const prefix = permission.id.split(".")[0];
    const list = grouped.get(prefix) || [];
    list.push(permission);
    grouped.set(prefix, list);
  }

  return (
    <>
      <PageHead
        eyebrow="الدليل"
        title="دليل نظام إدارة سكن الموظفين"
        subtitle={
          isAdminView
            ? `الإصدار ${data.meta?.version || "2.0.0"} · ${formatNumber(data.meta?.counts?.residents || 0)} ساكن · ${formatNumber(data.meta?.counts?.buildings || 0)} مبنى`
            : "دليل دورك ومسار العمل داخل النظام"
        }
        actions={
          <div className="head-actions">
            <Badge tone={offline ? "warn" : "good"} dot>{offline ? "نسخة محفوظة" : "متصل"}</Badge>
            {isAdminView && (
              <Badge tone="info">{data.meta?.mode === "postgres" ? "PostgreSQL / Supabase" : "تخزين JSON"}</Badge>
            )}
          </div>
        }
      />

      <section className="about-hero">
        <div className="about-hero-icon"><BookOpen size={30} /></div>
        <div>
          <h2>نظام متكامل لإدارة السكن والموظفين والمتعهدين</h2>
          <p>
            يجمع النظام سجلات السكان والمباني والأسرّة والحضور والدوام وطلبات المتعهدين والاعتمادات والتقارير في مكان
            واحد، مع تطبيق أندرويد يعمل دون إنترنت للعرض والمتابعة.
          </p>
          <div className="chip-row">
            {isAdminView ? (
              <>
                <span className="mini-chip">Next.js</span>
                <span className="mini-chip">FastAPI</span>
                <span className="mini-chip">PostgreSQL / Supabase</span>
                <span className="mini-chip">Capacitor Android</span>
                <span className="mini-chip">عربي RTL</span>
              </>
            ) : (
              <>
                <span className="mini-chip">{roleLabel(user?.roleId, user?.roleName)}</span>
                <span className="mini-chip">دليل مخصص لدورك</span>
              </>
            )}
          </div>
        </div>
      </section>

      {isAdminView && (
        <div className="stats-grid stats-grid-4">
          <StatCard icon={UsersRound} label="السكان" value={formatNumber(data.meta?.counts?.residents || 0)} hint={`${formatNumber(data.meta?.counts?.housingResidents || 0)} في السكن`} />
          <StatCard icon={BedDouble} label="الأسرّة" value={formatNumber(data.meta?.counts?.beds || 0)} hint={`${formatNumber(data.meta?.counts?.rooms || 0)} غرفة`} tone="info" />
          <StatCard icon={Handshake} label="المتعهدون" value={formatNumber(data.meta?.counts?.contractors || 0)} tone="success" />
          <StatCard icon={ShieldCheck} label="المستخدمون" value={formatNumber(data.meta?.counts?.users || 0)} hint={`${formatNumber((data.roles || []).length)} دور`} tone="warn" />
        </div>
      )}

      {isAdminView && (
        <section className="section">
          <SectionTitle title="البدء السريع" hint="ست خطوات لتشغيل النظام" />
          <div className="guide-grid">
            {QUICK_START.map((step) => (
              <article className="guide-card" key={step.title}>
                <span className="guide-icon"><step.icon size={20} /></span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {canSeeWorkflow && (
      <section className="section">
        <SectionTitle title="مسار اعتماد طلبات المتعهدين" hint="يختلف المسار حسب نوع الطلب" />
        <div className="workflow-compare">
          <div className="form-panel">
            <div className="panel-title">
              <div><h2>إضافة عامل جديد</h2><span>الأمن ← الزوار ← السكن ← مكتمل</span></div>
              <Badge tone="good">new_worker</Badge>
            </div>
            <ol className="stage-flow">
              {ADD_WORKFLOW.map((stage, index) => (
                <li key={stage.title}>
                  <span className="stage-index">{index + 1}</span>
                  <div>
                    <strong>{stage.title}</strong>
                    <p>{stage.text}</p>
                    {isAdminView && stage.permission && <code className="code-chip">{stage.permission}</code>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="form-panel">
            <div className="panel-title">
              <div><h2>استبعاد عامل</h2><span>السكن ← الأمن ← الزوار ← مكتمل</span></div>
              <Badge tone="warn">remove_worker</Badge>
            </div>
            <ol className="stage-flow">
              {REMOVE_WORKFLOW.map((stage, index) => (
                <li key={stage.title}>
                  <span className="stage-index">{index + 1}</span>
                  <div>
                    <strong>{stage.title}</strong>
                    <p>{stage.text}</p>
                    {isAdminView && stage.permission && <code className="code-chip">{stage.permission}</code>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="alert info">
          <CheckCircle2 size={16} />
          <span>
            يمكن رفض الطلب في أي مرحلة مع تسجيل الملاحظات. تُحدّث السعة التعاقدية والأسرّة الفعلية تلقائياً بعد التنفيذ.
          </span>
        </div>
        <div className="alert warning">
          <UserRound size={16} />
          <span>
            مرحلة الزوار تتحقق من الرقم الوظيفي والهوية قبل السكن. لتسجيل وتسكين زوار معتمدين (ضيوف شرف/موظفين جدد)
            استخدم صفحة «بوابة الزوار» — متاحة بموجب صلاحية guests.view للعرض وguests.manage للإدارة، والحذف لمدير النظام فقط.
          </span>
        </div>
      </section>
      )}

      <section className="section">
        <SectionTitle
          title="دليل دورك"
          hint={isAdminView ? "ما يمكنك فعله داخل النظام حسب صلاحياتك الحالية" : "التعلّمات الخاصة بدورك داخل النظام"}
        />
        <div className="guide-grid guide-grid-3">
          {visibleGuides.map((guide) => {
            const active = canAny(user, guide.any);
            return (
              <article className={`guide-card account-card ${active ? "role-active" : ""}`} key={guide.title}>
                <span className="guide-icon"><LogIn size={18} /></span>
                <h3>
                  {guide.title}
                  {active && <Badge tone="good" dot>دورك الحالي</Badge>}
                </h3>
                <ul className="feature-list">
                  {guide.items.map((item) => (
                    <li key={item}><CheckCircle2 size={15} /><span>{item}</span></li>
                  ))}
                </ul>
              </article>
            );
          })}
          {!isAdminView && visibleGuides.length === 0 && (
            <article className="guide-card account-card role-active">
              <span className="guide-icon"><LogIn size={18} /></span>
              <h3>{roleLabel(user?.roleId, user?.roleName)}</h3>
              <ul className="feature-list">
                <li key="fallback"><CheckCircle2 size={15} /><span>اطلب من مدير النظام شرح صلاحيات دورك — لم تُصنَّف تصنيفاً تلقائياً في الدليل بعد.</span></li>
              </ul>
            </article>
          )}
        </div>
      </section>

      {showHousingCare && (
      <section className="section">
        <SectionTitle
          title="تعليمات الحفاظ على السكن"
          hint="التزامات المتعهد/المقاول وعماله داخل السكن — يُرجى الالتزام بها حرفياً"
        />
        <div className="guide-grid guide-grid-3">
          {HOUSING_CARE.map((group) => (
            <article className="guide-card account-card" key={group.title}>
              <span className="guide-icon"><group.icon size={18} /></span>
              <h3>{group.title}</h3>
              <ul className="feature-list">
                {group.items.map((item) => (
                  <li key={item}><CheckCircle2 size={15} /><span>{item}</span></li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <div className="alert warning">
          <AlertTriangle size={16} />
          <span>
            أي إخلال بهذه التعليمات قد يؤدي إلى استبعاد العامل، أو تحميل المتعهد/المقاول تكاليف الإصلاح والاستبدال،
            أو اتخاذ الإجراءات النظامية بحق المخالف. الحفاظ على السكن مسؤولية مشتركة بين المتعهد وعماله وإدارة السكن.
          </span>
        </div>
      </section>
      )}

      {isAdminView && (
      <section className="section">
        <SectionTitle title="الأدوار والصلاحيات" hint={`${permissions.length} صلاحية موزعة على ${(data.roles || []).length} دور`} />
        <div className="table-card">
          <div className="table-scroll">
            <table className="residents-table">
              <thead>
                <tr><th>الدور</th><th>الوصف</th><th>المستخدمون</th><th>عدد الصلاحيات</th><th>أمثلة</th></tr>
              </thead>
              <tbody>
                {(data.roles || []).map((role) => {
                  const users = (data.users || []).filter((account) => account.roleId === role.id).length;
                  return (
                    <tr key={role.id}>
                      <td><strong>{role.name}</strong>{role.isSystem && <small className="block-note">دور نظامي</small>}</td>
                      <td>{role.description || "—"}</td>
                      <td>{formatNumber(users)}</td>
                      <td><Badge tone="info">{formatNumber((role.permissionIds || []).length)}</Badge></td>
                      <td>
                        <div className="chip-row">
                          {(role.permissionIds || []).slice(0, 3).map((id) => (
                            <span className="mini-chip" key={id}>{permissions.find((permission) => permission.id === id)?.label || id}</span>
                          ))}
                          {(role.permissionIds || []).length > 3 && <span className="mini-chip">+{(role.permissionIds || []).length - 3}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="permission-groups">
          {Array.from(grouped.entries()).map(([prefix, items]) => (
            <div className="permission-group" key={prefix}>
              <div className="permission-group-head">
                <strong>{ROLE_PERMISSION_GROUPS[prefix] || prefix}</strong>
                <Badge tone="muted">{formatNumber(items.length)}</Badge>
              </div>
              <div className="chip-row">
                {items.map((item) => (
                  <span className="mini-chip" key={item.id} title={item.id}>{item.label}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      )}

      {isAdminView && (
      <section className="section">
        <SectionTitle title="حسابات الدخول التجريبية" hint="تُستخدم للاختبار — غيّر كلمات المرور قبل التشغيل الفعلي" />
        <div className="guide-grid guide-grid-3">
          {DEMO_ACCOUNTS.map((account) => (
            <article className="guide-card account-card" key={account.username}>
              <span className="guide-icon"><LogIn size={18} /></span>
              <h3>{account.role}</h3>
              <code className="code-chip" dir="ltr">{account.username}</code>
              <p>{account.hint}</p>
              <small>كلمة المرور الافتراضية: 123456</small>
            </article>
          ))}
        </div>
        <div className="alert warning">
          <KeyRound size={16} />
          <span>يُطلب تغيير كلمة المرور عند أول دخول للحسابات التي عيّن لها المدير ذلك. لا تشارك بيانات الدخول.</span>
        </div>
      </section>
      )}

      <div className="dash-grid">
        <section className="form-panel">
          <SectionTitle title="العمل دون إنترنت وتطبيق الأندرويد" />
          <ul className="feature-list">
            <li><WifiOff size={17} /><span><strong>نسخة محفوظة:</strong> تُعرض بيانات آخر مزامنة للقراءة دون إنترنت.</span></li>
            <li><WifiOff size={17} /><span><strong>العمل دون إنترنت:</strong> يمكن الإضافة والتعديل والاعتماد والحذف حسب صلاحياتك — تُحفظ في طابور محلي مع أثرها الفوري على الواجهة.</span></li>
            <li><Smartphone size={17} /><span><strong>دخول PIN:</strong> يمكن إعداد رمز PIN سريع على الجهاز بعد أول دخول ناجح.</span></li>
            <li><Smartphone size={17} /><span><strong>تطبيق أندرويد:</strong> يُبنى عبر Capacitor ويستخدم نفس واجهة الويب مع جسر للطباعة والملفات.</span></li>
            <li><Database size={17} /><span><strong>المزامنة التلقائية:</strong> فور عودة الاتصال يُعاد إرسال الإجراءات المحفوظة بالترتيب ثم تحديث البيانات من الخادم — وتظهر شارة المعلّق أعلى الشاشة.</span></li>
            {isAdminView && (
              <li><Layers size={17} /><span><strong>النسخ الاحتياطي:</strong> من إدارة النظام يمكن تنزيل/استعادة نسخة JSON كاملة.</span></li>
            )}
          </ul>
          <div className="alert info">
            <WifiOff size={16} />
            <span>الإجراءات المنفذة دون إنترنت تُزامَن تلقائياً فور توفر الشبكة؛ وعند تعارض (مثل سرير أخذه عميل آخر) يرفض الخادم الإجراء ويظهر التنبيه.</span>
          </div>
        </section>

        <section className="form-panel">
          <SectionTitle
            title={isAdminView ? "معلومات الجلسة والنظام" : "معلومات جلستك"}
            hint={isAdminView ? undefined : "بياناتك الشخصية فقط — إحصاءات النظام تظهر لمدير النظام"}
          />
          <div className="profile-block">
            <div className="avatar avatar-lg">{(user?.name || "؟").slice(0, 1)}</div>
            <div>
              <strong>{user?.name}</strong>
              <small>{user?.username}</small>
              <Badge tone="info">{roleLabel(user?.roleId, user?.roleName)}</Badge>
            </div>
          </div>
          <InfoGrid
            items={
              isAdminView
                ? [
                    { label: "وقت الخادم", value: data.meta?.serverTime ? new Date(data.meta.serverTime).toLocaleString("ar-EG") : "—" },
                    { label: "وضع التخزين", value: data.meta?.mode === "postgres" ? "PostgreSQL / Supabase" : "ملف JSON" },
                    { label: "إصدار المخطط", value: `v${data.schemaVersion}` },
                    { label: "طلبات معلّقة", value: formatNumber(data.meta?.pendingCounts?.total || 0) },
                    { label: "إشعارات غير مقروءة", value: formatNumber((data.notifications || []).filter((item) => !item.read).length) },
                    { label: "صلاحياتك", value: formatNumber((user?.permissions || []).length) },
                  ]
                : [
                    { label: "وقت الخادم", value: data.meta?.serverTime ? new Date(data.meta.serverTime).toLocaleString("ar-EG") : "—" },
                    { label: "إشعارات غير مقروءة", value: formatNumber((data.notifications || []).filter((item) => !item.read).length) },
                    { label: "صلاحياتك", value: formatNumber((user?.permissions || []).length) },
                  ]
            }
          />
          {can(user, "audit.view") && (
            <p className="muted small-text">يمكنك مراجعة سجل العمليات الكامل من صفحة إدارة النظام.</p>
          )}
        </section>
      </div>

      <section className="section">
        <SectionTitle title="الحالات المستخدمة" hint="مصطلحات موحّدة داخل النظام" />
        <div className="status-key">
          <div><Badge tone="good">حاضر</Badge><span>حسب دورة الدوام — أيام العمل</span></div>
          <div><Badge tone="warn">إجازة</Badge><span>حسب دورة الدوام — أيام الراحة</span></div>
          <div><Badge tone="muted">غير مسكن</Badge><span>بدون سرير</span></div>
        </div>
      </section>

      {isAdminView && (
      <div className="dash-note">
        <strong>ملاحظة:</strong> يُحفظ الإنتاج في مستند JSONB واحد داخل جدول <code className="code-chip">kv_store</code> بالمفتاح{" "}
        <code className="code-chip">housing_state_v1</code> لضمان استمرارية البيانات عند الترقية.
      </div>
      )}
    </>
  );
}
