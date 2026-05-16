FROM node:22-alpine AS frontend
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client ./
RUN npm run build

FROM node:22-alpine AS api
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server ./
COPY --from=frontend /app/client/dist ../client/dist

ENV NODE_ENV=production
ENV FRONTEND_DIST=../client/dist
EXPOSE 3000
CMD ["node", "index.js"]
