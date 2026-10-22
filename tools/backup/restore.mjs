// JP 스케줄 매니저 복원 (backup.mjs 로 만든 백업 → Firebase 프로젝트)
// 실수로 지운 데이터를 되살리거나, 평촌 DB 분리처럼 다른(새) 프로젝트로 옮길 때 씁니다.
//
//   node restore.mjs --from <백업 폴더> --to <원 id 또는 config 에 없는 새 프로젝트 id> [--key keys/새키.json] [--bucket 새버킷]
//       --from      예: \\192.168.0.10\backup\jp-schedule\banpo\daily\2026-10-22
//       --to        config.json 의 원 id(예: banpo) 또는 새 프로젝트 id
//       --only firestore | storage      한쪽만
//       --collections a,b               이 컬렉션만     --exclude centers,userCenters   이 컬렉션은 빼고
//       --overwrite                     받는 쪽에 이미 데이터가 있어도 덮어씀 (없으면 데이터가 있을 때 멈춤)
//       --dry-run                       실제로 쓰지 않고 무엇을 할지만 보여줌
// 받는 쪽 프로젝트 id 를 직접 입력해야 시작합니다 (실수 방지).
// 덮어쓰기는 "백업에 있는 문서"만 바꿉니다. 백업 뒤에 새로 생긴 문서는 지우지 않아요.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs, loadConfig, connect, decodeValue, md5File, mapLimit } from "./common.mjs";

const args = parseArgs(process.argv.slice(2));

function fail(msg) { console.error(`❌ ${msg}`); process.exit(1); }

async function main() {
  if (!args.from || !args.to) fail("--from <백업 폴더> 와 --to <원 id 또는 프로젝트 id> 를 적어 주세요. 예: node restore.mjs --from Z:\\jp-schedule\\banpo\\daily\\2026-10-22 --to banpo");
  const from = path.resolve(String(args.from));
  if (!fs.existsSync(path.join(from, "summary.json"))) fail(`백업 폴더가 아니에요 (summary.json 없음): ${from}\n  daily\\날짜 폴더를 골라 주세요. 이름이 .partial 로 끝나는 폴더는 끝나지 못한 백업이에요.`);
  const summary = JSON.parse(fs.readFileSync(path.join(from, "summary.json"), "utf8"));
  let cfg = null;
  try { cfg = loadConfig(args.config); } catch (e) { if (!args.key && !process.env.FIRESTORE_EMULATOR_HOST) fail(e.message); }
  const known = cfg && cfg.centers.find((c) => c.id === args.to || c.projectId === args.to);
  const target = known ? { ...known } : { id: String(args.to), name: String(args.to), projectId: String(args.to) };
  if (args.key) target.keyFile = String(args.key);
  if (args.bucket) target.bucket = String(args.bucket);
  const doFirestore = args.only !== "storage", doStorage = args.only !== "firestore";
  const include = args.collections ? new Set(String(args.collections).split(",")) : null;
  const exclude = new Set(args.exclude ? String(args.exclude).split(",") : []);

  const { db, bucket } = connect(target);
  const files = fs.existsSync(path.join(from, "firestore")) ? fs.readdirSync(path.join(from, "firestore")).filter((f) => f.endsWith(".ndjson")) : [];
  const cols = files.map((f) => f.slice(0, -".ndjson".length)).filter((c) => (!include || include.has(c)) && !exclude.has(c));
  const manifest = doStorage && fs.existsSync(path.join(from, "storage-manifest.json")) ? JSON.parse(fs.readFileSync(path.join(from, "storage-manifest.json"), "utf8")) : [];
  const mirror = path.resolve(from, "..", "..", "storage");

  console.log(`\n백업: ${summary.name} (${summary.projectId}) · ${summary.date}`);
  console.log(`받는 곳: ${target.name} (${target.projectId})${target.bucket ? ` · 저장소 ${target.bucket}` : ""}`);
  if (doFirestore) console.log(`Firestore 컬렉션 ${cols.length}개: ${cols.map((c) => `${c}(${summary.firestore.collections[c] ?? "?"})`).join(", ")}`);
  if (doStorage) console.log(`서류 사진 파일 ${manifest.length}개`);

  // 받는 쪽에 이미 데이터가 있는지
  const busy = [];
  if (doFirestore) for (const c of cols) { const s = await db.collection(c).limit(1).get(); if (!s.empty) busy.push(c); }
  if (busy.length && !args.overwrite) fail(`받는 프로젝트에 이미 데이터가 있어요: ${busy.join(", ")}\n  정말 덮어쓰려면 --overwrite 를 붙이세요 (백업에 있는 문서만 바뀌고, 나머지는 그대로).`);
  if (busy.length) console.log(`⚠️ 이미 데이터가 있는 컬렉션 (덮어씀): ${busy.join(", ")}`);
  if (args["dry-run"]) { console.log("\n--dry-run: 여기까지만 보여주고 끝냅니다."); return 0; }

  if (!args.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`\n정말 복원하려면 받는 프로젝트 id(${target.projectId})를 똑같이 입력하세요: `)).trim();
    rl.close();
    if (answer !== target.projectId) fail("입력이 달라서 멈췄어요. 아무것도 바뀌지 않았어요.");
  }

  if (doFirestore) {
    const writer = db.bulkWriter();
    writer.onWriteError((err) => err.failedAttempts < 5);
    let n = 0;
    for (const c of cols) {
      const lines = fs.readFileSync(path.join(from, "firestore", `${c}.ndjson`), "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        const { p, d } = JSON.parse(line);
        writer.set(db.doc(p), decodeValue(d, db));
        n++;
      }
      console.log(`  ${c}: ${lines.length}개`);
    }
    await writer.close();
    console.log(`✅ Firestore 문서 ${n}개 복원`);
  }
  if (doStorage && manifest.length) {
    if (!bucket) fail("받는 쪽 저장소(bucket)를 모르겠어요. config.json 의 bucket 이나 --bucket 을 적어 주세요.");
    let up = 0, skip = 0;
    await mapLimit(manifest, 4, async (m) => {
      const local = path.join(mirror, ...m.local.split("/"));
      if (!fs.existsSync(local)) throw new Error(`백업에 파일이 없어요: ${local}`);
      if (m.md5 && md5File(local) !== m.md5) throw new Error(`백업 파일이 깨졌어요 (md5 다름): ${local}`);
      const f = bucket.file(m.name);
      const [exists] = await f.exists();
      if (exists && !args.overwrite) {
        const [meta] = await f.getMetadata();
        if (meta.md5Hash === m.md5) { skip++; return; }
      }
      await bucket.upload(local, { destination: m.name, resumable: false, metadata: { contentType: m.contentType || undefined, cacheControl: m.cacheControl || undefined, metadata: m.metadata || undefined } });
      up++;
    });
    console.log(`✅ 서류 사진 ${up}개 올림${skip ? ` (이미 같은 파일 ${skip}개는 건너뜀)` : ""}`);
  }
  console.log("\n끝났어요. 앱을 새로고침해서 확인해 주세요.");
  return 0;
}

main().then((code) => process.exit(code), (e) => { console.error(`❌ ${e && e.message ? e.message : e}`); process.exit(1); });
