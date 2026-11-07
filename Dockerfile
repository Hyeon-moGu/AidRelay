# AidRelay on Cloud Run: Next.js standalone server, built on Cloud Build (`gcloud run deploy --source .`).
FROM node:22-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@12.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_STANDALONE=1
RUN npm install -g pnpm@12.18.0
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# policy.md is read at runtime by the agent (lib/agent/policy.ts).
COPY --from=build --chown=app:app /app/policy.md ./policy.md
USER app
EXPOSE 8080
CMD ["node", "server.js"]
