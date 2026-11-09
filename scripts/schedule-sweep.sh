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
# The run endpoint is protected by AGENT_INTERNAL_SECRET (read from .env, sent as the x-agent-secret header).
# The secret must not contain a comma: gcloud splits the --headers list on commas.
set -euo pipefail

PROJECT="${1:-aidrelay-demo}"
REGION="${2:-us-central1}"
SERVICE="${3:-aidrelay}"
CRON="${4:-*/10 * * * *}"
JOB="${SERVICE}-sweep"

SECRET="$(grep -E '^AGENT_INTERNAL_SECRET=' .env | head -1 | cut -d= -f2- | sed -e 's/[[:space:]]#.*$//' -e 's/^"//' -e 's/"$//')"
if [ -z "$SECRET" ]; then
  echo "AGENT_INTERNAL_SECRET is not set in .env" >&2
  exit 1
fi

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable cloudscheduler.googleapis.com
URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"

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
