// JP 스케줄 매니저 전체 백업 (원 N100 윈도우 PC에서 매일 새벽 실행 → ipTIME NAS 에 저장)
//
//   node backup.mjs            세 원 전부 백업
//   node backup.mjs --check    연결만 확인 (아무것도 저장하지 않음)
//   node backup.mjs --only banpo   한 원만
//
// 저장 구조 (config.json 의 outputDir 아래):
//   <원 id>/daily/2026-10-22/firestore/<컬렉션>.ndjson   Firestore 문서 전부 (한 줄에 문서 하나)
//   <원 id>/daily/2026-10-22/storage-manifest.json       그날 저장소(서류 사진)에 있던 파일 목록
//   <원 id>/daily/2026-10-22/summary.json                 문서 수·파일 수·걸린 시간
//   <원 id>/storage/...                                   서류 사진 파일 (바뀐 것만 새로 받음, 지워진 파일도 남겨 둠)
//   LAST_STATUS.txt                                        마지막 백업 결과 (성공/실패) — 이것만 보면 됨
//   backup-log.txt                                         실행 기록
// 보관: 최근 keepDailyDays(기본 30)일은 매일 것, 그보다 오래된 것은 매월 1일 것만 남김.
import fs from "node:fs";
import path from "node:path";
import { HERE, parseArgs, loadConfig, connect, encodeValue, localPathForObject, localDateString, md5File, mapLimit, FLAT_COLLECTIONS } from "./common.mjs";

const args = parseArgs(process.argv.slice(2));
const startedAt = new Date();
let logFile = null;
function log(msg) {
  const line = `[${new Date().toLocaleString("ko-KR", { hour12: false })}] ${msg}`;
  console.log(line);
  if (logFile) { try { fs.appendFileSync(logFile, line + "\n"); } catch {} }
}

async function exportCollection(db, colRef, outStream, counter, recursive) {
  // 하위 컬렉션을 찾을 컬렉션은 listDocuments 로 "문서는 없고 하위 컬렉션만 있는" 경우까지 찾음
  if (!recursive) {
    const snap = await colRef.get();
    counter.reads += Math.max(1, snap.size);
    for (const d of snap.docs) { outStream.write(JSON.stringify({ p: d.ref.path, d: encodeValue(d.data()) }) + "\n"); counter.docs++; }
    return;
  }
  const refs = await colRef.listDocuments();
  counter.reads += Math.max(1, refs.length);
  for (const ref of refs) {
    const d = await ref.get();
    counter.reads++;
    if (d.exists) { outStream.write(JSON.stringify({ p: ref.path, d: encodeValue(d.data()) }) + "\n"); counter.docs++; }
    const subs = await ref.listCollections();
    counter.reads++;
    for (const sub of subs) await exportCollection(db, sub, outStream, counter, true);
  }
}

async function backupFirestore(db, dayDir) {
  const fsDir = path.join(dayDir, "firestore");
  fs.mkdirSync(fsDir, { recursive: true });
  const cols = await db.listCollections();
  const result = {};
  let reads = 0;
  for (const col of cols.sort((a, b) => a.id.localeCompare(b.id))) {
    const file = path.join(fsDir, `${col.id}.ndjson`);
    const out = fs.createWriteStream(file, { encoding: "utf8" });
    const counter = { docs: 0, reads: 0 };
    await exportCollection(db, col, out, counter, !FLAT_COLLECTIONS.has(col.id));
    await new Promise((resolve, reject) => { out.end(resolve); out.on("error", reject); });
    result[col.id] = counter.docs;
    reads += counter.reads;
  }
  return { collections: result, reads };
}

