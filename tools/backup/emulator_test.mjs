// backup.mjs / restore.mjs 를 Firestore·Storage 에뮬레이터로 검증
// 실행: tools/backup 에서 npm install 후, tools 폴더에서
//   npx firebase emulators:exec --only firestore,storage --project demo-jp-src "node backup/emulator_test.mjs"
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, GeoPoint } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const HERE = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("에뮬레이터 안에서 실행하세요");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jp-backup-test-"));
const out = path.join(tmp, "nas");
const SRC = { id: "banpo", name: "반포원", projectId: "demo-jp-src", bucket: "demo-jp-src.firebasestorage.app" };
const DST = { id: "newpc", name: "새 평촌", projectId: "demo-jp-dst", bucket: "demo-jp-dst.firebasestorage.app" };
const cfgFile = path.join(tmp, "config.json");
fs.writeFileSync(cfgFile, JSON.stringify({ outputDir: out, keepDailyDays: 30, centers: [SRC, DST] }));
const run = (script, extra) => spawnSync(process.execPath, [path.join(HERE, script), "--config", cfgFile, ...extra], { encoding: "utf8", input: "" });

const src = initializeApp({ projectId: SRC.projectId, storageBucket: SRC.bucket }, "src");
const sdb = getFirestore(src); const sb = getStorage(src).bucket(SRC.bucket);
const dst = initializeApp({ projectId: DST.projectId, storageBucket: DST.bucket }, "dst");
const ddb = getFirestore(dst); const db2 = getStorage(dst).bucket(DST.bucket);

// ── 시드 데이터
const KEY = "010-8773-5131__김승효";
await sdb.doc("roster/current").set({ rows: [{ 원생명: "김승효", 연락처: "010-8773-5131" }], uploadedAt: 1 });
await sdb.doc(`attendance/${KEY}`).set({ logs: [{ id: "a", type: "absent", date: "2026-10-20" }], when: Timestamp.fromMillis(1760000000123), where: new GeoPoint(37.5, 127.0), who: sdb.doc("staff/teacher@gmail.com"), raw: Buffer.from([1, 2, 3, 250]), weird: { __t: "user-field", n: NaN }, nested: [{ t: Timestamp.fromMillis(5) }] });
for (let i = 0; i < 120; i++) await sdb.doc(`overrides/2026-10-${String(1 + (i % 28)).padStart(2, "0")}::${i}`).set({ tag: "absent", i });
await sdb.doc(`studentDocs/${KEY}`).set({ name: "김승효", slots: { counsel: { path: `studentDocs/${KEY}/counsel_1.jpg`, size: 4 }, survey: null } });
await sdb.doc("centers/c1").set({ name: "평촌" });
await sdb.doc("centers/c1/weeks/w1").set({ total: 10 });
await sdb.doc("centers/c1/weeks/w1/days/d1").set({ deep: true });
await sdb.doc("userCenters/u1/items/i1").set({ phantomParent: true }); // 부모 문서 없이 하위 컬렉션만 있음
await sdb.doc("settings/privacy").set({ students: { [KEY]: { hidden: true } } });
const put = (name, data, meta = {}) => sb.file(name).save(Buffer.from(data), { resumable: false, contentType: "image/jpeg", metadata: { cacheControl: "private, max-age=31536000", metadata: meta } });
await put(`studentDocs/${KEY}/counsel_1.jpg`, "JPEG-1", { slot: "counsel", by: "김선생" });
await put(`studentDocs/${KEY}/survey_2.jpg`, "JPEG-22");
await put("studentDocs/odd:name?/a*b.jpg", "JPEG-odd"); // 윈도우에서 못 쓰는 글자

