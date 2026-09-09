# DocuSphere API + worker image (same image, different command)
FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY package.json ./
EXPOSE 4000
ENTRYPOINT ["dumb-init", "--"]
# API:    docker run ... node dist/index.js
# Worker: docker run ... node dist/ingestion/worker.js
CMD ["node", "dist/index.js"]
