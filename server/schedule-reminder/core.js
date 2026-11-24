"use strict";
// 스케줄 매니저(index.html)와 같은 규칙으로 "다음 날 일정 문자"를 계산하는 함수 모음.
// 화면 쪽 코드를 그대로 옮긴 것이라, 규칙을 바꿀 때는 index.html 의 같은 이름 함수도 함께 바꿔야 함
// (test/parity.test.js 가 두 쪽 결과가 같은지 확인함).
// 날짜는 한국 시간 기준 — index.js 에서 process.env.TZ = "Asia/Seoul" 을 먼저 설정함.

// 원 목록: index.html 의 CENTERS 와 같은 키·이름·프로젝트 (문서 id 와 대기열 center 값이 화면과 같아야 함)
const CENTERS = [
  { key: "pyeongchon", name: "평촌원", projectId: "jarada-pyeongchon", smsQueueCenterLabel: "안양평촌원" },
  { key: "banpo", name: "반포원", projectId: "jarada-banpo" },
  { key: "daechi", name: "대치원", projectId: "jarada-daechi" },
];

const WEEK_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
const SMS_CATEGORY_LABELS = { absence: "미등원", select: "선택", sample: "샘플", sampleBooking: "샘플안내", newStudent: "신규", makeup: "보강", substitute: "대체in", moveIn: "반이동in" };
const GROUP_SMS_CATEGORIES = ["sample", "newStudent", "makeup", "substitute", "moveIn"];
const SMS_TEMPLATE_VERSION = { sampleBooking: 2 };
const AUTO_SMS_DEFAULT = { enabled: false, categories: ["sample", "newStudent", "makeup", "substitute", "moveIn"], queueTime: "09:00", sendTime: "19:00", restDays: [], restQueueTime: "18:00" };

