FROM python:3.12-slim

WORKDIR /app

# Cache-bust marker so Render rebuilds app layers after feature drops.
ARG APP_BUILD_ID=esg-brief-20260724
ENV APP_BUILD_ID=${APP_BUILD_ID}

RUN apt-get update && apt-get install -y --no-install-recommends \
    libfreetype6 \
    tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && ln -snf /usr/share/zoneinfo/Asia/Seoul /etc/localtime \
    && echo Asia/Seoul > /etc/timezone

ENV TZ=Asia/Seoul

# constraints.txt (exact pins) is produced by the "python deps lock" GitHub
# workflow. The [t] glob keeps the build working before it exists.
COPY requirements.txt constraints.tx[t] ./
RUN if [ -f constraints.txt ]; then \
      pip install --no-cache-dir -r requirements.txt -c constraints.txt; \
    else \
      pip install --no-cache-dir -r requirements.txt; \
    fi

# Root bot.py is the launcher. Collectors live in the numbered folders.
# Claude_DB/ai_pulse is the 05:10 AI 시황 collector.
COPY bot.py ./
COPY 01_봇/ 01_봇/
COPY 02_시황/ 02_시황/
COPY 03_ETF/ 03_ETF/
COPY 04_국내시장/ 04_국내시장/
COPY 05_매크로/ 05_매크로/
COPY 06_ESG/ 06_ESG/
COPY 07_공시/ 07_공시/
COPY 08_ADR/ 08_ADR/
COPY 09_매매/ 09_매매/
COPY 10_공통/ 10_공통/
COPY Claude_DB/ai_pulse/ Claude_DB/ai_pulse/
COPY Claude_Work/ Claude_Work/
COPY assets/ assets/
COPY colab/ colab/
COPY data/universes/ data/universes/
# 06:30 ACWI 종가 작업(10_공통/acwi_px.py)이 읽는 종목 목록. webapp/ 전체는 넣지 않는다.
COPY webapp/src/data/acwiYahooUniverse.json webapp/src/data/acwiYahooUniverse.json
COPY web/ web/
RUN mkdir -p data/fonts \
    && cp assets/fonts/NanumGothic.ttf data/fonts/NanumGothic.ttf

ENV PYTHONUNBUFFERED=1

CMD ["python", "bot.py"]
