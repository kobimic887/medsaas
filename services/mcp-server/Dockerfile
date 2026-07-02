FROM oven/bun:1.3.14-slim AS mcp
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src

ENV NODE_ENV=production
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8080
EXPOSE 8080
CMD ["bun", "src/http.js"]
