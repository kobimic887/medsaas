#!/bin/bash

# Create the full chain certificate by combining your certificate with the CA bundle
cat chemtest_tech.crt chemtest_tech.ca-bundle > chemtest_tech_fullchain.crt

# Set proper permissions
chmod 644 chemtest_tech_fullchain.crt
chmod 600 chemtest_tech_private.key

echo "Full chain certificate created: chemtest_tech_fullchain.crt"
echo "Certificate files ready for use!"
