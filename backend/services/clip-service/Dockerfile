FROM python:3.10-slim

WORKDIR /app

# Copy requirements and install python packages. --extra-index-url pulls
# torch's CPU-only wheel (no CUDA) — the default PyPI index would otherwise
# resolve a multi-GB CUDA build this container has no GPU to use.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu

# Copy the application code
COPY main.py .

EXPOSE 8001

ENV PORT=8001
ENV PYTHONUNBUFFERED=1

CMD ["python", "main.py"]
