"use strict";
// 서버가 대기열을 맞추는 규칙: 걸기·이미 있음·고치기·지우기·직접 취소한 것·이미 보낸 것·시험 실행·쉬는 요일·원별 오류
process.env.TZ = "Asia/Seoul";
const test = require("node:test");
const assert = require("node:assert");
const core = require("../core");
const { runReminders } = require("../reminder");
const { fakeDb, DOC_ID } = require("./fake-db");

const BANPO = core.CENTERS.find((c) => c.key === "banpo");
const add = (type, name, phone, dateISO, day, time) => ({ [`${dateISO}::${time}|1번::${phone}__${name}`]: { type, dateISO, day, time, classNo: "1번", studentKey: `${phone}__${name}`, name, phone } });
function seed(extra = {}) {
  const docs = {
    "settings/sms": { autoSms: { enabled: true } },
    "roster/current": { rows: [{ name: "가온", phone: "010-1000-0001", classField: "1번(김)(화-1 15:10)", status: "재원" }] },
    ...Object.fromEntries(Object.entries({
      ...add("makeup", "가온", "010-1000-0001", "2026-11-24", "화", "15:10"),
      ...add("sample", "하늘", "010-2000-0001", "2026-11-24", "화", "16:50"),
      ...add("makeup", "다음날", "010-2000-0009", "2026-11-25", "수", "15:10"),
    }).map(([k, v]) => [`additions/${k}`, v])),
    ...extra,
  };
  return fakeDb(docs);
}
const run = (db, now, opts = {}) => runReminders({ dbFor: () => db, now: new Date(now), docIdField: DOC_ID, centers: [BANPO], ...opts });
const queue = (db) => [...db.store.entries()].filter(([k]) => k.startsWith("smsQueue/")).map(([k, v]) => ({ id: k.slice(9), ...v }));

test("자동 예약이 꺼져 있으면 아무것도 안 함", async () => {
  const db = seed({ "settings/sms": { autoSms: { enabled: false } } });
  const r = await run(db, "2026-11-23T09:05:00");
  assert.strictEqual(r.results[0].note, "자동 예약 꺼짐");
  assert.strictEqual(db.writes.length, 0);
});

test("걸어 두는 시각 전에는 안 걸고, 9시가 지나면 다음 날 일정만 학생마다 한 건씩 검", async () => {
  const db = seed();
  let r = await run(db, "2026-11-23T08:55:00");
  assert.strictEqual(r.results[0].note, "걸어 둘 때가 아님");
  assert.strictEqual(queue(db).length, 0);
  r = await run(db, "2026-11-23T09:05:00");
  const q = queue(db);
  assert.deepStrictEqual(q.map((x) => x.recipients[0].name).sort(), ["가온", "하늘"]);
  assert.ok(q.every((x) => x.autoDate === "2026-11-24" && x.scheduleAt === "2026-11-23T10:00:00.000Z" && x.status === "pending" && x.auto && x.createdBy === "server" && x.center === "반포원" && x.source === "jp-schedule"));
  assert.ok(q.some((x) => x.id === core.autoSmsDocId("banpo", "2026-11-24", "makeup", "010-1000-0001__가온")), "화면과 같은 문서 id");
  assert.match(q.find((x) => x.category === "makeup").recipients[0].message, /11월 24일 화요일 3시 10분/);
  const sum = db.store.get("settings/autoSmsServer");
  assert.strictEqual(sum.results[0].created, 2);
  // 다시 돌려도 그대로 (이미 있음)
  const before = db.writes.filter((w) => w[1].startsWith("smsQueue/")).length;
  r = await run(db, "2026-11-23T09:15:00");
  assert.strictEqual(r.results[0].results[0].already, 2);
  assert.strictEqual(db.writes.filter((w) => w[1].startsWith("smsQueue/")).length, before);
});

test("문구·시간이 바뀌면 고치고, 일정이 없어지면 지움 (방금 건 것은 90초 기다림)", async () => {
  const db = seed();
  await run(db, "2026-11-23T09:05:00");
  db.store.set("smsTemplates/makeup", { text: "{이름} 보강 {시}:{분} 바뀐 문구", title: "", version: 1 });
  db.store.delete("additions/2026-11-24::16:50|1번::010-2000-0001__하늘");
  let r = await run(db, "2026-11-23T09:05:30");
  assert.strictEqual(r.results[0].results[0].updated, 1);
  assert.strictEqual(r.results[0].results[0].deleted, 0, "90초 안에는 안 지움");
  r = await run(db, "2026-11-23T09:15:00");
  assert.strictEqual(r.results[0].results[0].deleted, 1);
  const q = queue(db);
  assert.deepStrictEqual(q.map((x) => x.recipients[0].name), ["가온"]);
  assert.strictEqual(q[0].recipients[0].message, "가온 보강 3:10 바뀐 문구");
});