async function backupStorage(bucket, centerDir, dayDir) {
  const mirror = path.join(centerDir, "storage");
  const indexFile = path.join(mirror, "_index.json");
  fs.mkdirSync(mirror, { recursive: true });
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : {};
  const [files] = await bucket.getFiles({ autoPaginate: true });
  const manifest = [];
  let downloaded = 0, bytes = 0;
  await mapLimit(files.filter((f) => !f.name.endsWith("/")), 4, async (f) => {
    const m = f.metadata || {};
    const local = localPathForObject(f.name);
    const dest = path.join(mirror, ...local.split("/"));
    const known = index[f.name];
    const same = known && known.md5 === m.md5Hash && fs.existsSync(dest) && fs.statSync(dest).size === Number(m.size);
    if (!same) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await f.download({ destination: dest + ".part" });
      fs.renameSync(dest + ".part", dest);
      if (m.md5Hash && md5File(dest) !== m.md5Hash) throw new Error(`받은 파일이 깨졌어요 (md5 다름): ${f.name}`);
      downloaded++; bytes += Number(m.size) || 0;
    }
    const entry = { local, md5: m.md5Hash || null, size: Number(m.size) || 0, updated: m.updated || null, contentType: m.contentType || null, cacheControl: m.cacheControl || null, metadata: m.metadata || null };
    index[f.name] = entry;
    manifest.push({ name: f.name, ...entry });
  });
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
  manifest.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(dayDir, "storage-manifest.json"), JSON.stringify(manifest, null, 1));
  return { files: manifest.length, downloaded, downloadedBytes: bytes, totalBytes: manifest.reduce((s, x) => s + x.size, 0) };
}

