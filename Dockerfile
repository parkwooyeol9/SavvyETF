FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libfreetype6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy every Python module so new features are not dropped from the image.
COPY *.py ./
COPY colab/ colab/
COPY data/universes/ data/universes/
COPY web/ web/
RUN mkdir -p data

ENV PYTHONUNBUFFERED=1

CMD ["python", "bot.py"]
