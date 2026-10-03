// firestore.rules 를 Firestore 에뮬레이터에서 검증하는 테스트
// 실행: tools 폴더에서  npm install  후  npm run test:rules
import fs from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";

const RULES_PATH = new URL("../firestore.rules", import.meta.url); // 이 파일 기준으로 저장소 루트의 규칙 파일
const env = await initializeTestEnvironment({
  projectId: "demo-jp",
  firestore: { rules: fs.readFileSync(RULES_PATH, "utf8") },
});

// compat / modular 양쪽 SDK 모두 지원하는 얇은 래퍼
function api(db) {
  if (typeof db.collection === "function") {
    return {
      get: (c, id) => db.collection(c).doc(id).get(),
      set: (c, id, v) => db.collection(c).doc(id).set(v),
      update: (c, id, v) => db.collection(c).doc(id).update(v),
      del: (c, id) => db.collection(c).doc(id).delete(),
      list: (c) => db.collection(c).get(),
    };
  }
  return (async () => {
    const m = await import("firebase/firestore");
    return {
      get: (c, id) => m.getDoc(m.doc(db, c, id)),
      set: (c, id, v) => m.setDoc(m.doc(db, c, id), v),
      update: (c, id, v) => m.updateDoc(m.doc(db, c, id), v),
      del: (c, id) => m.deleteDoc(m.doc(db, c, id)),
      list: (c) => m.getDocs(m.collection(db, c)),
    };
  })();
}

const results = [];
async function check(name, promise, expectOk) {
  try {
    if (expectOk) await assertSucceeds(promise); else await assertFails(promise);
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e && e.message ? e.message : e).slice(0, 160) });
  }
}

// 시드 데이터 (규칙 무시하고 직접 넣음)
await env.withSecurityRulesDisabled(async (ctx) => {
  const a = await api(ctx.firestore());
  for (const c of ["roster", "photos", "overrides", "additions", "manualRooms", "smsTemplates", "settings", "listMemos", "dayLogs", "makeupOpenings", "bookingSettings", "attendance", "counseling", "smsQueue", "payments"]) {
    await a.set(c, "seed", { seeded: true, records: [], logs: [] });
    await a.set(c, "seed2", { seeded: true, records: [], logs: [] });
  }
});

const STAFF_COLLECTIONS = ["roster", "photos", "overrides", "additions", "manualRooms", "smsTemplates", "settings", "listMemos", "dayLogs", "makeupOpenings", "bookingSettings", "smsQueue"];

const unauth = await api(env.unauthenticatedContext().firestore());
const staff = await api(env.authenticatedContext("staff1", { email: "staff@jarada.kr", firebase: { sign_in_provider: "password" } }).firestore());
const admin = await api(env.authenticatedContext("admin1", { email: "JinHyuck@gmail.com", email_verified: true, firebase: { sign_in_provider: "google.com" } }).firestore());
const stranger = await api(env.authenticatedContext("x1", { email: "stranger@gmail.com", email_verified: true, firebase: { sign_in_provider: "google.com" } }).firestore());
const unverifiedGoogle = await api(env.authenticatedContext("x2", { email: "jinhyuck@gmail.com", email_verified: false, firebase: { sign_in_provider: "google.com" } }).firestore());
const anon = await api(env.authenticatedContext("x3", { firebase: { sign_in_provider: "anonymous" } }).firestore());

// ── 로그인 안 함 / 허용 안 된 계정: 전부 거부
for (const c of ["roster", "attendance", "photos", "smsQueue"]) {
  await check(`비로그인: ${c} 읽기 거부`, unauth.get(c, "seed"), false);
  await check(`비로그인: ${c} 쓰기 거부`, unauth.set(c, "new", { a: 1 }), false);
  await check(`허용 안 된 구글 계정: ${c} 읽기 거부`, stranger.get(c, "seed"), false);
  await check(`허용 안 된 구글 계정: ${c} 쓰기 거부`, stranger.set(c, "new", { a: 1 }), false);
}
await check("이메일 미인증 구글 계정: roster 읽기 거부", unverifiedGoogle.get("roster", "seed"), false);
await check("익명 로그인: roster 읽기 거부", anon.get("roster", "seed"), false);

// ── 직원(이메일/비밀번호): 일반 컬렉션 읽기·쓰기 허용
for (const c of STAFF_COLLECTIONS) {
  await check(`직원: ${c} 읽기`, staff.get(c, "seed"), true);
  await check(`직원: ${c} 목록 조회`, staff.list(c), true);
  await check(`직원: ${c} 생성`, staff.set(c, `staff_${c}`, { a: 1 }), true);
  await check(`직원: ${c} 수정`, staff.update(c, "seed", { b: 2 }), true);
  await check(`직원: ${c} 삭제`, staff.del(c, "seed2"), true);
}
// ── 직원: 출결·상담은 읽기/생성/수정만, 문서 삭제는 거부
for (const c of ["attendance", "counseling"]) {
  await check(`직원: ${c} 읽기`, staff.get(c, "seed"), true);
  await check(`직원: ${c} 생성`, staff.set(c, `staff_${c}`, { logs: [] }), true);
  await check(`직원: ${c} 수정(덮어쓰기)`, staff.set(c, "seed", { logs: [{ id: "x" }] }), true);
  await check(`직원: ${c} 수정(update)`, staff.update(c, "seed", { memo: "m" }), true);
  await check(`직원: ${c} 문서 삭제 거부`, staff.del(c, "seed"), false);
}
// ── 관리자(허용된 구글, 대소문자 달라도): 출결·상담 문서 삭제 허용 + 일반 작업 허용
await check("관리자: attendance 문서 삭제", admin.del("attendance", "seed"), true);
await check("관리자: counseling 문서 삭제", admin.del("counseling", "seed"), true);
await check("관리자: roster 읽기", admin.get("roster", "seed"), true);
await check("관리자: photos 쓰기", admin.set("photos", "p1", { photo: "x" }), true);
// ── 규칙에 없는 컬렉션은 직원·관리자도 거부
await check("직원: 규칙에 없는 컬렉션(payments) 읽기 거부", staff.get("payments", "seed"), false);
await check("관리자: 규칙에 없는 컬렉션(payments) 쓰기 거부", admin.set("payments", "x", { a: 1 }), false);

await env.cleanup();
for (const r of results) console.log(`${r.ok ? "✔" : "✘"} ${r.name}${r.detail ? "  — " + r.detail : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `ALL ${results.length} RULES TESTS PASSED` : `${failed} RULES TEST(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
