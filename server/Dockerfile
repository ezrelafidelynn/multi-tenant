# DocuSphere API + ingestion worker (one image, two commands).
# Build context MUST be the repo root:  docker build -f server/Dockerfile .
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
RUN npm run build --workspace server

FROM node:20-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
COPY --from=deps /usr/bin/dumb-init /usr/bin/dumb-init
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/server/dist ./dist
COPY server/migrations ./migrations
COPY server/package.json ./package.json
EXPOSE 4000
ENTRYPOINT ["dumb-init", "--"]
# API:    node dist/index.js       Worker: node dist/ingestion/worker.js
CMD ["node", "dist/index.js"]
