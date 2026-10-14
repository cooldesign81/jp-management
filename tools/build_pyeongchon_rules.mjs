// firestore.rules(반포·대치용)에서 평촌(jarada-checkin) 전용 규칙 firestore.pyeongchon.rules 를 만듭니다.
// 평촌 프로젝트는 결제 매니저(jarada-payment)와 같이 쓰기 때문에, 결제 매니저가 쓰는 컬렉션과 두 앱이 같이 쓰는
// smsQueue 만 예전처럼 "로그인만 하면 허용"으로 바꾸고 나머지는 그대로 둡니다.
// 실행: tools 폴더에서  npm run build:rules
import fs from "node:fs";

const BASE = new URL("../firestore.rules", import.meta.url);
const OUT = new URL("../firestore.pyeongchon.rules", import.meta.url);

// 결제 매니저가 쓰는 컬렉션. 새 컬렉션을 쓰기 시작하면 여기에 이름을 추가하고 다시 실행하세요.
const PAYMENT_MANAGER_COLLECTIONS = ["centers", "userCenters"];

function replaceOnce(src, from, to, label) {
  const count = src.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: 기준 문구가 ${count}번 나옴 (1번이어야 함). firestore.rules 구조가 바뀌었는지 확인하세요.`);
  return src.replace(from, to);
}

let src = fs.readFileSync(BASE, "utf8");

// 1) 머리말
const headerEnd = src.indexOf("service cloud.firestore {");
src = `rules_version = '2';

// ============================================================
// JP 스케줄 매니저 — Firestore 보안 규칙 (평촌 jarada-checkin 전용)
//
// ※ 이 파일은 firestore.rules 에서 자동으로 만들어집니다. 직접 고치지 말고 firestore.rules 를 고친 뒤
//   tools 폴더에서 npm run build:rules 를 실행하세요.
//
// 평촌 프로젝트는 결제 매니저(jarada-payment)와 같이 씁니다. 결제 매니저가 쓰는 컬렉션(${PAYMENT_MANAGER_COLLECTIONS.join(", ")})과
// 두 앱이 같이 쓰는 smsQueue 는 예전 규칙과 똑같이 "로그인만 하면 허용"으로 두고, 나머지는 반포·대치와 같습니다.
// 직원 목록·최고 관리자·이메일/비밀번호 계정에 대한 설명은 firestore.rules 맨 위를 보세요.
// ============================================================
` + src.slice(headerEnd);

// 2) smsQueue: 두 앱 공용 → 로그인만 하면 허용
src = replaceOnce(
  src,
  `    // 문자 대기열: 직원이 등록·조회·취소·수정.
    // 실제 발송 후 status 를 바꾸는 발송 서버와 연말 정산 서버는 Admin SDK 를 쓰므로 이 규칙을 거치지 않습니다.
    match /smsQueue/{docId} {
      allow read, create, update, delete: if isStaff();
    }
`,
  `    // 문자 대기열: 스케줄 매니저와 결제 매니저가 같이 쓰는 컬렉션이라, 결제 매니저 계정이 막히지 않도록
    // 예전 규칙 그대로 "로그인만 하면 허용"으로 둠. (발송 서버는 Admin SDK 라 규칙을 거치지 않음)
    match /smsQueue/{docId} {
      allow read, create, update, delete: if signedIn();
    }

    // ───────────── 결제 매니저(jarada-payment)가 쓰는 컬렉션 ─────────────
    // 결제 매니저가 어떤 계정으로 들어오는지 이 앱에서는 알 수 없어, 예전 규칙과 같이 "로그인만 하면 허용".
    // {document=**} 는 하위 컬렉션까지 포함한다는 뜻.
${PAYMENT_MANAGER_COLLECTIONS.map((c) => `    match /${c}/{document=**} { allow read, write: if signedIn(); }`).join("\n")}
`,
  "smsQueue 블록",
);

fs.writeFileSync(OUT, src);
console.log(`firestore.pyeongchon.rules 를 만들었어요 (결제 매니저 컬렉션: ${PAYMENT_MANAGER_COLLECTIONS.join(", ")})`);
