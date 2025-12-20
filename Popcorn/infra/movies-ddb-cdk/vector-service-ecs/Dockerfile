# syntax=docker/dockerfile:1

FROM python:3.11-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py

ENV LOCAL_DATA_PATH=/opt/data
ENV PORT=8008

EXPOSE 8008

CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8008"]
