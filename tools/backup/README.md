# JP 스케줄 매니저 전체 백업 (원 N100 → ipTIME NAS)

매일 새벽 3시에 N100(윈도우)이 세 원(평촌·반포·대치)의 데이터를 **전부** 내려받아 ipTIME NAS 에 날짜별로 저장합니다.
N100 은 Firebase 에서 **받아오기만** 해서, 인터넷에 문을 열 필요가 없습니다.

| 들어가는 것 | |
|---|---|
| Firestore 전부 | 반 배정, 학생 사진, 출결·보강, 상담, 개인정보 비공개 표시, 문자 기록, 직원 목록, 설정, 서류 사진 정보 … (평촌은 결제 매니저 데이터도) |
| Storage 전부 | 학생 서류 사진 (첫 수업 상담지·학부모 설문지) |

보관: 최근 **30일은 매일 것**, 그보다 오래된 것은 **매월 1일 것만** 계속 남깁니다.

---

## 1. 준비 (처음 한 번)

### 1-1. Node.js 설치
https://nodejs.org 에서 **LTS** 버전을 받아 설치합니다 (설치 화면은 전부 "다음").

### 1-2. 이 폴더를 N100 에 복사
GitHub 저장소 → **Code → Download ZIP** → 압축을 풀고 `tools/backup` 폴더를 `C:\jp-backup` 처럼 공백 없는 곳에 복사합니다.

### 1-3. `1-install.cmd` 더블클릭
필요한 프로그램을 받고 `config.json`, `keys` 폴더를 만듭니다.

### 1-4. 원별 "서비스 계정 키" 받기 (3번 반복)
1. Firebase 콘솔에서 원 프로젝트를 엽니다 (평촌 `jarada-checkin`, 반포 `jarada-banpo`, 대치 `jarada-daechi`).
2. 왼쪽 위 ⚙️ → **프로젝트 설정** → **서비스 계정** 탭 → **새 비공개 키 생성** → **키 생성**.
3. 받은 JSON 파일 이름을 바꿔 `keys` 폴더에 넣습니다.
   - `keys\jarada-checkin.json` · `keys\jarada-banpo.json` · `keys\jarada-daechi.json`

> ⚠️ **이 키 파일은 원 데이터 전체의 비밀번호와 같습니다.**
> 채팅·카톡·메일로 보내지 말고, NAS 나 USB 에도 두지 말고, **N100 의 `keys` 폴더에만** 두세요.
> 잃어버렸거나 새어 나간 것 같으면 같은 화면(서비스 계정)에서 **Google Cloud 에서 키 관리** → 그 키를 삭제하면 바로 못 쓰게 됩니다.
> N100 윈도우 계정에는 꼭 로그인 비밀번호를 걸어 두세요.

### 1-5. NAS 공유 폴더 연결
1. ipTIME NAS 관리 화면에서 공유 폴더(예: `backup`)를 만들고 N100 이 쓸 계정을 줍니다.
2. N100 파일 탐색기 주소창에 `\\NAS주소` (예: `\\192.168.0.10`) 를 입력 → 아이디·비밀번호 입력 시 **"자격 증명 기억"** 을 체크합니다.
3. `config.json` 을 메모장으로 열어 `outputDir` 을 고칩니다. 슬래시(`/`)로 적으면 됩니다.
   ```json
   "outputDir": "//192.168.0.10/backup/jp-schedule",
   ```
   (드라이브 문자 `Z:` 보다 이렇게 주소로 적는 게 자동 실행 때 더 확실합니다.)

### 1-6. `2-check.cmd` 더블클릭 → 연결 확인
세 원 모두 `Firestore 연결 OK` 가 나오면 됩니다. 서류 사진 저장소를 아직 안 만들었으면 `저장소 연결 안 됨` 이 나와도 정상입니다.

### 1-7. `3-backup-now.cmd` 더블클릭 → 첫 백업
NAS 의 `jp-schedule` 폴더에 `LAST_STATUS.txt` 가 생기고 `✅ 백업 성공` 이면 끝입니다.

### 1-8. `4-register-daily-task.cmd` 더블클릭 → 매일 자동 백업 등록
- 매일 새벽 3시에 돌아갑니다. **그 시간에 N100 이 켜져 있고 로그인돼 있어야** 합니다.
  (설정 → 시스템 → 전원: 절전 모드 "안 함")