// 원마다 기본 문구 (index.html 의 DEFAULT_SMS_TEMPLATES / DEFAULT_SMS_SUBJECTS 를 그대로 옮김.
// 화면은 SMS_CENTER_NAME = 원 이름, SMS_PC_INFO = 평촌원일 때만 주소·채널 안내를 넣음)
function defaultTemplates(center) {
  const SMS_CENTER_NAME = center.name;
  const SMS_PC_INFO = center.key === "pyeongchon";
  // ↓ index.html 에서 그대로 복사 (템플릿 문자열 안이라 들여쓰기를 하지 않음)
const DEFAULT_SMS_TEMPLATES = {
  absence: `안녕하세요? 자라다 ${SMS_CENTER_NAME}입니다.
{이름}연구원이 현재 수업 미등원으로 연락드렸습니다.
확인 부탁드리겠습니다.
감사합니다.`,
  sample: `<성향파악샘플수업 안내>
안녕하세요? 자라다 ${SMS_CENTER_NAME}입니다.
성향파악수업 스케줄 안내드립니다.
◎수업 일시
 {월}월 {일}일 {요일} {시}시 {분}분
${SMS_PC_INFO ? `◎원 주소
안양시 동안구 평촌대로122 (내외프라자 6F)
https://naver.me/I5F5hZhz
◎평촌원 카카오채널
http://pf.kakao.com/_CAHxmG
◎주차 안내 (2시간 무료)
안양시 동안구 귀인로 190번길 39 (평촌주차빌딩)
https://naver.me/FHYOfAOA
◎ 자라다 평촌원 SNS 안내
인스타그램
https://www.instagram.com/pyeongchon_boys
팔로우 부탁드려요~^^
아들 TV 유튜브 채널
https://www.youtube.com/@최민준의_아들TV
구독 부탁드려요~^^
` : ""}감사합니다.`,
  newStudent: `안녕하세요? 자라다 ${SMS_CENTER_NAME}의 비밀 연구원이 된 것을 환영합니다.
 {월}월 {일}일 {요일} {시}시 {분}분
{이름} 자라다 연구원의 첫 수업 안내드립니다.
수업 시작 전 교사 소개를 위해 수업 5분 전까지 도착 부탁드립니다.${SMS_PC_INFO ? `
◎신규 규정 동의서 링크
https://forms.gle/wrVQnvau7PTDcVCK9
신규 동의서 링크 클릭 후 수업 규정을 읽어보시고 작성해주세요:)
-------------------------------------------------------------------------
평촌원의 모든 안내사항은 카카오 채널로 전달되고 있습니다.
채널 친구 추가 후 채팅으로
★연구원 이름, 나이 ★  메시지 꼭 남겨주세요.^^
◎평촌원 카카오 채널
http://pf.kakao.com/_CAHxmG
---------------------------------------------------------------------------
◎원 주소
안양시 동안구 평촌대로122 (내외프라자 6F)
https://naver.me/I5F5hZhz` : `
감사합니다.`}`,
  makeup: `안녕하세요? 자라다 ${SMS_CENTER_NAME}입니다.
보강 수업 스케줄 안내드립니다.
{이름}연구원  {월}월 {일}일 {요일} {시}시 {분}분
보강 수업이 진행될 예정입니다.
감사합니다.`,
  substitute: `안녕하세요? 자라다 ${SMS_CENTER_NAME}입니다.
대체 수업 스케줄 안내드립니다.
{이름}연구원  {월}월 {일}일 {요일} {시}시 {분}분
대체 수업이 진행될 예정입니다.
감사합니다.`,
  moveIn: `안녕하세요? 자라다 ${SMS_CENTER_NAME}입니다.
반 이동 안내드립니다.
{이름}연구원  {월}월 {일}일 {요일} {시}시 {분}분
수업부터 새로운 반에서 진행될 예정입니다.
감사합니다.`,
  // 샘플관리 예약자에게 보내는 '샘플 안내 문자' (성향파악 샘플수업 안내). 고친 뒤 '템플릿 저장'하면 원마다 따로 저장됨
  // 설문지 · 카카오채널 · 주소 · 주차 · SNS는 평촌원 정보라 평촌원에서만 넣음
  sampleBooking: `학부모님, 안녕하세요?
자라다 남아미술학원 ${SMS_CENTER_NAME} 입니다.
성향파악수업을 신청해주셔서 감사합니다.

◎수업 일시
 {월}월 {일}일 {요일} {시}시 {분}분
${SMS_PC_INFO ? `
아래에 있는 설문지 링크를 클릭 후 수업에 필요한 아이의 정보를 수업 전까지 작성해 주세요.

◎설문지 링크
https://forms.gle/PXUpsjChKSrfHANx6

◎평촌원 카카오채널
http://pf.kakao.com/_CAHxmG

설문지 작성 완료 후 채널 채팅을 통해
★아이 이름, 설문지 작성 완료★라고  메시지 꼭 남겨주세요^^
` : ""}
감사합니다 :)${SMS_PC_INFO ? `

-----------------------------------------------------------------

◎원 주소
안양시 동안구 평촌대로122 (내외프라자 6F)
https://naver.me/I5F5hZhz

◎주차 안내 (2시간 무료)
주차장 주소
안양시 동안구 귀인로 190번길 39 (평촌주차빌딩)
https://naver.me/FHYOfAOA

◎ 자라다 평촌원 SNS 안내
자라다 평촌 인스타그램
www.instagram.com/pyeongchon_boys
팔로우 부탁드려요~^^` : ""}`,
  select: "", // 선택 SMS: 처음엔 비워두고, 쓴 내용을 "템플릿 저장"하면 다음부터 그 내용이 불러와짐
};
const DEFAULT_SMS_SUBJECTS = {
  absence: `[자라다 ${SMS_CENTER_NAME}] 미등원 안내`,
  select: "",
  sample: `[자라다 ${SMS_CENTER_NAME}] 샘플 수업 안내`,
  sampleBooking: "<성향파악샘플수업 안내>",
  newStudent: `[자라다 ${SMS_CENTER_NAME}] 신규 수업 안내`,
  makeup: `[자라다 ${SMS_CENTER_NAME}] 보강 수업 안내`,
  substitute: `[자라다 ${SMS_CENTER_NAME}] 대체 수업 안내`,
  moveIn: `[자라다 ${SMS_CENTER_NAME}] 반 이동 안내`,
};
  return { DEFAULT_SMS_TEMPLATES, DEFAULT_SMS_SUBJECTS };
}

