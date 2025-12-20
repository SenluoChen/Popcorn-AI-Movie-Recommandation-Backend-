# syntax=docker/dockerfile:1

FROM python:3.11-slim

# faiss-cpu needs libgomp on Debian slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better layer caching
COPY Popcorn/vector-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# App code
COPY Popcorn/vector-service /app

# FAISS index assets (built locally and committed in workspace under Movie-data/index)
COPY Movie-data/index /opt/data/index

ENV LOCAL_DATA_PATH=/opt/data
ENV PORT=8008

EXPOSE 8008

CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8008"]
