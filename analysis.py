import io
from datetime import datetime, timedelta

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np
import pandas as pd
import yfinance as yf
from pycoingecko import CoinGeckoAPI

# Match summary / homepage dark UI; keep legend text light.
CHART_PALETTE = {
    "bg": "#0b1220",
    "panel": "#121b2d",
    "grid": "#243049",
    "text": "#e8edf7",
    "muted": "#93a4c3",
    "blue": "#60a5fa",
    "orange": "#fb923c",
    "red": "#f87171",
    "green": "#34d399",
    "purple": "#a78bfa",
}


def _style_dark_axis(ax) -> None:
    ax.set_facecolor(CHART_PALETTE["panel"])
    ax.tick_params(colors=CHART_PALETTE["muted"], labelsize=8)
    for spine in ax.spines.values():
        spine.set_color(CHART_PALETTE["grid"])
    ax.grid(True, color=CHART_PALETTE["grid"], alpha=0.35, linewidth=0.6)


def _dark_legend(ax, **kwargs) -> None:
    ax.legend(
        facecolor=CHART_PALETTE["panel"],
        edgecolor=CHART_PALETTE["grid"],
        labelcolor=CHART_PALETTE["text"],
        fontsize=8,
        **kwargs,
    )


class PortfolioSimulator:
    def __init__(self, tickers, start_date=None, end_date=None):
        self.tickers = tickers
        self.start_date = start_date or (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
        self.end_date = end_date or datetime.now().strftime("%Y-%m-%d")
        self.data = None

    def fetch_data(self):
        data_frames = {}
        for ticker in self.tickers:
            stock = yf.Ticker(ticker)
            df = stock.history(start=self.start_date, end=self.end_date)
            data_frames[ticker] = df["Close"]

        spy = yf.Ticker("SPY")
        spy_df = spy.history(start=self.start_date, end=self.end_date)
        data_frames["SPY"] = spy_df["Close"]

        self.data = pd.DataFrame(data_frames)
        return self.data

    def calculate_returns(self, weights=None):
        if self.data is None:
            self.fetch_data()

        if weights is None:
            weights = [1 / len(self.tickers)] * len(self.tickers)

        if len(weights) != len(self.tickers):
            raise ValueError("Number of weights must match number of tickers")

        daily_returns = self.data.iloc[:, :-1].pct_change()
        spy_returns = self.data["SPY"].pct_change()
        portfolio_returns = (daily_returns * weights).sum(axis=1)

        annual_return = portfolio_returns.mean() * 252
        annual_volatility = portfolio_returns.std() * np.sqrt(252)
        sharpe_ratio = annual_return / annual_volatility if annual_volatility else 0

        return {
            "daily_returns": portfolio_returns,
            "spy_returns": spy_returns,
            "cumulative_returns": (1 + portfolio_returns).cumprod(),
            "spy_cumulative_returns": (1 + spy_returns).cumprod(),
            "annual_return": annual_return,
            "annual_volatility": annual_volatility,
            "sharpe_ratio": sharpe_ratio,
        }

    def plot_returns(self):
        results = self.calculate_returns()

        fig, ax = plt.subplots(figsize=(10, 6), facecolor=CHART_PALETTE["bg"])
        _style_dark_axis(ax)
        ax.plot(results["cumulative_returns"], label="Portfolio", color=CHART_PALETTE["blue"], linewidth=1.8)
        ax.plot(results["spy_cumulative_returns"], label="SPY", color=CHART_PALETTE["orange"], linewidth=1.6)
        ax.set_title("Portfolio Performance vs SPY", color=CHART_PALETTE["text"], fontsize=12, pad=8)
        ax.set_xlabel("Date", color=CHART_PALETTE["muted"])
        ax.set_ylabel("Cumulative Returns", color=CHART_PALETTE["muted"])
        _dark_legend(ax)

        buf = io.BytesIO()
        fig.savefig(buf, format="png", facecolor=CHART_PALETTE["bg"], bbox_inches="tight")
        buf.seek(0)
        plt.close(fig)
        return buf


def _stock_history_with_indicators(symbol: str) -> pd.DataFrame:
    stock = yf.Ticker(symbol)
    df = stock.history(period="1y")
    if df.empty or len(df) < 30:
        raise ValueError(f"Not enough price history for {symbol}")

    df["MA50"] = df["Close"].rolling(window=50).mean()
    df["MA200"] = df["Close"].rolling(window=200).mean()
    df["EMA12"] = df["Close"].ewm(span=12, adjust=False).mean()
    df["EMA26"] = df["Close"].ewm(span=26, adjust=False).mean()
    df["MACD"] = df["EMA12"] - df["EMA26"]
    df["Signal"] = df["MACD"].ewm(span=9, adjust=False).mean()

    delta = df["Close"].diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.rolling(window=14, min_periods=14).mean()
    avg_loss = loss.rolling(window=14, min_periods=14).mean()
    rs = avg_gain / avg_loss
    df["RSI"] = 100 - (100 / (1 + rs))

    df["Buy_Signal"] = False
    df["Sell_Signal"] = False
    df["Buy_Signal"] = (df["MACD"] > df["Signal"]) & (df["MACD"].shift(1) <= df["Signal"].shift(1))
    df["Sell_Signal"] = (df["MACD"] < df["Signal"]) & (df["MACD"].shift(1) >= df["Signal"].shift(1))
    df.loc[df["RSI"] < 30, "Buy_Signal"] |= True
    df.loc[df["RSI"] > 70, "Sell_Signal"] |= True
    df.loc[(df["MA50"] > df["MA200"]) & (df["MA50"].shift(1) <= df["MA200"].shift(1)), "Buy_Signal"] |= True
    df.loc[(df["MA50"] < df["MA200"]) & (df["MA50"].shift(1) >= df["MA200"].shift(1)), "Sell_Signal"] |= True
    return df


def stock_ta_snapshot(symbol: str) -> dict:
    df = _stock_history_with_indicators(symbol)
    latest = df.iloc[-1]
    prev = df.iloc[-2]
    close = float(latest["Close"])
    prev_close = float(prev["Close"])
    daily_return_pct = (close / prev_close - 1) * 100 if prev_close else 0.0
    rsi = float(latest["RSI"]) if pd.notna(latest["RSI"]) else None
    macd = float(latest["MACD"]) if pd.notna(latest["MACD"]) else None
    signal = float(latest["Signal"]) if pd.notna(latest["Signal"]) else None
    ma50 = float(latest["MA50"]) if pd.notna(latest["MA50"]) else None
    ma200 = float(latest["MA200"]) if pd.notna(latest["MA200"]) else None

    if rsi is None:
        rsi_zone = "unknown"
    elif rsi >= 70:
        rsi_zone = "overbought"
    elif rsi <= 30:
        rsi_zone = "oversold"
    else:
        rsi_zone = "neutral"

    macd_bias = "neutral"
    if macd is not None and signal is not None:
        macd_bias = "bullish" if macd > signal else "bearish"

    return {
        "symbol": symbol.upper(),
        "close": round(close, 2),
        "daily_return_pct": round(daily_return_pct, 2),
        "rsi": round(rsi, 1) if rsi is not None else None,
        "rsi_zone": rsi_zone,
        "macd_bias": macd_bias,
        "price_vs_ma50": "above" if ma50 and close > ma50 else "below" if ma50 else "unknown",
        "price_vs_ma200": "above" if ma200 and close > ma200 else "below" if ma200 else "unknown",
        "golden_cross": bool(ma50 and ma200 and ma50 > ma200),
    }


def analyze_stock(symbol):
    df = _stock_history_with_indicators(symbol)

    fig, (ax1, ax2, ax3) = plt.subplots(
        3, 1, figsize=(14, 12), sharex=True, facecolor=CHART_PALETTE["bg"]
    )
    for ax in (ax1, ax2, ax3):
        _style_dark_axis(ax)

    ax1.plot(df.index, df["Close"], label="Price", color=CHART_PALETTE["blue"], linewidth=1.6)
    ax1.plot(df.index, df["MA50"], label="MA50", color=CHART_PALETTE["orange"], linewidth=1.3)
    ax1.plot(df.index, df["MA200"], label="MA200", color=CHART_PALETTE["red"], linewidth=1.3)
    buy_points = df[df["Buy_Signal"]]["Close"]
    sell_points = df[df["Sell_Signal"]]["Close"]
    ax1.scatter(buy_points.index, buy_points, color=CHART_PALETTE["green"], marker="^", s=100, label="Buy Signal", zorder=5)
    ax1.scatter(sell_points.index, sell_points, color=CHART_PALETTE["red"], marker="v", s=100, label="Sell Signal", zorder=5)
    ax1.set_title(f"{symbol.upper()} Price with Trading Signals", color=CHART_PALETTE["text"], fontsize=12, pad=8)
    _dark_legend(ax1)

    ax2.plot(df.index, df["MACD"], label="MACD", color=CHART_PALETTE["green"], linewidth=1.4)
    ax2.plot(df.index, df["Signal"], label="Signal", color=CHART_PALETTE["red"], linewidth=1.4)
    ax2.bar(
        df.index,
        df["MACD"] - df["Signal"],
        color=[CHART_PALETTE["red"] if x < 0 else CHART_PALETTE["green"] for x in (df["MACD"] - df["Signal"])],
        alpha=0.35,
    )
    ax2.set_title("MACD with Signal Line Crossovers", color=CHART_PALETTE["text"], fontsize=12, pad=8)
    _dark_legend(ax2)

    ax3.plot(df.index, df["RSI"], label="RSI", color=CHART_PALETTE["purple"], linewidth=1.5)
    ax3.axhline(30, linestyle="--", color=CHART_PALETTE["green"], label="Oversold (30)", linewidth=1.0)
    ax3.axhline(70, linestyle="--", color=CHART_PALETTE["red"], label="Overbought (70)", linewidth=1.0)
    ax3.fill_between(df.index, 30, df["RSI"], where=(df["RSI"] < 30), color=CHART_PALETTE["green"], alpha=0.25)
    ax3.fill_between(df.index, 70, df["RSI"], where=(df["RSI"] > 70), color=CHART_PALETTE["red"], alpha=0.25)
    ax3.set_title("RSI with Overbought/Oversold Signals", color=CHART_PALETTE["text"], fontsize=12, pad=8)
    _dark_legend(ax3)

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=CHART_PALETTE["bg"], bbox_inches="tight")
    buf.seek(0)
    plt.close(fig)
    return buf


