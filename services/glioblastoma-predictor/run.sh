#!/bin/bash

# Build and run the Glioblastoma Drug Sensitivity Predictor

echo "Building Docker image..."
docker build -t glioblastoma-predictor .

echo "Running container..."
docker run -d -p 5000:5000 --name glioblastoma-predictor glioblastoma-predictor

echo "Waiting for service to start..."
sleep 10

echo "Testing API..."
curl -X GET http://localhost:5000/health

echo -e "\n\nService is running at http://localhost:5000"
echo "API documentation available at http://localhost:5000/"
echo -e "\nTo test the API, run: python test_api.py"
echo -e "\nTo stop the service, run: docker stop glioblastoma-predictor"