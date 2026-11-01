// firestore.rules(평촌·반포·대치 스케줄 매니저용)에서 jarada-checkin 전용 규칙 firestore.checkin.rules 를 만듭니다.
// jarada-checkin 은 세 원 결제 매니저(jarada-payment)가 쓰는 프로젝트입니다. 평촌 스케줄 매니저도 2026년 11월까지
// 여기를 같이 썼다가 jarada-pyeongchon 으로 옮겼습니다. 그래서
//   - 결제 매니저가 쓰는 컬렉션과 문자 대기열(smsQueue)은 "결제 매니저 계정 (+ 스케줄 매니저 직원)"에게 열고,
//   - 여기 남은 옛 평촌 스케줄 매니저 데이터는 읽기만 되게 막습니다 (옮기기 전 화면을 새로고침 안 한 탭이
//     옛 데이터에 몰래 써서 기록이 갈라지지 않게. 쓰려고 하면 오류가 나서 새로고침하게 됨).
// 실행: tools 폴더에서  npm run build:rules
import fs from "node:fs";

const BASE = new URL("../firestore.rules", import.meta.url);
const OUT = new URL("../firestore.checkin.rules", import.meta.url);

// 결제 매니저가 쓰는 컬렉션. 새 컬렉션을 쓰기 시작하면 여기에 이름을 추가하고 다시 실행하세요.
const PAYMENT_MANAGER_COLLECTIONS = ["centers", "userCenters"];

// 결제 매니저에 로그인하는 이메일/비밀번호 계정 (jarada-checkin 의 Authentication 에 이미 만들어져 있는 계정).
// 이미 있는 이메일이라 다른 사람이 같은 이메일로 새로 가입할 수 없어서, 가입을 켜 둬도 이 목록으로 안전하게 구분됩니다.
// 결제 매니저 계정을 새로 만들거나 바꾸면 여기에 추가하고 다시 실행한 뒤, jarada-checkin 규칙을 다시 게시하세요.
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
// jarada-checkin — Firestore 보안 규칙 (세 원 결제 매니저 + 옛 평촌 스케줄 매니저 데이터 보관)
//
// ※ 이 파일은 firestore.rules 에서 자동으로 만들어집니다. 직접 고치지 말고 firestore.rules 나
//   tools/build_checkin_rules.mjs 를 고친 뒤 tools 폴더에서 npm run build:rules 를 실행하세요.
//
//   - 결제 매니저가 쓰는 컬렉션(${PAYMENT_MANAGER_COLLECTIONS.join(", ")}): 결제 매니저 계정(아래 isPaymentManagerAccount)과 최고 관리자만
//   - 문자 대기열 smsQueue: 결제 매니저 계정 + 직원 목록 계정 (옮기기 전 화면이 남아 있어도 문자는 나가게)
//   - 옛 평촌 스케줄 매니저 데이터(반 배정·사진·출결·상담 등): 직원 목록 계정이 읽기만. 평촌 스케줄 매니저는
//     2026년 11월부터 jarada-pyeongchon 을 씁니다.
//   - 직원 설문 응답(surveyResponses): survey/jarvis.html 이 여기에 씀
// 직원 목록·최고 관리자·이메일/비밀번호 계정에 대한 설명은 firestore.rules 맨 위를 보세요.
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
    // (목록은 tools/build_checkin_rules.mjs 의 PAYMENT_MANAGER_ACCOUNTS 에서 관리)
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

// 3) 옛 평촌 스케줄 매니저 데이터는 읽기만
src = replaceOnce(
  src,
  `    // ───────────── 이 앱이 쓰는 컬렉션 ─────────────`,
  `    // ───────────── 옛 평촌 스케줄 매니저 데이터 (읽기만) ─────────────
    // 평촌 스케줄 매니저는 jarada-pyeongchon 으로 옮겼습니다. 아래는 옮기기 전 데이터 보관본이라 쓰기를 막습니다.`,
  "앱 컬렉션 머리말",
);
const frozen = src.match(/match \/\w+\/\{docId\}\s*\{ allow read, write: if isStaff\(\); \}/g) || [];
if (frozen.length !== 11) throw new Error(`스케줄 매니저 컬렉션 줄이 ${frozen.length}개 (11개여야 함). firestore.rules 구조가 바뀌었는지 확인하세요.`);
src = src.replace(/(match \/\w+\/\{docId\}\s*)\{ allow read, write: if isStaff\(\); \}/g, "$1{ allow read: if isStaff(); }");
src = replaceOnce(
  src,
  `    // 출결 기록 · 상담 기록: 읽기/추가/수정은 직원 누구나, "문서 자체를 지우는 것"은 관리자만.
    // (앱에서 문서를 지우는 작업은 완전삭제와 학생 기록 이전뿐입니다. 로그 하나를 고치거나 지우는 건 덮어쓰기라 직원도 됩니다.)
    match /attendance/{docId} {
      allow read, create, update: if isStaff();
      allow delete: if isAdmin();
    }
    match /counseling/{docId} {
      allow read, create, update: if isStaff();
      allow delete: if isAdmin();
    }
`,
  `    match /attendance/{docId} { allow read: if isStaff(); }
    match /counseling/{docId} { allow read: if isStaff(); }
`,
  "출결·상담 블록",
);

fs.writeFileSync(OUT, src);
console.log(`firestore.checkin.rules 를 만들었어요 (결제 매니저 컬렉션: ${PAYMENT_MANAGER_COLLECTIONS.join(", ")} · 결제 매니저 계정 ${PAYMENT_MANAGER_ACCOUNTS.length}개 · 옛 평촌 스케줄 매니저 데이터 ${frozen.length + 2}개 컬렉션 읽기 전용)`);
