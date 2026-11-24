"use strict";
// 10분마다 실행: 원마다 스케줄 매니저 문자 설정의 '자동 예약 문자'가 켜져 있으면, 지금이 다음 날 일정 문자를 걸어 둘 때인지 보고
// (전날 걸어 두는 시각 ~ 보내는 시각, 쉬는 요일 다음 날은 마지막 근무일 시각부터) 그 날짜 일정 문자를 smsQueue 에 맞춤.
// 실제 발송은 지금처럼 문자 서버(sms-relay)가 1분마다 대기열을 보고 처리함.
// - 문서 id 가 스케줄 매니저 화면과 같은 "auto_원_날짜_유형_학생" → 화면과 서버가 같이 해도 한 건만 남음
// - 없으면 만들고(create), 일정·문구가 바뀌었으면 고치고, 일정이 없어졌으면 지움 (모두 아직 '대기 중'인 것만)
// - 방금(90초 안) 고친 문자는 지우지 않음 (화면이 막 건 것일 수 있음)
// - 대기열에서 직접 취소한 문자(settings/autoSmsSkips)는 다시 걸지 않음
// - 보내는 시각 뒤 5분 동안은 지우기만 함
const core = require("./core");

const GRACE_MS = 90 * 1000;

function isAlreadyExists(e) {
  return !!e && (e.code === 6 || e.code === "already-exists" || /ALREADY_EXISTS|already exists/i.test(String(e.message || "")));
}
const docsToMap = (snap) => Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));

// 그 날짜 일정에 필요한 것만 읽음 (등록: 그 날짜 것 + 매주 반복, 표시: 그 날짜 것, 자동 문자: 그 날짜 것)
async function loadDay(db, dateISO, docIdField) {
  const [byDate, recurring, overrides, queue] = await Promise.all([
    db.collection("additions").where("dateISO", "==", dateISO).get(),
    db.collection("additions").where("recurring", "==", true).get(),
    db.collection("overrides").where(docIdField, ">=", `${dateISO}::`).where(docIdField, "<", `${dateISO}::`).get(),
    db.collection("smsQueue").where("autoDate", "==", dateISO).get(),
  ]);
  return { additions: { ...docsToMap(byDate), ...docsToMap(recurring) }, overrides: docsToMap(overrides), queue: docsToMap(queue) };
}

async function runForCenter({ db, center, now, dryRun = false, targetDate = null, docIdField }) {
  const out = { center: center.name, results: [], note: "" };
  const smsSnap = await db.doc("settings/sms").get();
  const cfg = core.autoSmsConfig(smsSnap.exists ? smsSnap.data() : {});
  if (!cfg.enabled) { out.note = "자동 예약 꺼짐"; return out; }
  const windows = targetDate ? [core.windowForDate(cfg, targetDate)] : core.autoSmsWindows(cfg, now);
  if (!windows.length) { out.note = "걸어 둘 때가 아님"; return out; }

  const [rosterSnap, tplSnap, skipSnap] = await Promise.all([
    db.doc("roster/current").get(),
    db.collection("smsTemplates").get(),
    db.doc("settings/autoSmsSkips").get(),
  ]);
  const studentsIndex = core.buildStudentsIndex((rosterSnap.exists && rosterSnap.data().rows) || []);
  const smsTemplates = docsToMap(tplSnap);
  const skips = (skipSnap.exists && skipSnap.data().skips) || {};
  const defaults = core.defaultTemplates(center);
  const nowMs = now.getTime();

  for (const w of windows) {
    const day = await loadDay(db, w.targetISO, docIdField);
    const { desired, skipped } = core.autoSmsDesired({ center, additions: day.additions, overrides: day.overrides, studentsIndex, smsTemplates, defaults }, w);
    const r = { date: w.targetISO, sendAt: core.kstLocalToUtcISOString(w.sendAtLocal), deleteOnly: !!w.deleteOnly, created: [], updated: 0, deleted: 0, already: 0, skipped };
    if (!w.deleteOnly) {
      for (const [id, v] of desired) {
        if (skips[id]) continue;
        const cur = day.queue[id];
        if (cur && cur.status !== "pending") continue; // 이미 보냈거나 보내는 중
        if (cur && core.autoSmsSame(cur, v)) { r.already++; continue; }
        if (dryRun) { if (cur) r.updated++; else r.created.push({ name: v.recipients[0].name, category: core.SMS_CATEGORY_LABELS[v.category] }); continue; }
        const ref = db.collection("smsQueue").doc(id);
        const data = { ...v, createdAt: (cur && cur.createdAt) || nowMs, updatedAt: nowMs, createdBy: (cur && cur.createdBy) || "server" };
        if (!cur) {
          try { await ref.create(data); r.created.push({ name: v.recipients[0].name, category: core.SMS_CATEGORY_LABELS[v.category] }); }
          catch (e) { if (isAlreadyExists(e)) r.already++; else throw e; }
        } else {
          const did = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists || snap.data().status !== "pending") return false;
            tx.set(ref, data);
            return true;
          });
          if (did) r.updated++;
        }
      }
    }
    for (const [id, q] of Object.entries(day.queue)) {
      if (!q || !q.auto || q.status !== "pending" || desired.has(id)) continue;
      if (nowMs - (q.updatedAt || q.createdAt || 0) < GRACE_MS) continue;
      if (dryRun) { r.deleted++; continue; }
      const ref = db.collection("smsQueue").doc(id);
      const did = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().status !== "pending" || !snap.data().auto) return false;
        tx.delete(ref);
        return true;
      });
      if (did) r.deleted++;
    }
    out.results.push(r);
  }
  return out;
}

// now: 지금 시각, targetDate: "YYYY-MM-DD" 로 일정 날짜를 직접 지정(시험용, 시각과 상관없이 그날 것을 계산)
// dbFor(center) → 그 원 Firebase 프로젝트의 Firestore
async function runReminders({ dbFor, now = new Date(), dryRun = false, onlyCenter = null, targetDate = null, docIdField, centers = core.CENTERS }) {
  const results = [];
  for (const center of centers.filter((c) => !onlyCenter || c.key === onlyCenter || c.name === onlyCenter)) {
    let r;
    let db = null;
    try {
      db = dbFor(center);
      r = await runForCenter({ db, center, now, dryRun, targetDate, docIdField });
    } catch (e) {
      r = { center: center.name, error: String((e && e.message) || e) };
    }
    results.push(r);
    // 스케줄 매니저 문자 설정 창에 마지막 실행 결과를 보여 주기 위한 기록 (시험 실행·꺼진 원·걸 때가 아닌 때는 남기지 않음)
    if (!dryRun && db && (r.error || (r.results && r.results.length))) {
      const summary = {
        lastRunAt: now.getTime(), error: r.error || "",
        results: (r.results || []).map((x) => ({ date: x.date, created: x.created.length, updated: x.updated, deleted: x.deleted, already: x.already, skipped: x.skipped.length, deleteOnly: x.deleteOnly })),
      };
      try { await db.doc("settings/autoSmsServer").set(summary); } catch (e) { /* 기록 실패는 무시 */ }
    }
  }
  return { ok: results.every((r) => !r.error), dryRun, now: now.toISOString(), results };
}

module.exports = { runReminders, runForCenter, loadDay };
