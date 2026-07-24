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

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy every Python module so new features are not dropped from the image.
COPY *.py ./
COPY assets/ assets/
COPY colab/ colab/
COPY data/universes/ data/universes/
COPY web/ web/
RUN mkdir -p data/fonts \
    && cp assets/fonts/NanumGothic.ttf data/fonts/NanumGothic.ttf

ENV PYTHONUNBUFFERED=1

CMD ["python", "bot.py"]
