"use strict";
// 서버(core.js)와 스케줄 매니저 화면(index.html)이 같은 입력에 같은 결과를 내는지 비교:
// 원마다 기본 문구, 걸어 둘 때(쉬는 요일 포함), 받는 사람·문서 id·문자 내용·제목·보내는 시각
process.env.TZ = "Asia/Seoul";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const core = require("../core");

const html = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
function grab(name) {
  // 한 줄짜리 함수 먼저, 아니면 맨 앞에서 닫는 \n}\n 까지 (기본값에 괄호가 있어도 되게)
  const m = html.match(new RegExp(`\\nfunction ${name}\\(.*\\{.*\\}\\n`)) || html.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m) throw new Error("함수를 못 찾음: " + name);
  return m[0];
}
function grabConst(name) {
  // 한 줄짜리 먼저, 아니면 여러 줄 객체 (\n}; 까지)
  const m = html.match(new RegExp(`\\nconst ${name} = [^\\n]*;\\n`)) || html.match(new RegExp(`\\nconst ${name} = \\{[\\s\\S]*?\\n\\};\\n`));
  if (!m) throw new Error("상수를 못 찾음: " + name);
  return m[0];
}
const consts = ["WEEK_ORDER", "SMS_CENTER_NAME", "SMS_PC_INFO", "DEFAULT_SMS_TEMPLATES", "DEFAULT_SMS_SUBJECTS", "SMS_CATEGORY_LABELS", "GROUP_SMS_CATEGORIES", "SMS_TEMPLATE_VERSION", "AUTO_SMS_DEFAULT"];
const fns = ["makeKey", "baseName", "parseClassField", "timeToMinutes", "toISODate", "snapToMidnight", "parseDateValue", "buildStudentsIndex", "additionMatchesDate",
  "overrideParts", "computeRecipientsForDate", "smsByteLength", "renderSmsTokens", "savedSmsTemplate", "getSmsTemplateText", "getSmsTemplateTitle",
  "kstLocalToUtcISOString", "autoSmsConfig", "autoSmsWindows", "autoSmsHash", "autoSmsDocId", "autoSmsDesired", "autoSmsSame"];
const clientSrc = consts.map(grabConst).join("") + fns.map(grab).join("");

// 화면 코드를 원마다 따로 실행 (기본 문구가 원 이름·평촌 안내에 따라 달라짐)
function clientFor(centerKey, st) {
  const c = core.CENTERS.find((x) => x.key === centerKey);
  const selectedCenter = { name: c.name, smsQueueCenterLabel: c.smsQueueCenterLabel };
  const TAG_META = Object.fromEntries(["newStudent", "shortterm", "leave", "withdrawn", "moveIn", "moveOut", "substitute", "substituteOut", "makeup"].map((k) => [k, {}]));
  const STATUS_META = Object.fromEntries(["absent", "sickLeave", "noshow", "extension"].map((k) => [k, {}]));
  const ctx = vm.createContext({ state: st, selectedCenter, selectedCenterKey: centerKey, window: {}, TAG_META, STATUS_META, console, Date, Map, Set, JSON, Math, Number, String, Object, Array, RegExp, isNaN });
  vm.runInContext(clientSrc + "\nthis.client = { DEFAULT_SMS_TEMPLATES, DEFAULT_SMS_SUBJECTS, autoSmsWindows, autoSmsDesired, computeRecipientsForDate };", ctx);
  return ctx.client;
}

const roster = [
  { name: "가온", phone: "010-1000-0001", classField: "1번(김)(화-1 15:10)", status: "재원", registeredAt: "2025-03-01" },
  { name: "나래B", phone: "010-1000-0002", classField: "3번(이)(화-2 16:50)", status: "재원", registeredAt: "2025-04-01" },
  { name: "나래B", phone: "010-1000-0002", classField: "3번(이)(목-2 16:50)", status: "재원", registeredAt: "2025-04-01" },
  { name: "다솜", phone: "010-1000-0003", classField: "4번(박)(화-3 18:30)", status: "퇴원", registeredAt: "2024-01-01" },
  { name: "번호없음", phone: "", classField: "1번(김)(화-1 15:10)", status: "재원" },
];
const additions = {
  "2026-11-24::15:10|1번::010-1000-0001__가온": { type: "makeup", dateISO: "2026-11-24", day: "화", time: "15:10", classNo: "1번", studentKey: "010-1000-0001__가온", name: "가온", phone: "010-1000-0001" },
  "2026-11-24::16:50|4번::010-2000-0001__하늘": { type: "sample", dateISO: "2026-11-24", day: "화", time: "16:50", classNo: "4번", studentKey: "010-2000-0001__하늘", name: "하늘", phone: "010-2000-0001" },
  "2026-11-24::18:30|2번::010-2000-0002__보람A": { type: "newStudent", dateISO: "2026-11-24", day: "화", time: "18:30", classNo: "2번", studentKey: "010-2000-0002__보람A", name: "보람A", phone: "010-2000-0002" },
  "2026-11-24::15:10|2번::__번호없음": { type: "substitute", dateISO: "2026-11-24", day: "화", time: "15:10", classNo: "2번", name: "번호없음", phone: "" },
  "RECURRING::16:50|5번::010-2000-0003__단기": { type: "substitute", recurring: true, startDate: "2026-11-10", day: "화", time: "16:50", classNo: "5번", studentKey: "010-2000-0003__단기", name: "단기", phone: "010-2000-0003", dateISO: "2026-11-10" },
  "RECURRING::16:50|5번::010-2000-0004__나중": { type: "substitute", recurring: true, startDate: "2026-12-01", day: "화", time: "16:50", classNo: "5번", studentKey: "010-2000-0004__나중", name: "나중", phone: "010-2000-0004", dateISO: "2026-12-01" },
  "2026-11-25::15:10|1번::010-2000-0005__수요일": { type: "makeup", dateISO: "2026-11-25", day: "수", time: "15:10", classNo: "1번", studentKey: "010-2000-0005__수요일", name: "수요일", phone: "010-2000-0005" },
};
const overrides = {
  "2026-11-24::010-1000-0002__나래B": { tag: "moveIn", status: null, type: "moveIn", name: "나래B", phone: "010-1000-0002", dateISO: "2026-11-24" },
  "2026-11-24::010-1000-0003__다솜": { type: "moveIn", name: "다솜", phone: "010-1000-0003" }, // 예전 모양
  "2026-11-24::010-1000-0001__가온": { tag: null, status: "absent", type: "absent" },
};
const smsTemplates = {
  makeup: { text: "{이름} 보강 {월}/{일}({요일}) {시}:{분} — 고친 문구", title: "", version: 1 },
  sample: { text: "아주 긴 샘플 안내 ".repeat(10) + "{이름}", title: "", version: 1 }, // 장문인데 제목 없음 → 못 검
};

