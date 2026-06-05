FROM oven/bun:1.3.14-slim AS frontend
WORKDIR /app/client
COPY client/package.json client/bun.lock ./
RUN bun install --frozen-lockfile
COPY client ./
RUN bun run build

FROM oven/bun:1.3.14-slim AS api
WORKDIR /app/server
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server ./
COPY --from=frontend /app/client/dist ../client/dist

ENV NODE_ENV=production
ENV FRONTEND_DIST=../client/dist
EXPOSE 3000
CMD ["bun", "index.js"]
