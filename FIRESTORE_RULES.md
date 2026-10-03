# Firestore 보안 규칙 적용 안내

이 폴더의 `firestore.rules` 는 JP 스케줄 매니저가 쓰는 Firestore 컬렉션을 **로그인한 직원만** 읽고 쓸 수 있게 하고,
되돌릴 수 없는 삭제(완전삭제, 학생 기록 이전)는 **관리자 계정만** 할 수 있게 합니다.

지금까지는 이 제한이 브라우저(index.html) 안에서만 이루어져서, 소스를 볼 줄 아는 사람이면 누구나 우회할 수 있었습니다.
규칙을 배포하면 Firestore 서버가 직접 막습니다.

## 규칙이 하는 일

| 대상 | 직원 (이메일/비밀번호 계정, 허용된 구글 계정) | 관리자 (`adminEmails`) | 로그인 안 함 · 허용 안 된 구글 계정 |
|---|---|---|---|
| 반 배정, 사진, 결석/반이동 표시, 보강 등록, 임시 교실, 문자 템플릿, SMS 설정, 메모, 일일보고, 보강 자리, 예약 설정, 문자 대기열 | 읽기·쓰기 | 읽기·쓰기 | 전부 거부 |
| 출결 기록, 상담 기록 | 읽기·추가·수정 | 읽기·추가·수정·**문서 삭제** | 전부 거부 |
| 규칙에 없는 다른 컬렉션 | 거부 | 거부 | 거부 |

- "직원"의 기준은 index.html 과 같습니다. Firebase 콘솔에서 직접 만든 이메일/비밀번호 계정은 모두 직원이고,
  구글 로그인은 `allowedGoogleEmails` 목록에 있는 이메일만 직원입니다.
- "관리자"는 `adminEmails` 목록에 있는 이메일입니다. 목록이 비어 있으면 직원 전원이 관리자입니다.
- 발송 서버(문자 상태 갱신), 연말 정산 서버, 학부모 예약용 Cloud Function 은 Admin SDK 를 쓰므로 규칙의 영향을 받지 않습니다.

## 배포 전에 맞출 것

1. `firestore.rules` 의 `allowedGoogleEmails()` 와 `adminEmails()` 를 index.html 의 `CENTERS` 설정(`allowedGoogleEmails`, `adminEmails`)과 같게 맞춥니다.
   직원이나 관리자를 추가·삭제할 때는 **두 곳을 같이** 고치고 규칙을 다시 배포합니다.
2. index.html 도 함께 배포합니다. (완전삭제 비밀번호가 사라지고 관리자 계정 여부로 바뀌었습니다.)

## 배포 방법

### 방법 A. Firebase 콘솔에서 붙여넣기 (가장 간단)

1. https://console.firebase.google.com 에서 프로젝트를 엽니다.
2. 왼쪽 메뉴 **Firestore Database → 규칙** 탭을 엽니다.
3. `firestore.rules` 내용을 붙여넣고 **게시**를 누릅니다.
4. 세 프로젝트(`jarada-banpo`, `jarada-daechi`, `jarada-checkin`)에 각각 반복합니다. 단, `jarada-checkin` 은 아래 주의사항을 먼저 읽으세요.

### 방법 B. Firebase CLI

```bash
npm install -g firebase-tools
firebase login
firebase use banpo      && firebase deploy --only firestore:rules
firebase use daechi     && firebase deploy --only firestore:rules
firebase use pyeongchon && firebase deploy --only firestore:rules   # 아래 주의사항 확인 후
```

(`.firebaserc` 에 `pyeongchon → jarada-checkin`, `banpo → jarada-banpo`, `daechi → jarada-daechi` 별칭이 들어 있습니다.)

## 평촌(jarada-checkin)은 `firestore.pyeongchon.rules` 사용

평촌 프로젝트에는 결제 매니저가 쓰는 `centers`, `userCenters` 컬렉션이 함께 있습니다. `firestore.pyeongchon.rules` 는
이 두 컬렉션(하위 컬렉션 포함)과 두 앱이 같이 쓰는 `smsQueue` 를 예전처럼 "로그인만 하면 허용"으로 두고, 나머지는 반포·대치와 같습니다.
평촌 콘솔에는 `firestore.rules` 대신 이 파일을 붙여넣으세요. 결제 매니저가 새 컬렉션을 쓰기 시작하면 같은 모양으로 한 줄 추가하면 됩니다.

## 평촌(jarada-checkin) 주의사항 (참고)

평촌은 결제 매니저(jarada-payment)와 같은 Firebase 프로젝트를 씁니다. 규칙에 없는 컬렉션은 전부 거부되기 때문에,
`firestore.rules` 로 기존 규칙을 **통째로 바꾸면 결제 매니저가 쓰는 컬렉션이 막힐 수 있습니다.**

1. 콘솔의 **규칙** 탭에서 지금 적용된 규칙을 먼저 확인하고 백업해 둡니다.
2. 결제 매니저가 Firestore 에 어떻게 접근하는지 확인합니다.
   - 서버(Admin SDK)에서만 읽고 쓴다면 규칙의 영향을 받지 않으니 그대로 둬도 됩니다.
   - 브라우저에서 직접 읽고 쓴다면, 그 앱이 쓰는 컬렉션과 로그인 계정에 대한 기존 규칙을 남겨둬야 합니다.
3. 기존 규칙의 `match /databases/{database}/documents { ... }` 안에 `firestore.rules` 의 함수들과 `match` 블록들을 **추가**하는 방식으로 합칩니다.
4. 학부모용 보강 예약 페이지가 로그인 없이 `makeupOpenings` 나 `bookingSettings` 를 직접 읽는다면
   `firestore.rules` 맨 아래 주석에 있는 두 줄(`allow read: if true;`)을 추가합니다. Cloud Function 을 통해서만 접근한다면 필요 없습니다.

## 규칙을 고쳤을 때 검증하기 (선택)

`tools/rules_test.mjs` 가 Firestore 에뮬레이터에서 규칙을 자동으로 검사합니다 (직원·관리자·비로그인·허용 안 된 구글 계정 등 94가지 경우).
Java 가 설치돼 있어야 합니다.

```bash
cd tools
npm install
npm run test:rules
```

마지막 줄에 `ALL 94 RULES TESTS PASSED` 가 나오면 됩니다. 이메일 목록을 바꿨다면 테스트 파일 안의 계정 이메일도 맞춰 주세요.

## 배포 후 확인

- 직원 계정으로 로그인해 반 배정 업로드, 결석 표시, 보강 등록, 상담 기록 추가·삭제, 문자 대기열 등록이 되는지 확인합니다.
- 관리자 계정으로 학생 DB → 완전삭제, 학생 기록 이전이 되는지 확인합니다.
- 관리자가 아닌 계정에서는 학생 DB에 완전삭제·기록 이전 버튼이 보이지 않고,
  억지로 시도하면 "이 작업을 할 권한이 없는 계정이에요"가 뜹니다.
- 허용되지 않은 구글 계정으로는 로그인 직후 로그아웃되고, 데이터가 전혀 내려오지 않아야 합니다.
