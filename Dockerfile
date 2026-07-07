FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libfreetype6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY analysis.py bot.py stock_crawler.py news_crawler.py summary_builder.py summary_scheduler.py ./
COPY colab/ETF_Master.xlsx colab/
RUN mkdir -p data

ENV PYTHONUNBUFFERED=1

CMD ["python", "bot.py"]
