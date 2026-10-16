// firestore.rules(반포·대치용)에서 평촌(jarada-checkin) 전용 규칙 firestore.pyeongchon.rules 를 만듭니다.
// 평촌 프로젝트는 결제 매니저(jarada-payment)와 같이 쓰기 때문에, 결제 매니저가 쓰는 컬렉션과 두 앱이 같이 쓰는
// smsQueue 만 "결제 매니저 계정 + 스케줄 매니저 직원"에게 열고, 나머지는 반포·대치와 똑같이 둡니다.
// 실행: tools 폴더에서  npm run build:rules
import fs from "node:fs";

const BASE = new URL("../firestore.rules", import.meta.url);
const OUT = new URL("../firestore.pyeongchon.rules", import.meta.url);

// 결제 매니저가 쓰는 컬렉션. 새 컬렉션을 쓰기 시작하면 여기에 이름을 추가하고 다시 실행하세요.
const PAYMENT_MANAGER_COLLECTIONS = ["centers", "userCenters"];

// 결제 매니저에 로그인하는 이메일/비밀번호 계정 (jarada-checkin 의 Authentication 에 이미 만들어져 있는 계정).
// 이미 있는 이메일이라 다른 사람이 같은 이메일로 새로 가입할 수 없어서, 가입을 켜 둬도 이 목록으로 안전하게 구분됩니다.
// 결제 매니저 계정을 새로 만들거나 바꾸면 여기에 추가하고 다시 실행한 뒤, 평촌 규칙을 다시 게시하세요.
const PAYMENT_MANAGER_ACCOUNTS = [
  { email: "jarada_boys@naver.com", note: "평촌" },
  { email: "jarada-banpo@naver.com", note: "반포" },
  { email: "jarada-daechi@naver.com", note: "대치" },
  { email: "jinhyuck@gmail.com", note: "관리자 (결제 매니저 ADMIN_EMAILS)" },
];

function replaceOnce(src, from, to, label) {
  const count = src.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: 기준 문구가 ${count}번 나옴 (1번이어야 함). firestore.rules 구조가 바뀌었는지 확인하세요.`);
  return src.replace(from, to);
}

for (const a of PAYMENT_MANAGER_ACCOUNTS) {
  if (a.email !== a.email.trim().toLowerCase()) throw new Error(`결제 매니저 계정 이메일은 소문자로 적어 주세요: ${a.email}`);
}

let src = fs.readFileSync(BASE, "utf8");

// 1) 머리말
const headerEnd = src.indexOf("service cloud.firestore {");
src = `rules_version = '2';

// ============================================================
// JP 스케줄 매니저 — Firestore 보안 규칙 (평촌 jarada-checkin 전용)
//
// ※ 이 파일은 firestore.rules 에서 자동으로 만들어집니다. 직접 고치지 말고 firestore.rules 나
//   tools/build_pyeongchon_rules.mjs 를 고친 뒤 tools 폴더에서 npm run build:rules 를 실행하세요.
//
// 평촌 프로젝트는 결제 매니저(jarada-payment)와 같이 씁니다.
//   - 결제 매니저가 쓰는 컬렉션(${PAYMENT_MANAGER_COLLECTIONS.join(", ")}): 결제 매니저 계정(아래 isPaymentManagerAccount)과 최고 관리자만
//   - 두 앱이 같이 쓰는 smsQueue: 결제 매니저 계정 + 스케줄 매니저 직원
//   - 나머지(스케줄 매니저 데이터): 반포·대치와 똑같이 직원 목록에 등록된 계정만
// 직원 목록·최고 관리자·이메일/비밀번호 계정에 대한 설명은 firestore.rules 맨 위를 보세요.
// 목록에 없는 계정은 아무 데이터에도 접근하지 못하므로, 평촌도 Authentication → 설정 → 사용자 작업의
// "생성(가입) 사용 설정"을 켜 둬도 안전합니다.
// ============================================================
` + src.slice(headerEnd);

// 2) smsQueue + 결제 매니저 컬렉션
const accountList = PAYMENT_MANAGER_ACCOUNTS.map((a) => `'${a.email}'`).join(", ");
const accountNotes = PAYMENT_MANAGER_ACCOUNTS.map((a) => `    //   ${a.email} — ${a.note}`).join("\n");
src = replaceOnce(
  src,
  `    // 문자 대기열: 직원이 등록·조회·취소·수정.
    // 실제 발송 후 status 를 바꾸는 발송 서버와 연말 정산 서버는 Admin SDK 를 쓰므로 이 규칙을 거치지 않습니다.
    match /smsQueue/{docId} {
      allow read, create, update, delete: if isStaff();
    }
`,
  `    // ───────────── 결제 매니저(jarada-payment) ─────────────
    // 결제 매니저는 이메일/비밀번호 로그인만 씀. 아래 계정만 결제 매니저 계정으로 봄
    // (목록은 tools/build_pyeongchon_rules.mjs 의 PAYMENT_MANAGER_ACCOUNTS 에서 관리)
${accountNotes}
    function isPaymentManagerAccount() {
      return signedIn() && isPasswordAccount() && email() in [${accountList}];
    }

    // 문자 대기열: 스케줄 매니저 직원과 결제 매니저 계정이 같이 씀.
    // 실제 발송 후 status 를 바꾸는 발송 서버와 연말 정산 서버는 Admin SDK 를 쓰므로 이 규칙을 거치지 않습니다.
    match /smsQueue/{docId} {
      allow read, create, update, delete: if isStaff() || isPaymentManagerAccount();
    }

    // 결제 매니저가 쓰는 컬렉션. {document=**} 는 하위 컬렉션(data, weeks 등)까지 포함한다는 뜻.
${PAYMENT_MANAGER_COLLECTIONS.map((c) => `    match /${c}/{document=**} { allow read, write: if isPaymentManagerAccount() || isSuperAdmin(); }`).join("\n")}
`,
  "smsQueue 블록",
);

fs.writeFileSync(OUT, src);
console.log(`firestore.pyeongchon.rules 를 만들었어요 (결제 매니저 컬렉션: ${PAYMENT_MANAGER_COLLECTIONS.join(", ")} · 결제 매니저 계정 ${PAYMENT_MANAGER_ACCOUNTS.length}개)`);
