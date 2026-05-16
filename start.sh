#!/bin/bash

echo "🚀 Starting ChemBench Development Environment..."

# Ensure we're in the right directory
cd "$(dirname "$0")"

# Optional: ensure Docker services are up for the backend
echo "📦 Starting background services (MongoDB, RabbitMQ)..."
docker compose up -d mongo rabbitmq 2>/dev/null || echo "Docker not running or docker-compose.yml not found, skipping..."

# Run the root package.json dev script which starts BOTH frontend and backend
echo "🌐 Starting API and Web servers..."
npm run dev
