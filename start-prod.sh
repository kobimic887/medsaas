#!/bin/bash

echo "🚀 Starting ChemBench in PRODUCTION mode..."

# Ensure we're in the right directory
cd "$(dirname "$0")"

echo "📦 Installing backend and frontend dependencies..."
npm run install:all

echo "🐳 Ensuring database services (MongoDB, RabbitMQ) are running..."
docker compose up -d mongo rabbitmq 2>/dev/null || echo "Docker not running or docker-compose.yml not found, skipping..."

echo "🏗️ Building the frontend and starting the unified server..."
# This will build the Vite React app into static files, then run the Node.js backend
# which is configured to serve both the API and the static frontend simultaneously.
npm start
