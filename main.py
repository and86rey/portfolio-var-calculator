from fastapi import FastAPI, HTTPException
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

# FIXED: Explicit OPTIONS route for pre-flight
@app.options("/{path:path}")
async def options_handler(path: str):
    return {}

class PortfolioRequest(BaseModel):
    symbols: List[str]
    weights: List[float]

def calculate_var_single(returns):
    if len(returns) < 2:
        return {"Normal95": 0, "Hist95": 0, "MC95": 0, "CF95": 0, "ExpReturn": 0}
    mean, std = returns.mean(), returns.std()
    s = skew(returns) if len(returns) > 3 else 0
    k = kurtosis(returns, fisher=True) if len(returns) > 4 else 3
    z95 = norm.ppf(0.05)
    var95 = mean + z95 * std
    hist95 = np.percentile(returns, 5)
    sims = np.random.normal(mean, std, 10000)
    mc95 = np.percentile(sims, 5)
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
        hist = yf.download(ticker.upper(), period="5d", progress=False)
        if hist.empty:
            raise ValueError("No data")
        price = hist["Close"].iloc[-1]
        ticker_obj = yf.Ticker(ticker.upper())
        info = ticker_obj.info
        name = info.get("longName") or info.get("shortName") or ticker.upper()
        return {
            "symbol": ticker.upper(),
            "name": name,
            "price": round(float(price), 2)
        }
    except Exception as e:
        print(f"Ticker error: {e}")
        raise HTTPException(status_code=400, detail="Invalid ticker")

@app.post("/var")
def calculate_var(req: PortfolioRequest):
    try:
        weights = np.array(req.weights) / 100
        if not np.isclose(weights.sum(), 1.0):
            raise ValueError("Weights must sum to 100%")
        data = yf.download(req.symbols, period="1y", progress=False)["Adj Close"]
        if data.empty:
            raise ValueError("No price data")
        data = data.dropna()
        returns = np.log(data / data.shift(1)).dropna()
        if returns.empty:
            raise ValueError("No returns data")
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
        raise HTTPException(status_code=400, detail=f"Calculation failed: {str(e)}")
