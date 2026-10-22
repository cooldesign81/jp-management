// storage.rules 를 Storage + Firestore 에뮬레이터에서 검증하는 테스트 (직원 확인은 Firestore staff 문서로 함)
// 실행: tools 폴더에서  npm install  후  npm run test:storage-rules
import fs from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";

const env = await initializeTestEnvironment({
  projectId: "demo-jp",
  firestore: { rules: fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  storage: { rules: fs.readFileSync(new URL("../storage.rules", import.meta.url), "utf8") },
});

const google = (email, verified = true) => ({ email, email_verified: verified, firebase: { sign_in_provider: "google.com" } });
const password = (email) => ({ email, firebase: { sign_in_provider: "password" } });
const staffDoc = (email, role, extra = {}) => ({ email, name: "테스트", role, addedAt: 1, addedBy: "x", updatedAt: 1, updatedBy: "x", ...extra });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const KEY = "010-1234-5678__홍길동";

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await db.collection("staff").doc("teacher@gmail.com").set(staffDoc("teacher@gmail.com", "teacher"));
  await db.collection("staff").doc("jarada-banpo@naver.com").set(staffDoc("jarada-banpo@naver.com", "teacher", { login: "password" }));
  await db.collection("staff").doc("legacy-admin@jarada.kr").set(staffDoc("legacy-admin@jarada.kr", "admin"));
  const st = ctx.storage();
  await st.ref(`studentDocs/${KEY}/counsel_seed.jpg`).put(JPEG, { contentType: "image/jpeg" });
  await st.ref(`studentDocs/${KEY}/survey_seed.jpg`).put(JPEG, { contentType: "image/jpeg" });
  await st.ref("other/seed.jpg").put(JPEG, { contentType: "image/jpeg" });
});

const results = [];
async function check(name, fn, expectOk) {
  try {
    if (expectOk) await assertSucceeds(fn()); else await assertFails(fn());
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e && e.message ? e.message : e).slice(0, 200) });
  }
}
const st = (uid, token) => (token ? env.authenticatedContext(uid, token) : env.unauthenticatedContext()).storage();
const people = {
  superAdmin: st("sa", google("JinHyuck@gmail.com")),
  teacher: st("t1", google("teacher@gmail.com")),
  teacherUpper: st("t2", google("Teacher@Gmail.com")),
  sharedPw: st("p1", password("jarada-banpo@naver.com")),
  unauth: st("none", null),
  stranger: st("x1", google("stranger@gmail.com")),
  unverified: st("x2", google("teacher@gmail.com", false)),
  fakeSuper: st("x3", password("jinhyuck@gmail.com")),
  impersonatePw: st("p4", password("teacher@gmail.com")),
  legacyPw: st("p5", password("legacy-admin@jarada.kr")),
  payPc: st("m1", password("jarada_boys@naver.com")),
  anon: st("x4", { firebase: { sign_in_provider: "anonymous" } }),
};
const up = (s, name, data = JPEG, type = "image/jpeg") => () => s.ref(`studentDocs/${KEY}/${name}`).put(data, { contentType: type });
const read = (s, name = "counsel_seed.jpg") => () => s.ref(`studentDocs/${KEY}/${name}`).getDownloadURL();
const meta = (s, name = "counsel_seed.jpg") => () => s.ref(`studentDocs/${KEY}/${name}`).getMetadata();

// 직원: 보기·올리기·지우기 허용
for (const who of ["superAdmin", "teacher", "teacherUpper", "sharedPw"]) {
  const s = people[who];
  await check(`${who}: 서류 사진 주소 받기`, read(s), true);
  await check(`${who}: 서류 사진 정보 보기`, meta(s), true);
  await check(`${who}: 서류 사진 올리기`, up(s, `counsel_${who}.jpg`), true);
  await check(`${who}: 서류 사진 지우기`, () => s.ref(`studentDocs/${KEY}/counsel_${who}.jpg`).delete(), true);
}
// 직원이어도 막는 것
const t = people.teacher;
await check("교사: 이미지가 아닌 파일 거부", up(t, "x.pdf", JPEG, "application/pdf"), false);
await check("교사: 3MB 넘는 파일 거부", up(t, "big.jpg", new Uint8Array(3 * 1024 * 1024 + 10)), false);
await check("교사: 같은 이름으로 덮어쓰기 거부", up(t, "counsel_seed.jpg"), false);
await check("교사: studentDocs 밖의 경로 읽기 거부", () => t.ref("other/seed.jpg").getDownloadURL(), false);
await check("교사: studentDocs 밖의 경로 쓰기 거부", () => t.ref("other/new.jpg").put(JPEG, { contentType: "image/jpeg" }), false);
await check("교사: 학생 폴더 바로 아래가 아닌 깊은 경로 거부", () => t.ref(`studentDocs/${KEY}/a/b.jpg`).put(JPEG, { contentType: "image/jpeg" }), false);
// 직원 아님: 전부 거부
for (const who of ["unauth", "stranger", "unverified", "fakeSuper", "impersonatePw", "legacyPw", "payPc", "anon"]) {
  const s = people[who];
  await check(`${who}: 서류 사진 주소 받기 거부`, read(s), false);
  await check(`${who}: 서류 사진 정보 보기 거부`, meta(s), false);
  await check(`${who}: 서류 사진 올리기 거부`, up(s, `x_${who}.jpg`), false);
  await check(`${who}: 서류 사진 지우기 거부`, () => s.ref(`studentDocs/${KEY}/survey_seed.jpg`).delete(), false);
}

await env.cleanup();
for (const r of results) console.log(`${r.ok ? "✔" : "✘"} ${r.name}${r.detail ? "  — " + r.detail : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `ALL ${results.length} STORAGE RULES TESTS PASSED` : `${failed} STORAGE RULES TEST(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