// 최근 keepDays 일 + 매월 1일만 남기고 지움. 끝나지 못한 .partial 폴더도 정리
function applyRetention(centerDir, keepDays, today) {
  const dailyDir = path.join(centerDir, "daily");
  if (!fs.existsSync(dailyDir)) return [];
  const cutoff = new Date(`${today}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - keepDays);
  const removed = [];
  for (const name of fs.readdirSync(dailyDir)) {
    const full = path.join(dailyDir, name);
    const m = /^(\d{4}-\d{2}-\d{2})(\.partial)?$/.exec(name);
    if (!m || !fs.statSync(full).isDirectory()) continue;
    const d = new Date(`${m[1]}T00:00:00`);
    if (m[2]) { if (m[1] !== today) { fs.rmSync(full, { recursive: true, force: true }); removed.push(name); } continue; }
    if (d < cutoff && !m[1].endsWith("-01")) { fs.rmSync(full, { recursive: true, force: true }); removed.push(name); }
  }
  return removed;
}

async function backupCenter(cfg, center, today) {
  const label = center.name || center.id;
  const { db, bucket } = connect(center);
  const centerDir = path.join(cfg.outputDir, center.id);
  const finalDir = path.join(centerDir, "daily", today);
  const workDir = finalDir + ".partial";
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const t0 = Date.now();
  const fsResult = await backupFirestore(db, workDir);
  const docCount = Object.values(fsResult.collections).reduce((s, n) => s + n, 0);
  log(`[${label}] Firestore: 컬렉션 ${Object.keys(fsResult.collections).length}개 · 문서 ${docCount}개 (읽기 약 ${fsResult.reads}회)`);
  let stResult = null;
  if (bucket) {
    try {
      stResult = await backupStorage(bucket, centerDir, workDir);
      log(`[${label}] 저장소(서류 사진): 파일 ${stResult.files}개 · 새로 받음 ${stResult.downloaded}개 (${(stResult.downloadedBytes / 1024 / 1024).toFixed(1)}MB)`);
    } catch (e) {
      const notReady = e && (e.code === 404 || e.code === 403 || /does not exist|not found|billing/i.test(String(e.message)));
      if (!notReady) throw e;
      stResult = { skipped: String(e.message || e).slice(0, 200) };
      log(`[${label}] 저장소(서류 사진): 아직 준비 안 됨 — 건너뜀 (${stResult.skipped})`);
    }
  }
  const summary = { center: center.id, name: label, projectId: center.projectId, date: today, startedAt: new Date(t0).toISOString(), seconds: Math.round((Date.now() - t0) / 1000), firestore: fsResult, storage: stResult };
  fs.writeFileSync(path.join(workDir, "summary.json"), JSON.stringify(summary, null, 1));
  fs.rmSync(finalDir, { recursive: true, force: true }); // 같은 날 두 번 돌리면 새 것으로 바꿈
  fs.renameSync(workDir, finalDir);
  const removed = applyRetention(centerDir, cfg.keepDailyDays, today);
  if (removed.length) log(`[${label}] 오래된 백업 정리: ${removed.join(", ")}`);
  return summary;
}

async function checkCenter(center) {
  const label = center.name || center.id;
  const { db, bucket } = connect(center);
  const cols = await db.listCollections();
  log(`[${label}] Firestore 연결 OK — 컬렉션 ${cols.length}개 (${cols.map((c) => c.id).join(", ")})`);
  if (bucket) {
    try { const [files] = await bucket.getFiles({ maxResults: 5, autoPaginate: false }); log(`[${label}] 저장소 연결 OK (${bucket.name}) — 파일 ${files.length ? "있음" : "아직 없음"}`); }
    catch (e) { log(`[${label}] 저장소 연결 안 됨 (${bucket.name}): ${String(e.message || e).slice(0, 160)} — 서류 사진 저장소를 아직 안 만들었으면 정상이에요`); }
  }
}

async function main() {
  const cfg = loadConfig(args.config);
  const today = args.date || localDateString(startedAt); // --date 는 테스트용
  if (!args.check) {
    fs.mkdirSync(cfg.outputDir, { recursive: true });
    logFile = path.join(cfg.outputDir, "backup-log.txt");
  }
  const centers = cfg.centers.filter((c) => !args.only || String(args.only).split(",").includes(c.id));
  if (!centers.length) throw new Error(`--only 로 고른 원이 config.json 에 없어요: ${args.only}`);
  log(args.check ? "연결 확인 시작" : `백업 시작 (${today}) → ${cfg.outputDir}`);
  const results = [];
  for (const c of centers) {
    try {
      if (args.check) await checkCenter(c);
      else results.push({ ok: true, ...(await backupCenter(cfg, c, today)) });
    } catch (e) {
      log(`[${c.name || c.id}] ❌ 실패: ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e}`);
      results.push({ ok: false, center: c.id, name: c.name || c.id, error: String(e && e.message || e) });
    }
  }
  if (args.check) { log("연결 확인 끝"); return results.every((r) => r.ok !== false) ? 0 : 1; }
  const failed = results.filter((r) => !r.ok);
  const status = [
    failed.length ? "❌ 백업 실패가 있어요" : "✅ 백업 성공",
    `날짜: ${today} (${startedAt.toLocaleString("ko-KR", { hour12: false })} 시작)`,
    ...results.map((r) => r.ok
      ? `  ${r.name}: 문서 ${Object.values(r.firestore.collections).reduce((s, n) => s + n, 0)}개 · 서류 사진 ${r.storage && !r.storage.skipped ? `${r.storage.files}개` : "없음/건너뜀"} · ${r.seconds}초`
      : `  ${r.name}: 실패 — ${r.error}`),
    "",
    "자세한 기록은 backup-log.txt 를 보세요.",
  ].join("\r\n");
  fs.writeFileSync(path.join(cfg.outputDir, "LAST_STATUS.txt"), status);
  log(failed.length ? `백업 끝 — 실패 ${failed.length}곳` : "백업 끝 — 모두 성공");
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  log(`❌ ${e && e.message ? e.message : e}`);
  // NAS 에 못 닿는 경우 등: 이 폴더에라도 남겨 둠
  try { fs.writeFileSync(path.join(HERE, "LAST_ERROR.txt"), `${new Date().toLocaleString("ko-KR", { hour12: false })}\r\n${e && e.message ? e.message : e}\r\n`); } catch {}
  process.exit(1);
});
