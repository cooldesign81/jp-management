// 백업·복원이 같이 쓰는 것: 설정 읽기, Firebase 연결, Firestore 값 ↔ JSON 변환, 저장소 파일 이름 → 윈도우 경로
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp, GeoPoint, DocumentReference } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export const HERE = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

export function loadConfig(file) {
  const p = path.resolve(HERE, file || "config.json");
  if (!fs.existsSync(p)) throw new Error(`설정 파일이 없어요: ${p}\n  config.example.json 을 복사해서 config.json 으로 이름을 바꾸고 내용을 채워 주세요.`);
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!cfg.outputDir) throw new Error("config.json 에 outputDir(백업을 저장할 NAS 폴더)를 적어 주세요.");
  if (!Array.isArray(cfg.centers) || !cfg.centers.length) throw new Error("config.json 에 centers(원 목록)를 적어 주세요.");
  for (const c of cfg.centers) {
    if (!c.id || !c.projectId) throw new Error(`원 설정에 id 와 projectId 가 필요해요: ${JSON.stringify(c)}`);
    if (!/^[a-z0-9_-]+$/i.test(c.id)) throw new Error(`원 id 는 영문·숫자로만 적어 주세요: ${c.id}`);
  }
  cfg.keepDailyDays = Number.isFinite(cfg.keepDailyDays) ? cfg.keepDailyDays : 30;
  return cfg;
}

// 원마다 따로 Firebase 앱을 만듦. 에뮬레이터 테스트(FIRESTORE_EMULATOR_HOST)에서는 키 없이도 됨
const apps = new Map();
export function connect(center) {
  if (apps.has(center.projectId)) return apps.get(center.projectId);
  const opts = { projectId: center.projectId };
  if (center.bucket) opts.storageBucket = center.bucket;
  if (center.keyFile) {
    const keyPath = path.resolve(HERE, center.keyFile);
    if (!fs.existsSync(keyPath)) throw new Error(`[${center.name || center.id}] 서비스 계정 키 파일이 없어요: ${keyPath}`);
    const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    if (key.project_id && key.project_id !== center.projectId) throw new Error(`[${center.name || center.id}] 키 파일의 프로젝트(${key.project_id})가 설정(${center.projectId})과 달라요. 다른 원의 키를 넣은 것 같아요.`);
    opts.credential = cert(key);
  } else if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(`[${center.name || center.id}] config.json 에 keyFile(서비스 계정 키 경로)을 적어 주세요.`);
  }
  const app = initializeApp(opts, `jp-${center.projectId}`);
  const db = getFirestore(app);
  const bucket = center.bucket ? getStorage(app).bucket(center.bucket) : null;
  const conn = { app, db, bucket };
  apps.set(center.projectId, conn);
  return conn;
}

// Firestore 값 → JSON (날짜·위치·문서 참조·바이트도 되살릴 수 있게 표시를 붙임)
export function encodeValue(v) {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === "number") return Number.isFinite(v) ? v : { __t: "num", v: String(v) };
  if (typeof v !== "object") return v;
  if (v instanceof Timestamp) return { __t: "ts", s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { __t: "geo", lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __t: "ref", p: v.path };
  if (v instanceof Uint8Array) return { __t: "bytes", b64: Buffer.from(v).toString("base64") };
  if (Array.isArray(v)) return v.map(encodeValue);
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = encodeValue(x);
  return "__t" in v ? { __t: "obj", v: o } : o;
}
export function decodeValue(v, db) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, db));
  switch (v.__t) {
    case "num": return Number(v.v);
    case "ts": return new Timestamp(v.s, v.n);
    case "geo": return new GeoPoint(v.lat, v.lng);
    case "ref": return db.doc(v.p);
    case "bytes": return Buffer.from(v.b64, "base64");
    case "obj": { const o = {}; for (const [k, x] of Object.entries(v.v)) o[k] = decodeValue(x, db); return o; }
    default: { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = decodeValue(x, db); return o; }
  }
}

// 저장소 파일 이름(studentDocs/010-…__홍길동/counsel_….jpg) → 윈도우에서 쓸 수 있는 경로
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
export function localPathForObject(name) {
  const segs = name.split("/").map((seg) => {
    let s = seg.replace(/[<>:"\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "_");
    if (!s) s = "_";
    if (RESERVED.test(s)) s = `_${s}`;
    return s;
  });
  const joined = segs.join("/");
  if (joined === name) return joined;
  const h = crypto.createHash("sha1").update(name).digest("hex").slice(0, 8);
  const ext = path.posix.extname(joined);
  return `${joined.slice(0, joined.length - ext.length)}~${h}${ext}`;
}

export function localDateString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function md5File(file) {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("base64");
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// 스케줄 매니저 컬렉션은 하위 컬렉션이 없어서 따로 찾지 않음 (찾는 것도 읽기 요금이 들어서).
// 여기 없는 컬렉션(예: 평촌 결제 매니저의 centers, userCenters)은 하위 컬렉션까지 전부 찾아서 백업함.
export const FLAT_COLLECTIONS = new Set([
  "staff", "roster", "photos", "overrides", "additions", "manualRooms", "smsTemplates", "smsQueue", "settings",
  "attendance", "counseling", "listMemos", "dayLogs", "makeupOpenings", "bookingSettings", "studentDocs",
]);
