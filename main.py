# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import numpy as np
from scipy.stats import norm, skew, kurtosis
from pydantic import BaseModel
from typing import List

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class PortfolioRequest(BaseModel):
    symbols: List[str]
    weights: List[float]

def fetch_returns(symbols, period="1y"):
    data = yf.download(symbols, period=period, progress=False)["Adj Close"]
    data = data.dropna()
    return np.log(data / data.shift(1)).dropna()

def calculate_var_single(returns):
    mean, std = returns.mean(), returns.std()
    s, k = skew(returns), kurtosis(returns, fisher=True)

    var95 = norm.ppf(0.05, mean, std)
    hist95 = np.percentile(returns, 5)
    sims = np.random.normal(mean, std, 10000)
    mc95 = np.percentile(sims, 5)
    z95 = norm.ppf(0.05)
    cf95 = z95 + (z95**2-1)*s/6 + (z95**3-3*z95)*(k-3)/24 - (2*z95**3-5*z95)*(s**2)/36
    cf_var95 = mean + cf95 * std
    exp_ret = (1 + mean) ** 252 - 1

    return {
        "Normal95": round(var95, 6),
        "Hist95": round(hist95, 6),
        "MC95": round(mc95, 6),
        "CF95": round(cf_var95, 6),
        "ExpReturn": round(exp_ret, 6)
    }

@app.get("/ticker/{ticker}")
def get_ticker(ticker: str):
    try:
        t = yf.Ticker(ticker)
        info = t.info
        return {
            "symbol": info.get("symbol", ticker),
            "name": info.get("longName") or info.get("shortName") or ticker,
            "price": round(info.get("regularMarketPrice") or info.get("currentPrice") or 0, 2)
        }
    except:
        return {"error": "Invalid ticker"}

@app.post("/var")
def calculate_var(req: PortfolioRequest):
    weights = np.array(req.weights) / 100
    if not np.isclose(weights.sum(), 1.0):
        return {"error": "Weights must sum to 100%"}

    returns = fetch_returns(req.symbols)
    results = {}
    for sym in req.symbols:
        results[sym] = calculate_var_single(returns[sym])
    portfolio_returns = returns.dot(weights)
    results["Portfolio"] = calculate_var_single(portfolio_returns)
    return results
