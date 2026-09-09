# DocuSphere web — Next.js standalone output.
# Build context MUST be the repo root:  docker build -f web/Dockerfile .
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json ./web/
COPY server/package.json ./server/
RUN npm ci

FROM node:20-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY web ./web
ARG NEXT_PUBLIC_API_BASE=http://localhost:4000
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN npm run build --workspace web

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN useradd --system --uid 1001 nextjs
# Standalone bundle: server.js + pruned node_modules + static assets.
COPY --from=build --chown=nextjs:nextjs /app/web/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/web/.next/static ./web/.next/static
COPY --from=build --chown=nextjs:nextjs /app/web/public ./web/public
USER nextjs
EXPOSE 3000
CMD ["node", "web/server.js"]
