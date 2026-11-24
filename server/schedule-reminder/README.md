# 스케줄 매니저 자동 예약 문자 서버 (schedule-reminder)

스케줄 매니저 문자 설정의 **🤖 자동 예약 문자**를 서버에서 처리합니다.
결제 매니저의 결제 안내 자동 예약(`payment-reminder`)과 같은 방식이에요.

- **오전 8시~저녁 7시 50분 사이 10분마다** Google Cloud에서 혼자 돕니다.
- 원마다 지금이 다음 날 일정 문자를 걸어 둘 때인지 보고, 그 날짜 일정 문자를 문자 대기열(`smsQueue`)에 맞춥니다.
- 실제 발송은 지금처럼 `sms-relay-scheduler`가 1분마다 대기열을 보고 처리합니다.

이렇게 하면 앱을 아무도 안 켜는 날에도 빠지지 않습니다. 컴퓨터가 꺼져 있어도, 어떤 계정으로 로그인했든 상관없어요.

## 동작 규칙 (스케줄 매니저 화면과 같음)

- 원마다 문자 설정의 **자동 예약 문자가 켜져 있을 때만** 합니다.
- **걸어 두는 때**
  - 전날이 근무일이면: 전날 "걸어 두는 시각"(기본 09:00)부터 "보내는 시각"(기본 19:00)까지
  - 전날이 쉬는 요일이면: 그 앞 마지막 근무일의 "쉬는 날 다음 날 일정 걸어 두는 시각"(기본 18:00)부터
  - 예: 일·월 휴무면 화요일 일정 문자는 토요일 18:00에 걸고, 월요일 19:00에 나갑니다.
- 고른 유형(샘플·신규·보강·대체in·반이동in)의 다음 날 일정을 **학생마다 한 건씩** 겁니다.
  - 문구는 유형별 저장 문구(없으면 기본 문구)를 씁니다.
- 일정이 바뀌면 대기열도 따라갑니다.
  - 일정이 없어지면 지웁니다.
  - 시간·문구가 바뀌면 고칩니다.
  - **아직 '대기 중'인 자동 문자만** 손댑니다.
  - 방금(90초 안) 건 문자는 지우지 않습니다.
- 대기열에서 **직접 취소한 자동 문자**(`settings/autoSmsSkips`)는 다시 걸지 않습니다.
- 보내는 시각 뒤 5분 동안은 지우기만 하고, 그 뒤에는 손대지 않습니다.
- 문서 이름이 스케줄 매니저 화면과 같아서(`auto_원_날짜_유형_학생`) 서버와 화면이 같이 걸어도 한 건만 남습니다.
  - 낮에 일정을 바꾸면 화면이 몇 초 안에 먼저 맞추고, 서버는 10분마다 한 번 더 확인합니다.
- 실행할 때마다 결과를 원마다 `settings/autoSmsServer`에 남깁니다.
  - 문자 설정 창에 "서버 자동 예약: 11/24 09:00 · 11/25 일정 3건 걸음"처럼 보입니다.

## 설치 (한 번만, 약 10분)

