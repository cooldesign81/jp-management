// firestore.rules(반포·대치)와 firestore.pyeongchon.rules(평촌)를 Firestore 에뮬레이터에서 검증하는 테스트
// 실행: tools 폴더에서  npm install  후  npm run test:rules
import fs from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";

const RULE_FILES = [
  { label: "반포·대치", file: new URL("../firestore.rules", import.meta.url), pyeongchon: false },
  { label: "평촌", file: new URL("../firestore.pyeongchon.rules", import.meta.url), pyeongchon: true },
];

const APP_COLLECTIONS = ["roster", "photos", "overrides", "additions", "manualRooms", "smsTemplates", "settings", "listMemos", "dayLogs", "makeupOpenings", "bookingSettings"];
const PAYMENT_COLLECTIONS = ["centers", "userCenters"];

// compat / modular 양쪽 SDK 모두 지원하는 얇은 래퍼
async function api(db) {
  if (typeof db.collection === "function") {
    return {
      get: (c, id) => db.collection(c).doc(id).get(),
      set: (c, id, v) => db.collection(c).doc(id).set(v),
      update: (c, id, v) => db.collection(c).doc(id).update(v),
      del: (c, id) => db.collection(c).doc(id).delete(),
      list: (c) => db.collection(c).get(),
      add: (c, v) => db.collection(c).add(v),
      now: async () => { const fb = (await import("firebase/compat/app")).default; await import("firebase/compat/firestore"); return fb.firestore.FieldValue.serverTimestamp(); },
    };
  }
  const m = await import("firebase/firestore");
  return {
    get: (c, id) => m.getDoc(m.doc(db, c, id)),
    set: (c, id, v) => m.setDoc(m.doc(db, c, id), v),
    update: (c, id, v) => m.updateDoc(m.doc(db, c, id), v),
    del: (c, id) => m.deleteDoc(m.doc(db, c, id)),
    list: (c) => m.getDocs(m.collection(db, c)),
    add: (c, v) => m.addDoc(m.collection(db, c), v),
    now: async () => m.serverTimestamp(),
  };
}

const google = (email, verified = true) => ({ email, email_verified: verified, firebase: { sign_in_provider: "google.com" } });
const password = (email) => ({ email, firebase: { sign_in_provider: "password" } });
const staffDoc = (email, role, extra = {}) => ({ email, name: "테스트", role, addedAt: 1, addedBy: "x", updatedAt: 1, updatedBy: "x", ...extra });

const results = [];
async function check(name, promise, expectOk) {
  try {
    if (expectOk) await assertSucceeds(promise); else await assertFails(promise);
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e && e.message ? e.message : e).slice(0, 200) });
  }
}

