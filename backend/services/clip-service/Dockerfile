FROM python:3.10-slim

WORKDIR /app

# Copy requirements and install python packages. --extra-index-url pulls
# torch's CPU-only wheel (no CUDA) — the default PyPI index would otherwise
# resolve a multi-GB CUDA build this container has no GPU to use.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu

# Pre-download the CLIP weights INTO the image so a cold container doesn't fetch
# ~600MB from Hugging Face on first request. This is what makes Cloud Run
# scale-to-zero usable — cold start drops from ~30-60s (download) to ~10s (load
# from the baked cache). Kept in its own layer so editing main.py never
# re-triggers the download.
RUN python -c "from transformers import CLIPModel, CLIPProcessor; m='openai/clip-vit-base-patch32'; CLIPModel.from_pretrained(m); CLIPProcessor.from_pretrained(m)"

# Copy the application code
COPY main.py .

EXPOSE 8001

ENV PORT=8001
ENV PYTHONUNBUFFERED=1

CMD ["python", "main.py"]
