FROM python:3.9-slim

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy application code
COPY . .

# Copy SSL certificates
COPY chemtest_tech_fullchain.crt /app/
COPY chemtest_tech_private.key /app/

# Set proper permissions for certificates
RUN chmod 644 chemtest_tech_fullchain.crt && \
    chmod 600 chemtest_tech_private.key

EXPOSE 5000

CMD ["python", "app.py"]
