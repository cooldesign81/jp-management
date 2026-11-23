#!/usr/bin/env bash
# Google Cloud Shell(Jarada-checkin 프로젝트 — 결제 매니저 자동 예약과 같은 곳)에서 실행:
#   git clone https://github.com/cooldesign81/jp-management.git && bash jp-management/server/schedule-reminder/deploy.sh
# 스케줄 매니저 '자동 예약 문자' 서버 함수(schedule-reminder)를 배포하고,
# 함수가 평촌·반포·대치 세 Firebase 프로젝트의 Firestore 를 읽고 쓸 수 있게 권한을 준 뒤,
# 8시~19시 50분 사이 10분마다(한국 시간) 부르는 작업(schedule-reminder-every10)을 만들거나 고치고,
# 실제로 걸지 않는 시험 실행 결과를 보여 줌.
# 다시 실행해도 됨 — 코드를 고친 뒤에도 같은 명령으로 다시 배포.
set -euo pipefail

REGION="asia-northeast3"
FUNC="schedule-reminder"
JOB="schedule-reminder-every10"
SCHEDULE="${SCHEDULE:-*/10 8-19 * * *}"
CENTER_PROJECTS="${CENTER_PROJECTS:-jarada-pyeongchon jarada-banpo jarada-daechi}"

cd "$(dirname "$0")"
PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [ -z "$PROJECT" ]; then
  echo "프로젝트가 선택되지 않았어요. 먼저 실행: gcloud config set project <Jarada-checkin 프로젝트 ID>"
  exit 1
fi
echo "프로젝트: $PROJECT"

echo
echo "[1/5] 함수 배포 (몇 분 걸려요. API를 켜겠냐고 물으면 y)"
RUNTIME="${RUNTIME:-}"
if [ -z "$RUNTIME" ]; then
  AVAILABLE="$(gcloud functions runtimes list --region="$REGION" --format='value(name)' 2>/dev/null | grep -E '^nodejs[0-9]+$' | sort -V || true)"
  if [ -z "$AVAILABLE" ] || echo "$AVAILABLE" | grep -qx nodejs22; then
    RUNTIME=nodejs22
  else
    RUNTIME="$(echo "$AVAILABLE" | tail -1)"
  fi
fi
echo "Node.js 런타임: $RUNTIME"
gcloud functions deploy "$FUNC" \
  --gen2 --region="$REGION" --runtime="$RUNTIME" --source=. \
  --entry-point=scheduleReminder --trigger-http --no-allow-unauthenticated \
  --set-env-vars=TZ=Asia/Seoul --memory=256Mi --timeout=120s
URL="$(gcloud functions describe "$FUNC" --v2 --region="$REGION" --format='value(serviceConfig.uri)' 2>/dev/null || true)"
if [ -z "$URL" ]; then
  URL="$(gcloud run services describe "$FUNC" --region="$REGION" --format='value(status.url)')"
fi
if [ -z "$URL" ]; then echo "함수 주소를 찾지 못했어요. 배포 결과를 확인해 주세요."; exit 1; fi
echo "함수 주소: $URL"

echo
echo "[2/5] 함수가 세 원의 Firestore 를 읽고 쓸 수 있게 권한 주기 (Cloud Datastore 사용자)"
RUN_SA="$(gcloud functions describe "$FUNC" --v2 --region="$REGION" --format='value(serviceConfig.serviceAccountEmail)' 2>/dev/null || true)"
if [ -z "$RUN_SA" ]; then
  PN="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  RUN_SA="${PN}-compute@developer.gserviceaccount.com"
fi
echo "함수 실행 계정: $RUN_SA"
FAILED=""
for P in $CENTER_PROJECTS; do
  if gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$RUN_SA" --role="roles/datastore.user" --condition=None >/dev/null 2>&1; then
    echo "  $P: 권한 줌"
  else
    echo "  $P: 권한을 주지 못했어요"
    FAILED="$FAILED $P"
  fi
done
if [ -n "$FAILED" ]; then
  echo
  echo "  ⚠️ 아래 프로젝트는 직접 권한을 줘야 해요:$FAILED"
  echo "     Google Cloud 콘솔 → 위에서 그 프로젝트 선택 → IAM 및 관리자 → IAM → '액세스 권한 부여'"
  echo "     새 주 구성원: $RUN_SA   역할: Cloud Datastore 사용자"
fi

echo
echo "[3/5] 실행 작업이 함수를 부를 수 있게 권한 주기"
SA="$(gcloud scheduler jobs describe sms-relay-scheduler --location="$REGION" --format='value(httpTarget.oidcToken.serviceAccountEmail)' 2>/dev/null || true)"
if [ -z "$SA" ]; then
  PN="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  SA="${PN}-compute@developer.gserviceaccount.com"
fi
echo "작업 실행 계정: $SA"
gcloud functions add-invoker-policy-binding "$FUNC" --region="$REGION" --member="serviceAccount:$SA" >/dev/null

echo
echo "[4/5] 실행 작업 ($SCHEDULE, 한국 시간)"
if gcloud scheduler jobs describe "$JOB" --location="$REGION" >/dev/null 2>&1; then MODE=update; else MODE=create; fi
gcloud scheduler jobs "$MODE" http "$JOB" \
  --location="$REGION" --schedule="$SCHEDULE" --time-zone="Asia/Seoul" \
  --uri="$URL" --http-method=POST \
  --oidc-service-account-email="$SA" --oidc-token-audience="$URL" \
  --attempt-deadline=120s >/dev/null
echo "작업 $JOB ${MODE} 완료"

echo
echo "[5/5] 시험 실행 — 내일 일정 문자를 누구에게 걸지 보여 주기만 하고 실제로 걸지는 않아요"
TOMORROW="$(TZ=Asia/Seoul date -d tomorrow +%F 2>/dev/null || true)"
curl -sS -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$URL?dryRun=1${TOMORROW:+&date=$TOMORROW}"
echo
echo
echo "끝났어요. 스케줄 매니저 문자 설정의 '🤖 자동 예약 문자'가 켜져 있는 원만 걸려요."
echo "권한이 막힌 원은 결과에 PERMISSION_DENIED 가 보여요 — 위 [2/5] 안내대로 권한을 준 뒤 이 스크립트를 다시 실행해 주세요."
