FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libfreetype6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY etf_compare.py etf_compare_excel.py etf_compare_charts.py etf_compare_analyst.py etf_compare_pipeline.py ./
COPY scheduler_grace.py heavy_work.py memory_debug.py ./
COPY analysis.py bot.py stock_crawler.py news_crawler.py etf_names.py ai_briefing.py summary_builder.py summary_pdf.py summary_analyst.py summary_scheduler.py market_data_freshness.py heatmap.py financial_data.py financial_charts.py financial_pipeline.py dart_data.py dart_charts.py dart_pipeline.py dart_etf_memb.py dart_etf_memb_charts.py finnhub_market.py yahoo_market.py premarket_rankings.py chart_buffers.py kakao_notify.py ./
COPY macro_data.py macro_supplements.py macro_scores.py macro_charts.py macro_analyst.py macro_pipeline.py macro_scheduler.py ./
COPY adr_analysis.py adr_charts.py adr_data_loader.py adr_excel_export.py adr_mapping.py adr_pipeline.py adr_providers.py ./
COPY colab/ETF_Master.xlsx colab/etf_tickers.txt colab/sp500_tickers.txt colab/nasdaq100_tickers.txt colab/
COPY web/ web/
RUN mkdir -p data

ENV PYTHONUNBUFFERED=1

CMD ["python", "bot.py"]