for (const rf of RULE_FILES) {
  const P = `[${rf.label}]`;
  const env = await initializeTestEnvironment({
    projectId: rf.pyeongchon ? "demo-jp-pc" : "demo-jp",
    firestore: { rules: fs.readFileSync(rf.file, "utf8") },
  });

  // 시드 데이터 (규칙 무시하고 직접 넣음)
  await env.withSecurityRulesDisabled(async (ctx) => {
    const a = await api(ctx.firestore());
    for (const c of [...APP_COLLECTIONS, "attendance", "counseling", "smsQueue", "payments", "surveyResponses", ...PAYMENT_COLLECTIONS]) {
      for (const id of ["seed", "seed2", "seed3"]) await a.set(c, id, { seeded: true, records: [], logs: [] });
    }
    await a.set("staff", "teacher@gmail.com", staffDoc("teacher@gmail.com", "teacher"));
    await a.set("staff", "subadmin@gmail.com", staffDoc("subadmin@gmail.com", "admin"));
    await a.set("staff", "shared-admin@jarada.kr", staffDoc("shared-admin@jarada.kr", "admin", { login: "password" }));
    await a.set("staff", "jarada-banpo@naver.com", staffDoc("jarada-banpo@naver.com", "teacher", { login: "password" }));
    await a.set("staff", "legacy-admin@jarada.kr", staffDoc("legacy-admin@jarada.kr", "admin")); // 예전 방식(로그인 방식 없음)으로 등록된 비밀번호 계정
    await a.set("staff", "victim@gmail.com", staffDoc("victim@gmail.com", "teacher"));
  });

  const as = async (uid, token) => api(token ? env.authenticatedContext(uid, token).firestore() : env.unauthenticatedContext().firestore());
  const unauth = await as("none", null);
  const superAdmin = await as("sa", google("JinHyuck@gmail.com"));      // 대소문자 달라도 최고 관리자
  const teacher = await as("t1", google("teacher@gmail.com"));           // 직원 목록: 교사
  const teacherUpper = await as("t2", google("Teacher@Gmail.com"));     // 같은 교사, 대문자 이메일 토큰
  const subAdmin = await as("a1", google("subadmin@gmail.com"));         // 직원 목록: 관리자
  const stranger = await as("x1", google("stranger@gmail.com"));         // 목록에 없음
  const unverified = await as("x2", google("teacher@gmail.com", false)); // 이메일 미인증 구글
  const fakeSuper = await as("x3", password("jinhyuck@gmail.com"));      // 비밀번호 계정으로 최고 관리자 흉내
  const sharedPw = await as("p1", password("jarada-banpo@naver.com"));   // 공용 비밀번호 계정 (목록: 이메일·비밀번호, 교사)
  const sharedAdminPw = await as("p2", password("shared-admin@jarada.kr")); // 공용 비밀번호 계정 (목록: 이메일·비밀번호, 관리자)
  const unlistedPw = await as("p3", password("random@naver.com"));       // 가입으로 아무나 만든 비밀번호 계정 (목록 없음)
  const impersonatePw = await as("p4", password("teacher@gmail.com"));   // 구글로 등록된 교사 이메일로 만든 비밀번호 계정
  const legacyAdminPw = await as("p5", password("legacy-admin@jarada.kr")); // 목록에 있지만 로그인 방식이 구글(기본)인 비밀번호 계정
  const payPc = await as("m1", password("jarada_boys@naver.com"));       // 결제 매니저 평촌 계정 (스케줄 직원 목록에는 없음)
  const payDc = await as("m2", password("Jarada-Daechi@naver.com"));     // 결제 매니저 대치 계정 (대문자 이메일 토큰)
  const payAsGoogle = await as("m3", google("jarada_boys@naver.com"));   // 결제 매니저 이메일이지만 구글 로그인
  const anon = await as("x4", { firebase: { sign_in_provider: "anonymous" } });

  // ── 들어올 수 없는 사람: 앱 데이터 전부 거부
  for (const [who, db] of [["비로그인", unauth], ["목록에 없는 구글", stranger], ["이메일 미인증 구글", unverified], ["익명 로그인", anon]]) {
    for (const c of ["roster", "attendance", "photos", "additions"]) {
      await check(`${P} ${who}: ${c} 읽기 거부`, db.get(c, "seed"), false);
      await check(`${P} ${who}: ${c} 쓰기 거부`, db.set(c, "new", { a: 1 }), false);
    }
    await check(`${P} ${who}: 직원 목록 조회 거부`, db.list("staff"), false);
  }
  // 목록에 없는 구글 계정도 "내 문서"는 확인 가능 (앱이 등록 여부를 알려주려고 씀), 남의 문서는 거부
  await check(`${P} 목록에 없는 구글: 내 직원 문서 확인 허용`, stranger.get("staff", "stranger@gmail.com"), true);
  await check(`${P} 목록에 없는 구글: 남의 직원 문서 거부`, stranger.get("staff", "teacher@gmail.com"), false);
  await check(`${P} 목록에 없는 구글: 자기 자신 등록 거부`, stranger.set("staff", "stranger@gmail.com", staffDoc("stranger@gmail.com", "teacher")), false);
  await check(`${P} 비로그인: 직원 문서 확인 거부`, unauth.get("staff", "teacher@gmail.com"), false);

  // ── 교사(목록에 있는 구글): 앱 데이터 읽기·쓰기 허용
  for (const c of APP_COLLECTIONS) {
    await check(`${P} 교사: ${c} 읽기`, teacher.get(c, "seed"), true);
    await check(`${P} 교사: ${c} 목록`, teacher.list(c), true);
    await check(`${P} 교사: ${c} 생성`, teacher.set(c, "t_new", { a: 1 }), true);
    await check(`${P} 교사: ${c} 수정`, teacher.update(c, "seed", { b: 2 }), true);
    await check(`${P} 교사: ${c} 삭제`, teacher.del(c, "seed2"), true);
  }
  for (const c of ["attendance", "counseling"]) {
    await check(`${P} 교사: ${c} 읽기`, teacher.get(c, "seed"), true);
    await check(`${P} 교사: ${c} 생성`, teacher.set(c, "t_new", { logs: [] }), true);
    await check(`${P} 교사: ${c} 덮어쓰기`, teacher.set(c, "seed", { logs: [{ id: "x" }] }), true);
    await check(`${P} 교사: ${c} 문서 삭제 거부`, teacher.del(c, "seed"), false);
  }
  await check(`${P} 교사: smsQueue 등록`, teacher.set("smsQueue", "q1", { a: 1 }), true);
  await check(`${P} 교사: smsQueue 취소(삭제)`, teacher.del("smsQueue", "seed2"), true);
  await check(`${P} 교사(대문자 이메일): roster 읽기`, teacherUpper.get("roster", "seed"), true);
  await check(`${P} 교사: 직원 목록 조회`, teacher.list("staff"), true);
  await check(`${P} 교사: 내 직원 문서 확인`, teacher.get("staff", "teacher@gmail.com"), true);
  await check(`${P} 교사: 직원 추가 거부`, teacher.set("staff", "new@gmail.com", staffDoc("new@gmail.com", "teacher")), false);
  await check(`${P} 교사: 자기를 관리자로 승격 거부`, teacher.set("staff", "teacher@gmail.com", staffDoc("teacher@gmail.com", "admin")), false);
  await check(`${P} 교사: 다른 교사 삭제 거부`, teacher.del("staff", "victim@gmail.com"), false);

  // ── 가입을 켜 둬도 목록에 없는 비밀번호 계정은 앱 데이터 전부 거부
  for (const [who, db] of [["목록에 없는 비밀번호 계정", unlistedPw], ["교사 구글 이메일로 만든 비밀번호 계정", impersonatePw], ["로그인 방식이 구글인 목록의 비밀번호 계정", legacyAdminPw]]) {
    for (const c of ["roster", "attendance", "counseling", "photos", "settings"]) {
      await check(`${P} ${who}: ${c} 읽기 거부`, db.get(c, "seed"), false);
      await check(`${P} ${who}: ${c} 쓰기 거부`, db.set(c, "new", { a: 1 }), false);
    }
    await check(`${P} ${who}: 직원 목록 조회 거부`, db.list("staff"), false);
    await check(`${P} ${who}: 직원 추가 거부`, db.set("staff", "evil@gmail.com", staffDoc("evil@gmail.com", "admin")), false);
  }
  await check(`${P} 교사 이메일로 만든 비밀번호 계정: 자기 문서를 비밀번호 방식으로 바꾸기 거부`, impersonatePw.set("staff", "teacher@gmail.com", staffDoc("teacher@gmail.com", "teacher", { login: "password" })), false);
  await check(`${P} 로그인 방식이 구글인 목록의 비밀번호 관리자: attendance 삭제 거부`, legacyAdminPw.del("attendance", "seed3"), false);

  // ── 목록에 "이메일·비밀번호"로 등록된 공용 계정: 교사
  await check(`${P} 공용 비밀번호 계정: roster 읽기`, sharedPw.get("roster", "seed"), true);
  await check(`${P} 공용 비밀번호 계정: attendance 쓰기`, sharedPw.set("attendance", "pw", { logs: [] }), true);
  await check(`${P} 공용 비밀번호 계정: attendance 삭제 거부`, sharedPw.del("attendance", "seed"), false);
  await check(`${P} 공용 비밀번호 계정: 직원 추가 거부`, sharedPw.set("staff", "new@gmail.com", staffDoc("new@gmail.com", "teacher")), false);
  await check(`${P} 비밀번호 계정으로 최고 관리자 흉내: 직원 추가 거부`, fakeSuper.set("staff", "new@gmail.com", staffDoc("new@gmail.com", "teacher")), false);
  await check(`${P} 비밀번호 계정으로 최고 관리자 흉내: attendance 삭제 거부`, fakeSuper.del("attendance", "seed"), false);

  // ── 최고 관리자: 직원 관리 + 관리자 삭제 권한
  await check(`${P} 최고 관리자: roster 읽기`, superAdmin.get("roster", "seed"), true);
  await check(`${P} 최고 관리자: 교사 추가`, superAdmin.set("staff", "new@gmail.com", staffDoc("new@gmail.com", "teacher")), true);
  await check(`${P} 최고 관리자: 관리자 추가`, superAdmin.set("staff", "boss@gmail.com", staffDoc("boss@gmail.com", "admin")), true);
  await check(`${P} 최고 관리자: 역할 변경`, superAdmin.set("staff", "new@gmail.com", staffDoc("new@gmail.com", "admin")), true);
  await check(`${P} 최고 관리자: 직원 삭제`, superAdmin.del("staff", "new@gmail.com"), true);
  await check(`${P} 최고 관리자: attendance 문서 삭제`, superAdmin.del("attendance", "seed"), true);
  await check(`${P} 최고 관리자: counseling 문서 삭제`, superAdmin.del("counseling", "seed"), true);
  // 잘못된 직원 문서는 최고 관리자도 거부
  await check(`${P} 직원 문서: 이메일 필드와 문서 ID 불일치 거부`, superAdmin.set("staff", "a@gmail.com", staffDoc("b@gmail.com", "teacher")), false);
  await check(`${P} 직원 문서: 대문자 문서 ID 거부`, superAdmin.set("staff", "Upper@gmail.com", staffDoc("Upper@gmail.com", "teacher")), false);
  await check(`${P} 직원 문서: 없는 역할 거부`, superAdmin.set("staff", "c@gmail.com", staffDoc("c@gmail.com", "owner")), false);
  await check(`${P} 직원 문서: 모르는 필드 거부`, superAdmin.set("staff", "d@gmail.com", staffDoc("d@gmail.com", "teacher", { isRoot: true })), false);
  await check(`${P} 직원 문서: 로그인 방식 password 허용`, superAdmin.set("staff", "shared2@naver.com", staffDoc("shared2@naver.com", "teacher", { login: "password" })), true);
  await check(`${P} 직원 문서: 로그인 방식 google 허용`, superAdmin.set("staff", "g2@gmail.com", staffDoc("g2@gmail.com", "teacher", { login: "google" })), true);
  await check(`${P} 직원 문서: 없는 로그인 방식 거부`, superAdmin.set("staff", "h@gmail.com", staffDoc("h@gmail.com", "teacher", { login: "sms" })), false);
  await check(`${P} 직원 문서: 이름 40자 초과 거부`, superAdmin.set("staff", "e@gmail.com", staffDoc("e@gmail.com", "teacher", { name: "가".repeat(41) })), false);

  // ── 목록에서 관리자인 구글 계정
  await check(`${P} 목록 관리자: attendance 문서 삭제`, subAdmin.del("attendance", "seed2"), true);
  await check(`${P} 목록 관리자: 교사 추가`, subAdmin.set("staff", "f@gmail.com", staffDoc("f@gmail.com", "teacher")), true);
  await check(`${P} 목록 관리자: 다른 직원 삭제`, subAdmin.del("staff", "f@gmail.com"), true);
  await check(`${P} 목록 관리자: 자기 자신 삭제 거부 (잠김 방지)`, subAdmin.del("staff", "subadmin@gmail.com"), false);
  await check(`${P} 목록 관리자: 자기 자신을 교사로 강등 거부 (잠김 방지)`, subAdmin.set("staff", "subadmin@gmail.com", staffDoc("subadmin@gmail.com", "teacher")), false);
  // ── 비밀번호 계정 + 목록에서 관리자
  await check(`${P} 비밀번호 관리자: counseling 문서 삭제`, sharedAdminPw.del("counseling", "seed2"), true);
  await check(`${P} 비밀번호 관리자: 교사 추가`, sharedAdminPw.set("staff", "g@gmail.com", staffDoc("g@gmail.com", "teacher")), true);

  // ── 삭제된 교사는 바로 막힘
  await env.withSecurityRulesDisabled(async (ctx) => { const a = await api(ctx.firestore()); await a.del("staff", "victim@gmail.com"); });
  const removed = await as("v1", google("victim@gmail.com"));
  await check(`${P} 목록에서 삭제된 교사: roster 읽기 거부`, removed.get("roster", "seed"), false);

  // ── 규칙에 없는 컬렉션, 결제 매니저 컬렉션
  await check(`${P} 교사: 규칙에 없는 컬렉션(payments) 읽기 거부`, teacher.get("payments", "seed"), false);
  await check(`${P} 최고 관리자: 규칙에 없는 컬렉션(payments) 쓰기 거부`, superAdmin.set("payments", "x", { a: 1 }), false);
  for (const c of PAYMENT_COLLECTIONS) {
    if (rf.pyeongchon) {
      await check(`${P} 결제 매니저 평촌 계정: ${c} 읽기`, payPc.get(c, "seed"), true);
      await check(`${P} 결제 매니저 평촌 계정: ${c} 하위 컬렉션 쓰기`, payPc.set(`${c}/seed/data`, "roster", { rows: [] }), true);
      await check(`${P} 결제 매니저 대치 계정(대문자 토큰): ${c} 읽기`, payDc.get(c, "seed"), true);
      await check(`${P} 최고 관리자: 결제 매니저 ${c} 읽기`, superAdmin.get(c, "seed"), true);
      for (const [who, db] of [["목록에 없는 구글", stranger], ["가입으로 만든 비밀번호 계정", unlistedPw], ["스케줄 매니저 교사", teacher], ["결제 매니저 목록에 없는 스케줄 공용 비밀번호 계정", sharedAdminPw], ["결제 매니저 이메일의 구글 로그인", payAsGoogle], ["비로그인", unauth]]) {
        await check(`${P} ${who}: 결제 매니저 ${c} 읽기 거부`, db.get(c, "seed"), false);
        await check(`${P} ${who}: 결제 매니저 ${c} 하위 컬렉션 쓰기 거부`, db.set(`${c}/seed/sub`, "x", { a: 1 }), false);
      }
    } else {
      await check(`${P} 교사: ${c}(평촌 전용) 거부`, teacher.get(c, "seed"), false);
      await check(`${P} 결제 매니저 계정 이메일이어도 ${c} 거부 (평촌 전용)`, payPc.get(c, "seed"), false);
    }
  }
  // ── 업무 도구 설문: 로그인 없이 응답 추가만, 읽기·지우기는 관리자만
  {
    const resp = async (db, extra = {}, answers = {}) => ({ survey: "jarvis-2026-10", v: 1, createdAt: await db.now(), answers: { center: "평촌원", overall: 5, features: { bulk: 5, rotate: "na" }, best: ["사진 회전"], pain: "좋아요", ...answers }, ...extra });
    await check(`${P} 비로그인: 설문 응답 추가`, unauth.add("surveyResponses", await resp(unauth)), true);
    await check(`${P} 교사: 설문 응답 추가`, teacher.add("surveyResponses", await resp(teacher)), true);
    await check(`${P} 비로그인: 설문 응답에 다른 칸(email) 넣으면 거부`, unauth.add("surveyResponses", await resp(unauth, { email: "a@b.c" })), false);
    await check(`${P} 비로그인: 응답 시각을 마음대로 넣으면 거부`, unauth.add("surveyResponses", { ...(await resp(unauth)), createdAt: new Date(0) }), false);
    await check(`${P} 비로그인: 서술형 2000자 넘으면 거부`, unauth.add("surveyResponses", await resp(unauth, {}, { pain: "가".repeat(2001) })), false);
    await check(`${P} 비로그인: 설문 id 없으면 거부`, unauth.add("surveyResponses", { v: 1, createdAt: await unauth.now(), answers: {} }), false);
    await check(`${P} 비로그인: 설문 응답 읽기 거부`, unauth.list("surveyResponses"), false);
    await check(`${P} 교사: 설문 응답 읽기 거부`, teacher.list("surveyResponses"), false);
    await check(`${P} 목록에 없는 구글: 설문 응답 읽기 거부`, stranger.list("surveyResponses"), false);
    await check(`${P} 관리자: 설문 응답 읽기`, subAdmin.list("surveyResponses"), true);
    await check(`${P} 최고 관리자: 설문 응답 읽기`, superAdmin.list("surveyResponses"), true);
    await check(`${P} 교사: 설문 응답 지우기 거부`, teacher.del("surveyResponses", "seed"), false);
    await check(`${P} 비로그인: 설문 응답 고치기 거부`, unauth.update("surveyResponses", "seed", { survey: "x" }), false);
    await check(`${P} 관리자: 설문 응답 고치기도 거부`, subAdmin.update("surveyResponses", "seed", { survey: "x" }), false);
    await check(`${P} 관리자: 설문 응답 지우기`, subAdmin.del("surveyResponses", "seed"), true);
  }
  if (rf.pyeongchon) {
    await check(`${P} 결제 매니저 계정: smsQueue 등록`, payPc.set("smsQueue", "pm1", { a: 1 }), true);
    await check(`${P} 결제 매니저 계정: smsQueue 취소(수정)`, payDc.update("smsQueue", "seed", { status: "cancelled" }), true);
    await check(`${P} 결제 매니저 계정: 스케줄 데이터(roster) 거부`, payPc.get("roster", "seed"), false);
    await check(`${P} 결제 매니저 계정: 출결(attendance) 거부`, payDc.get("attendance", "seed"), false);
    await check(`${P} 교사: smsQueue 등록 (스케줄 매니저)`, teacher.set("smsQueue", "t1", { a: 1 }), true);
    await check(`${P} 목록에 없는 구글: smsQueue 거부`, stranger.set("smsQueue", "x1", { a: 1 }), false);
    await check(`${P} 가입으로 만든 비밀번호 계정: smsQueue 거부`, unlistedPw.get("smsQueue", "seed"), false);
    await check(`${P} 비로그인: smsQueue 거부`, unauth.get("smsQueue", "seed"), false);
  } else {
    await check(`${P} 목록에 없는 구글: smsQueue 거부`, stranger.set("smsQueue", "pm1", { a: 1 }), false);
    await check(`${P} 결제 매니저 계정 이메일이어도 smsQueue 거부 (평촌 전용)`, payPc.set("smsQueue", "pm2", { a: 1 }), false);
  }

  await env.cleanup();
}

for (const r of results) console.log(`${r.ok ? "✔" : "✘"} ${r.name}${r.detail ? "  — " + r.detail : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `ALL ${results.length} RULES TESTS PASSED` : `${failed} RULES TEST(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
