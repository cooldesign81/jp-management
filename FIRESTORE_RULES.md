# Firestore 보안 규칙과 직원 로그인 안내

## 누가 들어올 수 있나

| 계정 | 들어올 수 있는 조건 | 역할 |
|---|---|---|
| 최고 관리자 (`jinhyuck@gmail.com`) | 항상 (Google 로그인) | 관리자 |
| 교사 구글 계정 | 그 원의 **직원 목록**에 이메일이 있을 때만 | 목록에서 정한 역할 (교사 또는 관리자) |
| 원 공용 이메일/비밀번호 계정 (예: `jarada-banpo@naver.com`) | 항상 | 교사. 직원 목록에 "관리자"로 넣으면 관리자 |
| 그 밖의 계정, 로그인 안 한 사람 | 전부 거부 | — |

- **교사**: 반 배정, 출결, 보강, 상담, 문자 등 일반 업무 전부.
- **관리자**: 교사 권한 + 학생 완전삭제·학생 기록 이전 + 직원 관리.
- 원마다 Firebase 프로젝트가 따로라서 **직원 목록도 원마다 따로**입니다. 두 원에서 일하는 교사는 두 원에 각각 등록합니다.

## 교사 추가하는 법 (규칙 게시 후에는 이것만 하면 됩니다)

1. 교사에게 구글 계정 이메일을 받습니다. gmail 이 아니어도 구글 계정에 등록된 주소면 됩니다.
2. 관리자 계정으로 앱에 로그인해 상단의 **👥 직원 관리**를 누릅니다.
3. 이메일, 이름(선택), 역할을 넣고 **추가**를 누릅니다.
4. 교사는 앱에서 원을 고르고 **Google로 로그인**을 누르면 됩니다.

- 등록 안 된 구글 계정으로 로그인하면 "OOO 계정은 아직 등록되지 않았어요"라는 안내가 뜨고 바로 로그아웃됩니다. 교사가 그 이메일을 알려주면 그대로 추가하면 됩니다.
- 목록에서 삭제하면 그 교사는 바로 로그아웃되고 다시 들어올 수 없습니다.
- 관리자는 실수로 잠기지 않도록 자기 자신을 삭제하거나 교사로 바꿀 수 없습니다 (최고 관리자만 가능).

## 처음 한 번 하는 배포 순서

1. **앱 배포**: 이 변경이 담긴 PR 을 main 에 머지합니다 (GitHub Pages 가 1~2분 뒤 반영).
2. **보안 규칙 게시**: Firebase 콘솔 → Firestore Database → 규칙 탭에서 기존 내용을 지우고 붙여넣은 뒤 게시합니다.
   - 반포 `jarada-banpo`, 대치 `jarada-daechi`: `firestore.rules`
   - 평촌 `jarada-checkin`: `firestore.pyeongchon.rules` (결제 매니저가 쓰는 `centers`, `userCenters` 와 공용 `smsQueue` 는 예전처럼 허용)
3. **교사 등록**: 최고 관리자 계정으로 각 원에 로그인해 직원 관리에서 교사들을 추가합니다.
4. **아무나 계정을 못 만들게 막기**: 각 프로젝트의 Authentication → 설정(Settings) → 사용자 작업(User actions)에서
   **"생성(가입) 사용 설정 / Enable create (sign-up)"** 체크를 끄고 저장합니다.
   이걸 켜두면 앱의 공개 설정값만으로 누구나 이메일/비밀번호 계정을 새로 만들어 교사 권한으로 들어올 수 있습니다.
   꺼도 콘솔에서 직접 계정을 만드는 것과 Google 로그인은 그대로 됩니다.

- 1번과 2번은 순서가 바뀌어도 괜찮습니다. 단, **이전 버전 규칙(직원 목록이 없던 버전)을 이미 게시했다면** 2번을 먼저 해야 3번(직원 추가)이 됩니다.
- 문제가 생기면 규칙 탭 왼쪽의 이전 버전을 눌러 다시 게시하면 바로 되돌아갑니다.

## 규칙이 하는 일

| 대상 | 교사 | 관리자 | 그 밖의 계정 |
|---|---|---|---|
| 반 배정, 사진, 결석/반이동 표시, 보강 등록, 임시 교실, 문자 템플릿, SMS 설정, 메모, 일일보고, 보강 자리, 예약 설정, 문자 대기열 | 읽기·쓰기 | 읽기·쓰기 | 거부 |
| 출결 기록, 상담 기록 | 읽기·추가·수정 | + 문서 삭제 | 거부 |
| 직원 목록 (`staff`) | 읽기 | + 추가·수정·삭제 | 자기 이메일 문서 확인만 |
| 규칙에 없는 다른 컬렉션 | 거부 | 거부 | 거부 |

- 발송 서버(문자 상태 갱신), 연말 정산 서버, 학부모 예약용 Cloud Function 은 Admin SDK 를 쓰므로 규칙의 영향을 받지 않습니다.
- 학부모용 보강 예약 페이지가 로그인 없이 `makeupOpenings` 나 `bookingSettings` 를 직접 읽는다면 규칙 맨 아래 주석의 두 줄을 추가합니다.

## 규칙을 고칠 때

- 최고 관리자를 바꾸려면 `firestore.rules` 의 `superAdminEmails()` 와 `index.html` 의 `SUPER_ADMIN_EMAILS` 를 같이 고칩니다. 교사 추가에는 고칠 필요가 없습니다.
- `firestore.pyeongchon.rules` 는 직접 고치지 않습니다. `firestore.rules` 를 고친 뒤 아래 명령으로 다시 만듭니다.
  결제 매니저가 새 컬렉션을 쓰기 시작하면 `tools/build_pyeongchon_rules.mjs` 의 목록에 이름을 추가하고 다시 만듭니다.
- `tools/rules_test.mjs` 가 Firestore 에뮬레이터에서 두 규칙 파일을 자동으로 검사합니다 (Java 필요).

```bash
cd tools
npm install
npm run build:rules   # firestore.pyeongchon.rules 다시 만들기
npm run test:rules    # 다시 만든 뒤 에뮬레이터에서 검사
```

마지막 줄에 `ALL ... RULES TESTS PASSED` 가 나오면 됩니다.

### CLI 로 배포하기 (선택)

```bash
npm install -g firebase-tools
firebase login
firebase use banpo  && firebase deploy --only firestore:rules
firebase use daechi && firebase deploy --only firestore:rules
# 평촌은 파일이 달라서 콘솔에 firestore.pyeongchon.rules 를 붙여넣는 쪽을 권합니다.
```