function makeKey(phone, name) {
  return `${(phone || "").trim()}__${(name || "").trim()}`.replace(/\//g, "_");
}
function baseName(name) {
  return String(name || "").replace(/[A-Za-z]+$/, "").trim();
}
function parseClassField(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(.+?)\(([^)]+)\)\s*\(([월화수목금토일])-(\d+)\s+(\d{1,2}:\d{2})\)\s*$/);
  if (!m) return null;
  return { classNo: m[1].trim(), teacher: m[2].trim(), day: m[3], period: m[4], time: m[5], raw: String(raw).trim() };
}
function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function snapToMidnight(d) {
  const mins = d.getHours() * 60 + d.getMinutes();
  if (mins >= 23 * 60 + 30) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (mins < 30) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return d;
}
function parseDateValue(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return snapToMidnight(v.toDate()); // Firestore Timestamp
  if (v instanceof Date) return isNaN(v) ? null : snapToMidnight(v);
  if (typeof v === "number") { // Excel serial date fallback
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400000);
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
// 반 배정(roster/current 의 rows) → 학생 키별 정보 (index.html buildStudentsIndex 와 같음)
function buildStudentsIndex(rosterRows) {
  const map = new Map();
  for (const row of rosterRows || []) {
    const key = makeKey(row.phone, row.name);
    const cls = parseClassField(row.classField);
    if (!map.has(key)) map.set(key, { key, name: row.name, phone: row.phone, age: row.age, center: row.center, status: row.status, classes: [], activeClasses: [], parseFailed: [], registeredAt: row.registeredAt || null, startDate: row.startDate || null, sessionsLeft: row.sessionsLeft, _latestDate: parseDateValue(row.registeredAt) });
    const entry = map.get(key);
    if (row.status && !entry._latestDate) entry.status = row.status;
    if (row.registeredAt) {
      const cur = parseDateValue(entry.registeredAt);
      const rowDate = parseDateValue(row.registeredAt);
      if (rowDate && (!cur || rowDate < cur)) entry.registeredAt = row.registeredAt;
      if (rowDate && (!entry._latestDate || rowDate >= entry._latestDate)) {
        entry._latestDate = rowDate;
        entry.sessionsLeft = row.sessionsLeft;
        entry.startDate = row.startDate || entry.startDate;
        entry.status = row.status || entry.status;
      }
    }
    if (cls) {
      const same = (c) => c.day === cls.day && c.time === cls.time && c.classNo === cls.classNo;
      if (!entry.classes.find(same)) entry.classes.push(cls);
      if ((!row.status || row.status === "재원") && !entry.activeClasses.find(same)) entry.activeClasses.push(cls);
    } else if (row.classField && !entry.parseFailed.includes(row.classField)) {
      entry.parseFailed.push(row.classField);
    }
  }
  for (const entry of map.values()) {
    if ((!entry.status || entry.status === "재원") && entry.activeClasses.length) entry.classes = entry.activeClasses;
    delete entry.activeClasses;
  }
  return map;
}
function additionMatchesDate(a, dateISO, dayLetter) {
  if (a.recurring) return a.day === dayLetter && (a.startDate || "") <= dateISO;
  return a.dateISO === dateISO;
}
// 날짜별 표시 문서의 태그 (index.html overrideParts 의 tag 부분)
const TAG_KEYS = new Set(["newStudent", "shortterm", "leave", "withdrawn", "moveIn", "moveOut", "substitute", "substituteOut", "makeup"]);
const STATUS_KEYS = new Set(["absent", "sickLeave", "noshow", "extension"]);
function overrideTag(ov) {
  if (!ov) return null;
  if ("tag" in ov || "status" in ov) return TAG_KEYS.has(ov.tag) ? ov.tag : null;
  if (STATUS_KEYS.has(ov.type)) return null;
  return TAG_KEYS.has(ov.type) ? ov.type : null;
}
// ctx: { additions: {id: 등록}, overrides: {id: 표시}, studentsIndex }
function computeRecipientsForDate(ctx, category, dateISO, day) {
  const list = [];
  for (const a of Object.values(ctx.additions)) {
    if (a.type !== category) continue;
    if (additionMatchesDate(a, dateISO, day)) list.push({ key: a.studentKey || makeKey(a.phone, a.name), name: a.name, phone: a.phone, day: a.day, time: a.time, dateISO: a.recurring ? dateISO : a.dateISO });
  }
  if (category === "moveIn") {
    const seen = new Set(list.map((r) => r.key));
    for (const [ovKey, ov] of Object.entries(ctx.overrides)) {
      if (overrideTag(ov) !== "moveIn" || !ovKey.startsWith(`${dateISO}::`)) continue;
      const studentKey = ovKey.slice(dateISO.length + 2);
      if (seen.has(studentKey)) continue;
      const entry = ctx.studentsIndex.get(studentKey);
      const cls = entry ? entry.classes.filter((c) => c.day === day).sort((x, y) => timeToMinutes(x.time) - timeToMinutes(y.time))[0] : null;
      seen.add(studentKey);
      list.push({ key: studentKey, name: (entry && entry.name) || ov.name, phone: (entry && entry.phone) || ov.phone, day, time: cls ? cls.time : "", dateISO });
    }
  }
  return list;
}
function smsByteLength(str) {
  let len = 0;
  for (const ch of String(str || "")) len += ch.codePointAt(0) > 127 ? 2 : 1;
  return len;
}
function renderSmsTokens(template, recipient) {
  if (!template) return "";
  let year = "", month = "", day = "", weekday = "", hour = "", minute = "";
  if (recipient.dateISO) {
    const d = new Date(recipient.dateISO + "T00:00:00");
    if (!isNaN(d)) {
      year = String(d.getFullYear());
      month = String(d.getMonth() + 1);
      day = String(d.getDate());
      weekday = `${WEEK_ORDER[(d.getDay() + 6) % 7]}요일`;
    }
  }
  if (recipient.time) {
    const [h, m] = recipient.time.split(":").map(Number);
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    hour = String(h12);
    minute = String(m).padStart(2, "0");
  }
  const displayName = baseName(recipient.name);
  return template
    .split("{이름}").join(displayName)
    .split("{년}").join(year)
    .split("{월}").join(month)
    .split("{일}").join(day)
    .split("{요일}").join(weekday)
    .split("{시}").join(hour)
    .split("{분}").join(minute);
}
// 저장된 문구(smsTemplates/{유형}) → 쓸 문구·제목 (예전 판 문구는 기본 문구로)
function templateFor(smsTemplates, defaults, category) {
  const t = smsTemplates[category];
  const saved = t && !((t.version || 1) < (SMS_TEMPLATE_VERSION[category] || 1)) ? t : null;
  const text = saved && saved.text != null ? saved.text : (defaults.DEFAULT_SMS_TEMPLATES[category] != null ? defaults.DEFAULT_SMS_TEMPLATES[category] : "");
  const title = saved && saved.title != null ? saved.title : (defaults.DEFAULT_SMS_SUBJECTS[category] != null ? defaults.DEFAULT_SMS_SUBJECTS[category] : "");
  return { text, title };
}
function kstLocalToUtcISOString(localStr) {
  if (!localStr) return null;
  const [datePart, timePart] = localStr.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = (timePart || "0:0").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm || 0, 0)).toISOString();
}
// settings/sms 의 autoSms → 설정 (index.html autoSmsConfig 와 같음)
function autoSmsConfig(smsConfig) {
  const c = ((smsConfig || {}).autoSms) || {};
  const okTime = (t, d) => (/^\d{2}:\d{2}$/.test(t || "") ? t : d);
  return {
    enabled: !!c.enabled,
    categories: Array.isArray(c.categories) ? c.categories.filter((x) => GROUP_SMS_CATEGORIES.includes(x)) : AUTO_SMS_DEFAULT.categories.slice(),
    queueTime: okTime(c.queueTime, AUTO_SMS_DEFAULT.queueTime),
    sendTime: okTime(c.sendTime, AUTO_SMS_DEFAULT.sendTime),
    restDays: Array.isArray(c.restDays) ? WEEK_ORDER.filter((d) => c.restDays.includes(d)) : [],
    restQueueTime: okTime(c.restQueueTime, AUTO_SMS_DEFAULT.restQueueTime),
  };
}
// 지금 대기열을 맞춰야 하는 일정 날짜들 (index.html autoSmsWindows 와 같음)
function autoSmsWindows(cfg, now) {
  if (!cfg.enabled || !cfg.categories.length || cfg.queueTime >= cfg.sendTime) return [];
  const at = (d, hm) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(hm.slice(0, 2)), Number(hm.slice(3, 5)));
  const dayOf = (d) => WEEK_ORDER[(d.getDay() + 6) % 7];
  const isRest = (d) => cfg.restDays.includes(dayOf(d));
  const out = [];
  for (let k = 1; k <= 8; k++) {
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k);
    const prev = new Date(target.getFullYear(), target.getMonth(), target.getDate() - 1);
    let start;
    if (!isRest(prev)) start = at(prev, cfg.queueTime);
    else {
      let w = new Date(prev);
      for (let i = 0; i < 7 && isRest(w); i++) w = new Date(w.getFullYear(), w.getMonth(), w.getDate() - 1);
      if (isRest(w)) continue;
      start = at(w, cfg.restQueueTime);
    }
    const send = at(prev, cfg.sendTime);
    if (now < start || now.getTime() >= send.getTime() + 5 * 60000) continue;
    out.push({ cfg, targetISO: toISODate(target), day: dayOf(target), sendAtLocal: `${toISODate(prev)}T${cfg.sendTime}`, deleteOnly: now >= send, early: isRest(prev) });
  }
  return out;
}
// 시험용: 일정 날짜를 직접 정해서 (지금 시각과 상관없이) 그날 것을 계산
function windowForDate(cfg, dateISO) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const prev = new Date(y, m - 1, d - 1);
  return { cfg, targetISO: dateISO, day: WEEK_ORDER[(target.getDay() + 6) % 7], sendAtLocal: `${toISODate(prev)}T${cfg.sendTime}`, deleteOnly: false, early: false };
}
function autoSmsHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function autoSmsDocId(centerKey, dateISO, cat, studentKey) { return `auto_${centerKey || "c"}_${dateISO}_${cat}_${autoSmsHash(studentKey)}`; }
// 걸려 있어야 할 자동 문자: 문서 id → 대기열 문서 (index.html autoSmsDesired 와 같음)
// ctx: { center, additions, overrides, studentsIndex, smsTemplates, defaults }
function autoSmsDesired(ctx, w) {
  const desired = new Map(), skipped = [];
  const scheduleAt = kstLocalToUtcISOString(w.sendAtLocal);
  const center = ctx.center.smsQueueCenterLabel || ctx.center.name || null;
  for (const cat of w.cfg.categories) {
    const { text: message, title: subject } = templateFor(ctx.smsTemplates, ctx.defaults, cat);
    for (const r of computeRecipientsForDate(ctx, cat, w.targetISO, w.day)) {
      const key = r.key || `${r.phone}__${r.name}`;
      if (!String(r.phone || "").replace(/\D/g, "")) { skipped.push(`${r.name}(번호 없음)`); continue; }
      const msg = renderSmsTokens(message, r), sub = renderSmsTokens(subject, r);
      if (smsByteLength(msg) > 90 && !sub.trim()) { skipped.push(`${r.name}(${SMS_CATEGORY_LABELS[cat]} 장문인데 제목 없음)`); continue; }
      desired.set(autoSmsDocId(ctx.center.key, w.targetISO, cat, key), {
        recipients: [{ name: r.name, phone: r.phone, studentKey: r.key || null, message: msg, subject: sub }],
        messageTemplate: message, subjectTemplate: subject || "", scheduleAt, status: "pending", center, source: "jp-schedule", category: cat,
        auto: true, autoDate: w.targetISO, autoKey: key,
      });
    }
  }
  return { desired, skipped };
}
function autoSmsSame(cur, v) {
  const a = (cur.recipients || [])[0] || {}, b = v.recipients[0];
  return cur.status === "pending" && cur.scheduleAt === v.scheduleAt && a.phone === b.phone && a.message === b.message && (a.subject || "") === (b.subject || "");
}

module.exports = {
  CENTERS, WEEK_ORDER, GROUP_SMS_CATEGORIES, SMS_CATEGORY_LABELS, AUTO_SMS_DEFAULT,
  defaultTemplates, makeKey, baseName, parseClassField, buildStudentsIndex, additionMatchesDate, overrideTag,
  computeRecipientsForDate, smsByteLength, renderSmsTokens, templateFor, kstLocalToUtcISOString,
  autoSmsConfig, autoSmsWindows, windowForDate, autoSmsHash, autoSmsDocId, autoSmsDesired, autoSmsSame, toISODate,
};
