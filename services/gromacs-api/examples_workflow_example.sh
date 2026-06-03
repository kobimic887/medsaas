#!/bin/bash

API_URL="http://localhost:8000"

# Upload PDB file
echo "Uploading PDB file..."
curl -X POST "$API_URL/files/upload" \
  -F "file=@protein.pdb"

# Run pdb2gmx
echo "Running pdb2gmx..."
JOB_ID=$(curl -X POST "$API_URL/workflows/pdb2gmx" \
  -H "Content-Type: application/json" \
  -d '{
    "pdb_file": "protein.pdb",
    "force_field": "oplsaa",
    "water": "spce",
    "output_prefix": "processed",
    "working_dir": "."
  }' | jq -r '.job_id')

echo "Job ID: $JOB_ID"

# Wait for job to complete
while true; do
  STATUS=$(curl -s "$API_URL/jobs/$JOB_ID" | jq -r '.status')
  echo "Status: $STATUS"
  
  if [ "$STATUS" == "completed" ] || [ "$STATUS" == "failed" ]; then
    break
  fi
  
  sleep 2
done

# Download results
if [ "$STATUS" == "completed" ]; then
  echo "Downloading results..."
  curl "$API_URL/files/download/processed.gro" -o processed.gro
  curl "$API_URL/files/download/processed.top" -o processed.top
  echo "Done!"
else
  echo "Job failed!"
  curl -s "$API_URL/jobs/$JOB_ID/logs"
fi