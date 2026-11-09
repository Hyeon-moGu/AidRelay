#!/usr/bin/env bash
# Schedules the Case Officer's sweep on Cloud Scheduler: every 10 minutes it calls the service's own
# /api/agent/run with {"trigger":"sweep"}. The sweep retries cases a lost trigger left behind, resets stale
# evaluation locks, pays waiting cases the balance covers and polls payouts whose webhook is late.
# A sweep that finds nothing calls no model and records no run, so the schedule costs nothing while idle.
#
# Usage: scripts/schedule-sweep.sh [PROJECT_ID] [REGION] [SERVICE] [CRON]
#   pause (for example while recording a demo):  gcloud scheduler jobs pause  aidrelay-sweep --location us-central1
#   resume:                                      gcloud scheduler jobs resume aidrelay-sweep --location us-central1
#
# The run endpoint is protected by AGENT_INTERNAL_SECRET, sent as the x-agent-secret header. The value is
# read from .env by the same parser that writes Cloud Run's environment (scripts/env-file.mjs), and it is
# checked against the live service before the job is created, so a job that would only collect 401s is
# never scheduled. The secret must not contain a comma: gcloud splits the --headers list on commas.
set -euo pipefail

PROJECT="${1:-aidrelay-demo}"
REGION="${2:-us-central1}"
SERVICE="${3:-aidrelay}"
CRON="${4:-*/10 * * * *}"
JOB="${SERVICE}-sweep"

SECRET="$(node scripts/env-value.mjs AGENT_INTERNAL_SECRET)"
case "$SECRET" in
  *,*)
    echo "AGENT_INTERNAL_SECRET contains a comma, which gcloud cannot pass in --headers" >&2
    exit 1
    ;;
esac

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable cloudscheduler.googleapis.com
URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"

# Does the running service accept this secret? An empty body is refused after the secret check (400) and
# starts nothing; a wrong secret is refused before it (401).
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X POST "${URL}/api/agent/run" \
  -H "Content-Type: application/json" -H "x-agent-secret: ${SECRET}" -d '{}')"
if [ "$CODE" != "400" ]; then
  echo "The service answered ${CODE} to a request signed with the secret from .env (400 was expected)." >&2
  echo "If it is 401, Cloud Run runs with a different AGENT_INTERNAL_SECRET: redeploy with scripts/deploy-cloudrun.sh first." >&2
  exit 1
fi

if gcloud scheduler jobs describe "$JOB" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" \
    --location "$REGION" \
    --schedule "$CRON" \
    --uri "${URL}/api/agent/run" \
    --http-method POST \
    --update-headers "Content-Type=application/json,x-agent-secret=${SECRET}" \
    --message-body '{"trigger":"sweep"}' \
    --attempt-deadline 600s >/dev/null
  echo "Updated ${JOB}: ${CRON} -> ${URL}/api/agent/run"
else
  gcloud scheduler jobs create http "$JOB" \
    --location "$REGION" \
    --schedule "$CRON" \
    --uri "${URL}/api/agent/run" \
    --http-method POST \
    --headers "Content-Type=application/json,x-agent-secret=${SECRET}" \
    --message-body '{"trigger":"sweep"}' \
    --attempt-deadline 600s >/dev/null
  echo "Created ${JOB}: ${CRON} -> ${URL}/api/agent/run"
fi