1. [Google Cloud 콘솔](https://console.cloud.google.com/)에서 프로젝트가 **Jarada-checkin**인지 확인합니다.
   - 결제 매니저 자동 예약을 설치한 곳과 같은 프로젝트입니다.
2. 오른쪽 위 **Cloud Shell 활성화**(`>_` 모양) 버튼을 누릅니다.
3. 아래 두 줄을 붙여 넣고 Enter. 중간에 API를 켜겠냐고 물으면 `y`.

```bash
git clone https://github.com/cooldesign81/jp-management.git
bash jp-management/server/schedule-reminder/deploy.sh
```

스크립트가 하는 일:

1. `schedule-reminder` 함수를 `asia-northeast3`에 배포 (로그인 없이는 부를 수 없게)
2. 함수 실행 계정에 평촌·반포·대치 Firebase 프로젝트의 **Cloud Datastore 사용자** 권한 부여
   - 세 프로젝트의 소유자 계정으로 Cloud Shell에 들어와 있어야 합니다.
   - 실패하면 화면에 콘솔에서 직접 주는 방법이 나옵니다.
3. `sms-relay-scheduler`가 쓰는 실행 계정에 이 함수를 부를 권한 부여
4. 8시~19시 50분 사이 10분마다 함수를 부르는 `schedule-reminder-every10` 작업 생성
5. **시험 실행**: 내일 일정 중 누구에게 걸지 결과만 보여 줌 (실제로 걸지 않음)

마지막에 이런 결과가 나오면 성공입니다.
- `created`는 걸릴 학생입니다.
- `note`가 "자동 예약 꺼짐"이면 그 원의 문자 설정에서 아직 안 켠 것입니다.

```json
{"ok":true,"dryRun":true,"results":[{"center":"평촌원","results":[{"date":"2026-11-25","created":[{"name":"…","category":"보강"}],…}]}, …]}
```

## 확인과 시험

- **Cloud Scheduler** 화면에 `schedule-reminder-every10`이 생기고 "Success"가 찍히면 정상입니다.
- 스케줄 매니저 **문자 대기열**에서 "🤖 자동" 표시가 붙은 문자를 확인합니다.
- 문자 설정 창 아래에 서버 실행 결과가 보입니다.
- 날짜를 지정한 시험 실행 (실제로 걸지 않음):

```bash
URL=$(gcloud functions describe schedule-reminder --v2 --region=asia-northeast3 --format='value(serviceConfig.uri)')
curl -sS -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$URL?dryRun=1&date=2026-11-25"
```

`&center=banpo`(평촌 `pyeongchon`, 대치 `daechi`)를 붙이면 한 원만 봅니다.

## 코드를 고친 뒤에는

Cloud Shell에서 최신 코드를 받아 같은 스크립트를 다시 실행하면 됩니다.

```bash
cd ~/jp-management && git pull && bash server/schedule-reminder/deploy.sh
```

## 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| 결과의 `error`에 `PERMISSION_DENIED` | 그 원 프로젝트에서 함수 실행 계정에 **Cloud Datastore 사용자** 역할을 줬는지 (스크립트 [2/5] 안내) |
| `note`가 "자동 예약 꺼짐" | 스케줄 매니저 문자 설정에서 그 원의 🤖 자동 예약 문자를 켰는지 |
| `note`가 "걸어 둘 때가 아님" | 정상. 걸어 두는 시각 전이거나 보내는 시각이 지났을 때 |
| `skipped`에 "번호 없음" / "장문인데 제목 없음" | 그 학생 연락처, 또는 그 유형 문구의 제목 (단체 문자 › 유형 탭에서 제목 넣고 템플릿 저장) |
| `is not a supported runtime` | `RUNTIME=nodejs24 bash server/schedule-reminder/deploy.sh` 처럼 지정 |
| 실행 작업이 실패 | Cloud Scheduler 작업의 실행 계정이 함수를 부를 권한이 있는지 (스크립트를 다시 실행하면 다시 줌) |

## 파일

- `core.js`: 받는 사람·문구·걸어 둘 때 계산
  - 스케줄 매니저 `index.html`과 같은 규칙입니다. 규칙을 바꾸면 둘 다 바꿔야 합니다.
  - `test/parity.test.js`가 두 쪽 결과가 같은지 확인합니다.
- `reminder.js`: 원마다 대기열 맞추기 (걸기·고치기·지우기)
- `index.js`: Cloud Run 함수 진입점 (`?dryRun=1`, `?date=YYYY-MM-DD`, `?center=원`)
- `deploy.sh`: Cloud Shell 배포 스크립트
- `test/`: `npm test`로 돌립니다. 화면과 같은 계산인지, 대기열 맞추기 규칙이 맞는지 확인합니다.
