FROM python:3.10-slim

WORKDIR /app

# Copy requirements and install python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code
COPY main.py .

EXPOSE 8001

ENV PORT=8001
ENV PYTHONUNBUFFERED=1

CMD ["python", "main.py"]
