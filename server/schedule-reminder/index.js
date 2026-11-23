"use strict";
// Cloud Run 함수 진입점: Cloud Scheduler(schedule-reminder-every10)가 8시~19시 50분 사이 10분마다 부름 (한국 시간).
// 원마다 '다음 날 일정 문자를 걸어 둘 때'인지는 스케줄 매니저 문자 설정(걸어 두는 시각·보내는 시각·쉬는 요일)을 보고 정함.
// 시험: ?dryRun=1 이면 실제로 걸지 않고 무엇을 걸지만 돌려줌. ?date=YYYY-MM-DD 로 일정 날짜 지정, ?center=pyeongchon|banpo|daechi
process.env.TZ = "Asia/Seoul";
const functions = require("@google-cloud/functions-framework");
const admin = require("firebase-admin");
const { runReminders } = require("./reminder");

// 원마다 Firebase 프로젝트가 따로라서 앱을 원마다 하나씩 만듦 (이 함수 실행 계정에 세 프로젝트의 Firestore 권한이 있어야 함)
const apps = {};
function dbFor(center) {
  if (!apps[center.key]) apps[center.key] = admin.initializeApp({ projectId: center.projectId }, center.key);
  return apps[center.key].firestore();
}

functions.http("scheduleReminder", async (req, res) => {
  const q = req.query || {};
  const dryRun = q.dryRun === "1" || q.dryRun === "true";
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(q.date || "")) ? String(q.date) : null;
  const onlyCenter = q.center ? String(q.center) : null;
  try {
    const result = await runReminders({ dbFor, now: new Date(), dryRun, onlyCenter, targetDate, docIdField: admin.firestore.FieldPath.documentId() });
    console.log(JSON.stringify({ severity: "INFO", message: "schedule-reminder", dryRun,
      results: result.results.map((r) => ({ center: r.center, note: r.note, error: r.error,
        days: (r.results || []).map((x) => ({ date: x.date, created: x.created.length, updated: x.updated, deleted: x.deleted, already: x.already, skipped: x.skipped.length })) })) }));
    res.status(result.ok ? 200 : 500).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});