// ── 1. 첫 백업
let r = run("backup.mjs", ["--date", "2026-10-20", "--only", "banpo"]);
check("백업 1: 성공 (종료 코드 0)", r.status === 0, r.stdout + r.stderr);
const day1 = path.join(out, "banpo", "daily", "2026-10-20");
const sum1 = JSON.parse(fs.readFileSync(path.join(day1, "summary.json"), "utf8"));
check("백업 1: 컬렉션별 문서 수 (하위 컬렉션·부모 없는 하위 문서 포함)", sum1.firestore.collections.overrides === 120 && sum1.firestore.collections.centers === 3 && sum1.firestore.collections.userCenters === 1 && sum1.firestore.collections.attendance === 1 && sum1.firestore.collections.studentDocs === 1, JSON.stringify(sum1.firestore));
const centersLines = fs.readFileSync(path.join(day1, "firestore", "centers.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l).p).sort();
check("백업 1: 하위 컬렉션 경로 그대로 (centers/c1/weeks/w1/days/d1)", JSON.stringify(centersLines) === JSON.stringify(["centers/c1", "centers/c1/weeks/w1", "centers/c1/weeks/w1/days/d1"]), JSON.stringify(centersLines));
check("백업 1: 서류 사진 3개 받음 (윈도우 금지 글자는 바꾼 이름으로)", sum1.storage.files === 3 && sum1.storage.downloaded === 3 && fs.existsSync(path.join(out, "banpo", "storage", "studentDocs", KEY, "counsel_1.jpg")) && fs.readdirSync(path.join(out, "banpo", "storage", "studentDocs")).some((n) => n.startsWith("odd_name_")), JSON.stringify(sum1.storage));
const status1 = fs.readFileSync(path.join(out, "LAST_STATUS.txt"), "utf8");
check("백업 1: LAST_STATUS.txt 에 성공 표시", status1.startsWith("✅ 백업 성공") && status1.includes("반포원: 문서 ") && status1.includes("서류 사진 3개"), status1);
check("백업 1: 끝난 뒤 .partial 폴더 없음 + 로그 남김", !fs.existsSync(day1 + ".partial") && fs.readFileSync(path.join(out, "backup-log.txt"), "utf8").includes("백업 끝 — 모두 성공"));

// ── 2. 다음 날: 바뀐 사진만 새로 받음
await put(`studentDocs/${KEY}/survey_2.jpg`, "JPEG-22-changed");
r = run("backup.mjs", ["--date", "2026-10-21", "--only", "banpo"]);
const sum2 = JSON.parse(fs.readFileSync(path.join(out, "banpo", "daily", "2026-10-21", "summary.json"), "utf8"));
check("백업 2: 바뀐 사진 1개만 새로 받음", r.status === 0 && sum2.storage.files === 3 && sum2.storage.downloaded === 1 && fs.readFileSync(path.join(out, "banpo", "storage", "studentDocs", KEY, "survey_2.jpg"), "utf8") === "JPEG-22-changed", JSON.stringify(sum2.storage));

// ── 3. 보관 정리: 최근 30일 + 매월 1일
for (const d of ["2026-08-01", "2026-08-15", "2026-09-21", "2026-09-22", "2026-10-19.partial"]) fs.mkdirSync(path.join(out, "banpo", "daily", d), { recursive: true });
r = run("backup.mjs", ["--date", "2026-10-22", "--only", "banpo"]);
const left = fs.readdirSync(path.join(out, "banpo", "daily")).sort();
check("보관 정리: 30일 지난 것은 1일 것만 남기고, 끝나지 못한 .partial 은 지움", r.status === 0 && JSON.stringify(left) === JSON.stringify(["2026-08-01", "2026-09-22", "2026-10-20", "2026-10-21", "2026-10-22"]), JSON.stringify(left));

// ── 4. 복원: 새 프로젝트로 (평촌 DB 분리 연습)
const day3 = path.join(out, "banpo", "daily", "2026-10-22");
r = run("restore.mjs", ["--from", day3, "--to", "newpc", "--dry-run"]);
check("복원 dry-run: 아무것도 안 씀", r.status === 0 && r.stdout.includes("--dry-run") && (await ddb.collection("overrides").limit(1).get()).empty, r.stdout + r.stderr);
r = spawnSync(process.execPath, [path.join(HERE, "restore.mjs"), "--config", cfgFile, "--from", day3, "--to", "newpc"], { encoding: "utf8", input: "demo-jp-wrong\n" });
check("복원: 프로젝트 id 를 틀리게 입력하면 멈춤", r.status !== 0 && (r.stderr + r.stdout).includes("입력이 달라서 멈췄어요") && (await ddb.collection("overrides").limit(1).get()).empty, r.stdout + r.stderr);
r = spawnSync(process.execPath, [path.join(HERE, "restore.mjs"), "--config", cfgFile, "--from", day3, "--to", "newpc", "--exclude", "centers"], { encoding: "utf8", input: "demo-jp-dst\n" });
check("복원: 프로젝트 id 를 맞게 입력하면 진행", r.status === 0 && r.stdout.includes("✅ Firestore 문서") && r.stdout.includes("✅ 서류 사진 3개 올림"), r.stdout + r.stderr);
const a = (await ddb.doc(`attendance/${KEY}`).get()).data();
check("복원: 날짜·위치·문서 참조·바이트·NaN·'__t' 필드까지 그대로", a && a.when instanceof Timestamp && a.when.toMillis() === 1760000000123 && a.where instanceof GeoPoint && a.where.latitude === 37.5 && a.who && a.who.path === "staff/teacher@gmail.com" && Buffer.isBuffer(a.raw) && a.raw[3] === 250 && a.weird.__t === "user-field" && Number.isNaN(a.weird.n) && a.nested[0].t instanceof Timestamp, JSON.stringify(a));
check("복원: 문서 수 같음 (overrides 120) + 부모 없는 하위 문서", (await ddb.collection("overrides").count().get()).data().count === 120 && (await ddb.doc("userCenters/u1/items/i1").get()).exists);
check("복원: --exclude 로 뺀 컬렉션(centers)은 안 들어감", (await ddb.collection("centers").limit(1).get()).empty);
const [restoredFiles] = await db2.getFiles();
const rf = Object.fromEntries(await Promise.all(restoredFiles.map(async (f) => [f.name, (await f.download())[0].toString()])));
const [cm] = await db2.file(`studentDocs/${KEY}/counsel_1.jpg`).getMetadata();
check("복원: 서류 사진 원래 이름·내용·형식·메타데이터 그대로", rf[`studentDocs/${KEY}/survey_2.jpg`] === "JPEG-22-changed" && rf["studentDocs/odd:name?/a*b.jpg"] === "JPEG-odd" && cm.contentType === "image/jpeg" && cm.metadata && cm.metadata.by === "김선생" && /max-age/.test(cm.cacheControl || ""), JSON.stringify({ names: Object.keys(rf), cm: { ct: cm.contentType, md: cm.metadata, cc: cm.cacheControl } }));
r = run("restore.mjs", ["--from", day3, "--to", "newpc", "--yes"]);
check("복원: 받는 쪽에 데이터가 있으면 --overwrite 없이는 멈춤", r.status !== 0 && (r.stderr + r.stdout).includes("이미 데이터가 있어요"), r.stdout + r.stderr);
r = run("restore.mjs", ["--from", day3, "--to", "newpc", "--yes", "--overwrite", "--only", "storage"]);
check("복원: --overwrite --only storage 는 사진만 다시 올림", r.status === 0 && r.stdout.includes("✅ 서류 사진 3개 올림") && !r.stdout.includes("✅ Firestore"), r.stdout + r.stderr);

// ── 5. 연결 확인 / 설정 오류 안내
r = run("backup.mjs", ["--check", "--only", "banpo"]);
check("--check: 연결 확인만 (Firestore 컬렉션 목록 + 저장소)", r.status === 0 && r.stdout.includes("[반포원] Firestore 연결 OK") && r.stdout.includes("저장소 연결 OK"), r.stdout + r.stderr);
r = spawnSync(process.execPath, [path.join(HERE, "backup.mjs"), "--config", path.join(tmp, "none.json")], { encoding: "utf8" });
check("설정 파일이 없으면 만드는 법 안내", r.status !== 0 && (r.stdout + r.stderr).includes("config.example.json 을 복사해서"), r.stdout + r.stderr);

fs.rmSync(tmp, { recursive: true, force: true });
for (const x of results) console.log(`${x.ok ? "✔" : "✘"} ${x.name}${x.ok ? "" : "  — " + String(x.detail).slice(0, 600)}`);
const failed = results.filter((x) => !x.ok).length;
console.log(failed ? `${failed} BACKUP TEST(S) FAILED` : `ALL ${results.length} BACKUP TESTS PASSED`);
process.exit(failed ? 1 : 0);
