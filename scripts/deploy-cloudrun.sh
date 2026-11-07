#!/usr/bin/env bash
# Deploys AidRelay to Cloud Run from source (Cloud Build builds the Dockerfile; no local Docker needed).
# Usage: scripts/deploy-cloudrun.sh [PROJECT_ID] [REGION] [SERVICE]
set -euo pipefail

PROJECT="${1:-aidrelay-demo}"
REGION="${2:-us-central1}"
SERVICE="${3:-aidrelay}"
SA="aidrelay-server@${PROJECT}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# First pass: APP_URL may still be localhost; the service URL is only known after the deploy.
node scripts/cloudrun-env.mjs "${APP_URL:-}"

gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --service-account "$SA" \
  --min-instances 1 \
  --memory 1Gi \
  --cpu 1 \
  --no-cpu-throttling \
  --timeout 600 \
  --env-vars-file deploy/env.yaml

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
echo "Service URL: $URL"

# Second pass: point APP_URL at the service itself (the agent trigger calls the app at this URL).
node scripts/cloudrun-env.mjs "$URL"
gcloud run services update "$SERVICE" --region "$REGION" --env-vars-file deploy/env.yaml >/dev/null
echo "APP_URL set to $URL"
echo
echo "Next: register the PayPal webhook at ${URL}/api/webhooks/paypal,"
echo "put its id in .env as PAYPAL_WEBHOOK_ID, then run:"
echo "  gcloud run services update $SERVICE --region $REGION --update-env-vars PAYPAL_WEBHOOK_ID=<id>"