test("대기열에서 직접 취소한 문자·이미 보낸 문자는 건드리지 않음", async () => {
  const skipId = core.autoSmsDocId("banpo", "2026-11-24", "sample", "010-2000-0001__하늘");
  const sentId = core.autoSmsDocId("banpo", "2026-11-24", "makeup", "010-1000-0001__가온");
  const db = seed({
    "settings/autoSmsSkips": { skips: { [skipId]: { at: 1, by: "데스크" } } },
    [`smsQueue/${sentId}`]: { status: "sent", auto: true, autoDate: "2026-11-24", recipients: [{ name: "가온", phone: "x", message: "옛 문구" }] },
  });
  await run(db, "2026-11-23T09:05:00");
  assert.ok(!db.store.has(`smsQueue/${skipId}`), "직접 취소한 건 다시 안 걸림");
  assert.strictEqual(db.store.get(`smsQueue/${sentId}`).recipients[0].message, "옛 문구", "보낸 건 그대로");
  db.store.delete("additions/2026-11-24::15:10|1번::010-1000-0001__가온");
  await run(db, "2026-11-23T09:30:00");
  assert.ok(db.store.has(`smsQueue/${sentId}`), "보낸 건 일정이 없어져도 안 지움");
});

test("보내는 시각 뒤 5분 동안은 지우기만, 그 뒤엔 손대지 않음", async () => {
  const db = seed();
  await run(db, "2026-11-23T09:05:00");
  db.store.set("additions/2026-11-24::18:30|1번::010-3000-0001__늦게", { type: "makeup", dateISO: "2026-11-24", day: "화", time: "18:30", name: "늦게", phone: "010-3000-0001", studentKey: "010-3000-0001__늦게" });
  db.store.delete("additions/2026-11-24::16:50|1번::010-2000-0001__하늘");
  const r = await run(db, "2026-11-23T19:02:00");
  assert.strictEqual(r.results[0].results[0].deleteOnly, true);
  const names = queue(db).map((x) => x.recipients[0].name).sort();
  assert.deepStrictEqual(names, ["가온"], "늦게 잡은 건 안 걸고, 취소된 건 지움");
  const r2 = await run(db, "2026-11-23T19:06:00");
  assert.strictEqual(r2.results[0].note, "걸어 둘 때가 아님");
});

test("시험 실행(dryRun)은 아무것도 쓰지 않고 무엇을 걸지만 보여 줌", async () => {
  const db = seed();
  const r = await run(db, "2026-11-23T09:05:00", { dryRun: true });
  assert.deepStrictEqual(r.results[0].results[0].created.map((x) => x.name).sort(), ["가온", "하늘"]);
  assert.strictEqual(db.writes.length, 0);
  const r2 = await run(db, "2026-11-23T03:00:00", { dryRun: true, targetDate: "2026-11-25" });
  assert.deepStrictEqual(r2.results[0].results[0].created.map((x) => x.name), ["다음날"], "날짜를 정하면 시각과 상관없이 그날 것");
});

test("쉬는 요일(일·월): 토요일 18시에 화요일 일정을 걸고 발송은 월요일 19시", async () => {
  const db = seed({ "settings/sms": { autoSms: { enabled: true, restDays: ["일", "월"], restQueueTime: "18:00" } } });
  await run(db, "2026-11-21T10:00:00");
  assert.strictEqual(queue(db).length, 0, "토요일 오전에는 아직");
  await run(db, "2026-11-21T18:05:00");
  const q = queue(db).filter((x) => x.autoDate === "2026-11-24");
  assert.strictEqual(q.length, 2);
  assert.ok(q.every((x) => x.scheduleAt === "2026-11-23T10:00:00.000Z"), "월 19:00 (한국시간)");
});

test("한 원에서 오류가 나도 다른 원은 계속하고, 결과에 오류를 남김", async () => {
  const db = seed();
  const r = await runReminders({ dbFor: (c) => { if (c.key === "daechi") throw new Error("PERMISSION_DENIED"); return db; }, now: new Date("2026-11-23T09:05:00"), docIdField: DOC_ID, centers: [BANPO, core.CENTERS.find((c) => c.key === "daechi")] });
  assert.strictEqual(r.ok, false);
  assert.match(r.results[1].error, /PERMISSION_DENIED/);
  assert.strictEqual(r.results[0].results[0].created.length, 2);
});
