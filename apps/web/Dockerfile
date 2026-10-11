# Opaq web app. Build from the repo root:
#   docker build -f apps/web/Dockerfile -t opaq-web \
#     --build-arg NEXT_PUBLIC_RPC_URL=... --build-arg NEXT_PUBLIC_OPAQ_SERVER_URL=... .
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time: never pass a secret.
FROM node:24-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @opaq/web...

COPY packages/sdk packages/sdk
COPY apps/web apps/web

ARG NEXT_PUBLIC_OPAQ_CLUSTER=devnet
ARG NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
ARG NEXT_PUBLIC_OPAQ_SERVER_URL=
ARG NEXT_PUBLIC_OPAQ_ENABLED_CHAINS=solana
ENV NEXT_PUBLIC_OPAQ_CLUSTER=$NEXT_PUBLIC_OPAQ_CLUSTER \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_OPAQ_SERVER_URL=$NEXT_PUBLIC_OPAQ_SERVER_URL \
    NEXT_PUBLIC_OPAQ_ENABLED_CHAINS=$NEXT_PUBLIC_OPAQ_ENABLED_CHAINS
RUN pnpm --filter @opaq/web build

USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@opaq/web", "start"]
