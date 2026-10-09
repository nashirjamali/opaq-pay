# Opaq server (indexer + relayer). Build from the repo root:
#   docker build -f apps/server/Dockerfile -t opaq-server .
FROM node:24-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

# Manifests first so dependency layers cache across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @opaq/server...

COPY packages/sdk packages/sdk
COPY apps/server apps/server
RUN pnpm --filter @opaq/sdk build

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@opaq/server", "start"]