def simulate_portfolio(tickers, weights=None, start_date=None, end_date=None):
    simulator = PortfolioSimulator(tickers, start_date, end_date)
    results = simulator.calculate_returns(weights)
    return results["annual_return"] * 100, simulator


def analyze_crypto(symbol):
    cg = CoinGeckoAPI()
    coins = cg.get_coins_list()
    symbol_to_id = {coin["symbol"].lower(): coin["id"] for coin in coins}

    if symbol.lower() not in symbol_to_id:
        raise ValueError("Coin not found")

    coin_id = symbol_to_id[symbol.lower()]
    data = cg.get_coin_market_chart_by_id(id=coin_id, vs_currency="usd", days=365)

    prices = data["prices"]
    df = pd.DataFrame(prices, columns=["timestamp", "price"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    df.set_index("timestamp", inplace=True)

    df["MA50"] = df["price"].rolling(window=50).mean()
    df["MA200"] = df["price"].rolling(window=200).mean()
    df["EMA12"] = df["price"].ewm(span=12, adjust=False).mean()
    df["EMA26"] = df["price"].ewm(span=26, adjust=False).mean()
    df["MACD"] = df["EMA12"] - df["EMA26"]
    df["Signal"] = df["MACD"].ewm(span=9, adjust=False).mean()

    delta = df["price"].diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.rolling(window=14, min_periods=14).mean()
    avg_loss = loss.rolling(window=14, min_periods=14).mean()
    rs = avg_gain / avg_loss
    df["RSI"] = 100 - (100 / (1 + rs))

    df["Buy_Signal"] = False
    df["Sell_Signal"] = False
    df["Buy_Signal"] = (df["MACD"] > df["Signal"]) & (df["MACD"].shift(1) <= df["Signal"].shift(1))
    df["Sell_Signal"] = (df["MACD"] < df["Signal"]) & (df["MACD"].shift(1) >= df["Signal"].shift(1))
    df.loc[df["RSI"] < 30, "Buy_Signal"] |= True
    df.loc[df["RSI"] > 70, "Sell_Signal"] |= True
    df.loc[(df["MA50"] > df["MA200"]) & (df["MA50"].shift(1) <= df["MA200"].shift(1)), "Buy_Signal"] |= True
    df.loc[(df["MA50"] < df["MA200"]) & (df["MA50"].shift(1) >= df["MA200"].shift(1)), "Sell_Signal"] |= True

    fig, (ax1, ax2, ax3) = plt.subplots(
        3, 1, figsize=(14, 12), sharex=True, facecolor=CHART_PALETTE["bg"]
    )
    for ax in (ax1, ax2, ax3):
        _style_dark_axis(ax)

    ax1.plot(df.index, df["price"], label="Price", color=CHART_PALETTE["blue"], linewidth=1.6)
    ax1.plot(df.index, df["MA50"], label="MA50", color=CHART_PALETTE["orange"], linewidth=1.3)
    ax1.plot(df.index, df["MA200"], label="MA200", color=CHART_PALETTE["red"], linewidth=1.3)
    buy_points = df[df["Buy_Signal"]]["price"]
    sell_points = df[df["Sell_Signal"]]["price"]
    ax1.scatter(buy_points.index, buy_points, color=CHART_PALETTE["green"], marker="^", s=100, label="Buy Signal", zorder=5)
    ax1.scatter(sell_points.index, sell_points, color=CHART_PALETTE["red"], marker="v", s=100, label="Sell Signal", zorder=5)
    ax1.set_title(f"{symbol.upper()} Price with Trading Signals", color=CHART_PALETTE["text"], fontsize=12, pad=8)
    _dark_legend(ax1)

    ax2.plot(df.index, df["MACD"], label="MACD", color=CHART_PALETTE["green"], linewidth=1.4)
    ax2.plot(df.index, df["Signal"], label="Signal", color=CHART_PALETTE["red"], linewidth=1.4)
    ax2.bar(
        df.index,
        df["MACD"] - df["Signal"],
        color=[CHART_PALETTE["red"] if x < 0 else CHART_PALETTE["green"] for x in (df["MACD"] - df["Signal"])],
        alpha=0.35,
    )
    ax2.set_title("MACD with Signal Line Crossovers", color=CHART_PALETTE["text"], fontsize=12, pad=8)
    _dark_legend(ax2)

    ax3.plot(df.index, df["RSI"], label="RSI", color=CHART_PALETTE["purple"], linewidth=1.5)
    ax3.axhline(30, linestyle="--", color=CHART_PALETTE["green"], label="Oversold (30)", linewidth=1.0)
    ax3.axhline(70, linestyle="--", color=CHART_PALETTE["red"], label="Overbought (70)", linewidth=1.0)
    ax3.fill_between(df.index, 30, df["RSI"], where=(df["RSI"] < 30), color=CHART_PALETTE["green"], alpha=0.25)
    ax3.fill_between(df.index, 70, df["RSI"], where=(df["RSI"] > 70), color=CHART_PALETTE["red"], alpha=0.25)
    ax3.set_title("RSI with Overbought/Oversold Signals", color=CHART_PALETTE["text"], fontsize=12, pad=8)
    _dark_legend(ax3)

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=CHART_PALETTE["bg"], bbox_inches="tight")
    buf.seek(0)
    plt.close(fig)
    return buf
