# main.py — FINAL PRODUCTION VERSION
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import numpy as np
from scipy.stats import norm, skew, kurtosis
from pydantic import BaseModel
from typing import List

app = FastAPI(title="Portfolio VaR API", version="1.0")

# === CORS FOR FRONTEND ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# === REQUEST MODEL ===
class PortfolioRequest(BaseModel):
    symbols: List[str]
    weights: List[float]

# === CORE VaR FUNCTION (MOVED TO TOP) ===
def calculate_var_single(returns: np.ndarray):
    mean, std = returns.mean(), returns.std()
    s, k = skew(returns), kurtosis(returns, fisher=True)

    # Normal VaR
    var95 = norm.ppf(0.05, mean, std)

    # Historical VaR
    hist95 = np.percentile(returns, 5)

    # Monte Carlo VaR
    sims = np.random.normal(mean, std, 10000)
    mc95 = np.percentile(sims, 5)

    # Cornish-Fisher VaR
    z95 = norm.ppf(0.05)
    cf95 = z95 + (z95**2 - 1) * s / 6 + (z95**3 - 3 * z95) * (k - 3) / 24 - (2 * z95**3 - 5 * z95) * (s**2) / 36
    cf_var95 = mean + cf95 * std

    # Expected Annual Return
    exp_ret = (1 + mean) ** 252 - 1

    return {
        "Normal95": round(var95, 6),
        "Hist95": round(hist95, 6),
        "MC95": round(mc95, 6),
        "CF95": round(cf_var95, 6),
        "ExpReturn": round(exp_ret, 6)
    }

# === ROUTES ===
@app.get("/")
def home():
    return {"message": "Portfolio VaR Backend Live! 🚀"}

@app.get("/ticker/{ticker}")
def get_ticker(ticker: str):
    try:
        t = yf.Ticker(ticker.upper())
        info = t.info

        # ROBUST PRICE FALLBACK (works 24/7)
        price = (
            info.get("regularMarketPrice") or
            info.get("currentPrice") or
            info.get("previousClose") or
            info.get("regularMarketPreviousClose") or
            info.get("regularMarketOpen") or
            0
        )

        return {
            "symbol": info.get("symbol", ticker.upper()),
            "name": info.get("longName") or info.get("shortName") or ticker.upper(),
            "price": round(float(price), 2) if price and price > 0 else 0.0
        }
    except Exception as e:
        print(f"Ticker error for {ticker}: {e}")
        return {"error": "Invalid ticker"}

@app.post("/var")
def calculate_var(req: PortfolioRequest):
    try:
        # Validate weights
        weights = np.array(req.weights, dtype=float) / 100
        if not np.isclose(weights.sum(), 1.0):
            return {"error": "Weights must sum to 100%"}

        # Fetch price data
        data = yf.download(req.symbols, period="1y", progress=False, auto_adjust=True)
        if data.empty or "Adj Close" not in data.columns:
            return {"error": "No price data from Yahoo"}

        prices = data["Adj Close"].dropna(how="all")
        if prices.empty:
            return {"error": "No valid price data"}

        # Compute log returns
        returns = np.log(prices / prices.shift(1)).dropna()
        if returns.empty:
            return {"error": "Not enough data for returns"}

        results = {}

        # Individual securities
        for sym in req.symbols:
            if sym not in returns.columns:
                results[sym] = {"error": "No data"}
                continue
            results[sym] = calculate_var_single(returns[sym].values)

        # Portfolio
        portfolio_returns = returns.dot(weights)
        results["Portfolio"] = calculate_var_single(portfolio_returns.values)

        return results

    except Exception as e:
        print(f"VaR calculation error: {e}")
        return {"error": f"Calculation failed: {str(e)}"}