- 로그아웃 상태에서도 돌리고 싶으면: 작업 스케줄러 → `JP-Schedule-Backup` → 속성 → "사용자의 로그온 여부에 관계없이 실행" → 윈도우 비밀번호 입력.

---

## 2. 평소에 볼 것

- **NAS 의 `LAST_STATUS.txt`** 만 가끔 열어 보세요. 날짜가 오늘(또는 어제)이고 `✅` 면 정상입니다.
- 실패했으면 같은 폴더의 `backup-log.txt` 맨 아래를 보세요. NAS 에 못 닿으면 N100 의 이 폴더에 `LAST_ERROR.txt` 가 생깁니다.
- NAS 와 N100 이 같은 원에 있어서 화재·도난·침수에는 같이 잃습니다. **한 달에 한 번은 외장하드에 `jp-schedule` 폴더를 복사**해 두세요.

## 3. 폴더 구조

```
jp-schedule\
  LAST_STATUS.txt            마지막 결과
  backup-log.txt             실행 기록
  banpo\                     (pyeongchon, daechi 도 같음)
    daily\2026-10-22\
      firestore\*.ndjson     컬렉션별 문서 (한 줄에 문서 하나)
      storage-manifest.json  그날 있던 서류 사진 목록
      summary.json           문서 수·파일 수·걸린 시간
    storage\studentDocs\…    서류 사진 파일 (바뀐 것만 새로 받고, 지워진 사진도 남겨 둠)
```
`.partial` 로 끝나는 폴더는 끝나지 못한 백업입니다 (다음 백업 때 자동으로 지워집니다).

## 4. 비용

- 매일 원마다 Firestore 문서를 한 번씩 전부 읽습니다 (문서 수만큼 읽기). 하루 무료 5만 번 안이면 0원입니다.
- 서류 사진은 바뀐 것만 받아서 거의 0원입니다.

## 5. 복원 (필요할 때만 — 되돌릴 수 없으니 천천히)

명령 프롬프트(cmd)에서 이 폴더로 이동한 뒤:

```
node restore.mjs --from //192.168.0.10/backup/jp-schedule/banpo/daily/2026-10-22 --to banpo --dry-run
```
- `--dry-run` 은 **무엇을 할지 보여주기만** 합니다. 확인한 뒤 `--dry-run` 을 빼고 실행하면, 받는 프로젝트 id 를 직접 입력해야 시작합니다.
- 받는 쪽에 이미 데이터가 있으면 멈춥니다. 정말 덮어쓸 때만 `--overwrite` 를 붙이세요 (백업에 있는 문서만 바뀌고, 그 뒤에 새로 생긴 문서는 그대로).
- 일부만: `--collections attendance,counseling` · 빼고: `--exclude centers,userCenters` · 한쪽만: `--only firestore` 또는 `--only storage`
- **평촌 DB 분리**(새 프로젝트로 옮기기): 새 프로젝트의 키를 `keys` 에 넣고
  ```
  node restore.mjs --from <평촌 백업 폴더> --to <새 프로젝트 id> --key keys/새키.json --bucket <새 프로젝트 id>.firebasestorage.app --exclude centers,userCenters
  ```
  (결제 매니저 데이터 `centers`, `userCenters` 는 빼고 옮깁니다. 문자 기록 `smsQueue` 는 다른 원 결제 매니저 문자도 섞여 있으니 옮길지 따로 정하세요.)

## 6. (선택) 더 안전하게: 백업 전용 "읽기만 되는" 키

위의 키는 데이터를 지울 수도 있는 관리자 키입니다. 항상 켜져 있는 N100 에는 **읽기만 되는 키**를 두는 게 더 안전합니다.
1. Google Cloud 콘솔 → 해당 프로젝트 → IAM 및 관리자 → 서비스 계정 → **서비스 계정 만들기** (이름 예: `jp-backup`)
2. 역할: **Cloud Datastore 뷰어**, **저장소 개체 뷰어** 두 개
3. 만든 계정 → 키 → 키 추가 → JSON → 이 파일을 `keys` 에 넣습니다.
복원할 때만 1-4 의 관리자 키를 잠깐 쓰세요 (`--key` 로 지정).
이 키로 `2-check.cmd` 가 실패하면(권한 부족) 1-4 의 키를 쓰면 됩니다.

## 7. 개발자용 테스트

`tools` 폴더에서 (Firestore·Storage 에뮬레이터 사용):
```
cd backup && npm install && cd ..
npx firebase emulators:exec --only firestore,storage --project demo-jp-src "node backup/emulator_test.mjs"
```
