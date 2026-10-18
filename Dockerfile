# Horizon Production Container
FROM python:3.12-slim

# Install system git (required for repository cloning and commit topology inspection)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY app/ ./app/
COPY scripts/ ./scripts/
COPY run.py .

# Environment defaults
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

EXPOSE 8000

# Start server using dynamic PORT environment variable (supports Render, Railway, Fly.io, Heroku)
CMD ["python", "run.py"]
