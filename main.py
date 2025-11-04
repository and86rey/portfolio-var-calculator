from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import numpy as np
from scipy.stats import norm, skew, kurtosis
from pydantic import BaseModel
from typing import List

app = FastAPI(title="Portfolio VaR API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PortfolioRequest(BaseModel):
    symbols: List[str]
    weights: List[float]

def calculate_var_single(returns):
    if len(returns) < 2:
        return {"Normal95": 0, "Hist95": 0, "MC95": 0, "CF95": 0, "ExpReturn": 0}
    mean, std = returns.mean(), returns.std()
    s = skew(returns) if len(returns) > 3 else 0
    k = kurtosis(returns, fisher=True) if len(returns) > 4 else 3

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

@app.get("/")
def home():
    return {"message": "Portfolio VaR Backend Live!"}

@app.get("/ticker/{ticker}")
def get_ticker(ticker: str):
    try:
        # Use history for reliable price (works 24/7)
        hist = yf.download(ticker.upper(), period="1d", progress=False)
        if hist.empty:
            return {"error": "No data"}
        price = hist["Close"].iloc[-1]
        name = yf.Ticker(ticker.upper()).info.get("longName") or ticker.upper()
        return {
            "symbol": ticker.upper(),
            "name": name,
            "price": round(float(price), 2)
        }
    except Exception as e:
        print(f"Ticker error: {e}")
        return {"error": "Invalid ticker"}

@app.post("/var")
def calculate_var(req: PortfolioRequest):
    try:
        weights = np.array(req.weights) / 100
        if not np.isclose(weights.sum(), 1.0):
            return {"error": "Weights must sum to 100%"}

        data = yf.download(req.symbols, period="1y", progress=False)["Adj Close"]
        if data.empty:
            return {"error": "No price data"}
        data = data.dropna()
        returns = np.log(data / data.shift(1)).dropna()
        if returns.empty:
            return {"error": "No returns data"}

        results = {}
        for sym in req.symbols:
            if sym in returns.columns:
                results[sym] = calculate_var_single(returns[sym].values)
            else:
                results[sym] = {"error": "No data"}

        portfolio_returns = returns.dot(weights)
        results["Portfolio"] = calculate_var_single(portfolio_returns.values)

        return results
    except Exception as e:
        print(f"VaR error: {e}")
        return {"error": f"Calculation failed: {str(e)}"}
