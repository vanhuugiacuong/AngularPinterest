FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the birefnet-general-lite model weights (~224MB) to cache them inside
# the Docker image, so the container doesn't fetch it on first request at runtime.
RUN python -c 'from rembg import new_session; new_session("birefnet-general-lite")'

# Copy the application code
COPY main.py .

EXPOSE 8002

ENV PORT=8002
ENV PYTHONUNBUFFERED=1

CMD ["python", "main.py"]
