FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Copy .env file
COPY .env .env

# Build static assets
RUN npm run build

EXPOSE 80

CMD ["node", "server.mjs"]