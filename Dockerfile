FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libfreetype6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY analysis.py bot.py stock_crawler.py news_crawler.py summary_builder.py summary_scheduler.py market_data_freshness.py ./
COPY adr_analysis.py adr_charts.py adr_data_loader.py adr_excel_export.py adr_mapping.py adr_pipeline.py ./
COPY colab/ETF_Master.xlsx colab/
RUN mkdir -p data

ENV PYTHONUNBUFFERED=1

CMD ["python", "bot.py"]