test("원마다 기본 문구가 화면과 같음", () => {
  for (const c of core.CENTERS) {
    const client = clientFor(c.key, { smsTemplates: {} });
    const d = core.defaultTemplates(c);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(d.DEFAULT_SMS_TEMPLATES)), JSON.parse(JSON.stringify(client.DEFAULT_SMS_TEMPLATES)), c.name + " 문구");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(d.DEFAULT_SMS_SUBJECTS)), JSON.parse(JSON.stringify(client.DEFAULT_SMS_SUBJECTS)), c.name + " 제목");
  }
});

const configs = {
  "기본 (모든 유형, 09:00/19:00)": { enabled: true },
  "쉬는 요일 일·월 · 18:00": { enabled: true, restDays: ["일", "월"], restQueueTime: "18:00" },
  "유형 일부 · 시각 바꿈": { enabled: true, categories: ["makeup", "moveIn", "substitute"], queueTime: "10:30", sendTime: "20:00" },
};
const nows = ["2026-11-23T09:05:00", "2026-11-23T08:59:00", "2026-11-21T18:05:00", "2026-11-21T10:00:00", "2026-11-23T19:02:00", "2026-11-23T19:06:00", "2026-11-24T09:00:00", "2026-11-23T10:31:00"];

for (const [label, autoSms] of Object.entries(configs)) {
  for (const c of core.CENTERS) {
    test(`걸어 둘 때·받는 사람·문서·문자가 화면과 같음 (${label} · ${c.name})`, () => {
      const st = { smsConfig: { autoSms }, smsTemplates, additions, overrides, roster };
      const client = clientFor(c.key, st);
      const cfg = core.autoSmsConfig({ autoSms });
      const defaults = core.defaultTemplates(c);
      const studentsIndex = core.buildStudentsIndex(roster);
      for (const n of nows) {
        const now = new Date(n);
        const sw = core.autoSmsWindows(cfg, now), cw = client.autoSmsWindows(now);
        const strip = (ws) => JSON.parse(JSON.stringify(ws.map((w) => ({ ...w, cfg: undefined }))));
        assert.deepStrictEqual(strip(sw), strip(cw), `${n} 걸어 둘 날짜`);
        for (let i = 0; i < sw.length; i++) {
          const s = core.autoSmsDesired({ center: c, additions, overrides, studentsIndex, smsTemplates, defaults }, sw[i]);
          const k = client.autoSmsDesired(cw[i]);
          assert.deepStrictEqual(JSON.parse(JSON.stringify([...s.desired])), JSON.parse(JSON.stringify([...k.desired])), `${n} ${sw[i].targetISO} 문서`);
          assert.deepStrictEqual(JSON.parse(JSON.stringify(s.skipped)), JSON.parse(JSON.stringify(k.skipped)), `${n} 못 건 것`);
        }
      }
    });
  }
}

test("화요일 일정 받는 사람 (보강·샘플·신규·대체·단기·반이동in 태그와 예전 모양)", () => {
  const studentsIndex = core.buildStudentsIndex(roster);
  const ctx = { additions, overrides, studentsIndex };
  const names = (cat) => core.computeRecipientsForDate(ctx, cat, "2026-11-24", "화").map((r) => r.name).sort();
  assert.deepStrictEqual(names("makeup"), ["가온"]);
  assert.deepStrictEqual(names("sample"), ["하늘"]);
  assert.deepStrictEqual(names("newStudent"), ["보람A"]);
  assert.deepStrictEqual(names("substitute"), ["단기", "번호없음"], "시작 전 단기는 빠짐");
  assert.deepStrictEqual(names("moveIn"), ["나래B", "다솜"], "결석 표시는 빠짐");
  const nr = core.computeRecipientsForDate(ctx, "moveIn", "2026-11-24", "화").find((r) => r.name === "나래B");
  assert.strictEqual(nr.time, "16:50", "반이동in 은 그날 정규 수업 시간");
});
