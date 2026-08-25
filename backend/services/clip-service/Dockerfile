FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the CLIP model weights to cache them inside the Docker image,
# so a fresh container (e.g. a HuggingFace Space rebuild) starts serving
# immediately instead of downloading on first request.
RUN python -c 'from transformers import CLIPProcessor, CLIPModel; \
    CLIPModel.from_pretrained("openai/clip-vit-base-patch32"); \
    CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")'

# Copy the application code
COPY main.py .

# 7860 is HuggingFace Spaces' default container port for Docker SDK Spaces.
# Local docker-compose.yml overrides PORT=8001 so nothing else needs to change.
EXPOSE 7860

ENV PORT=7860
ENV PYTHONUNBUFFERED=1

CMD ["python", "main.py"]
