# main.py  (copy-paste the whole file)
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import numpy as np
from scipy.stats import norm, skew, kurtosis
from pydantic import BaseModel
from typing import List

app = FastAPI()

# ---------- CORS ----------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # <-- every origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- request model ----------
class PortfolioReq(BaseModel):
    symbols: List[str]
    weights: List[float]

# ---------- VaR helper ----------
def var_one(returns: np.ndarray):
    if len(returns) < 2:
        return {"Normal95":0,"Hist95":0,"MC95":0,"CF95":0,"ExpReturn":0}
    mu, sigma = returns.mean(), returns.std()
    s = skew(returns) if len(returns)>3 else 0
    k = kurtosis(returns, fisher=True) if len(returns)>4 else 3

    z = norm.ppf(0.05)
    normal = mu + z*sigma
    hist   = np.percentile(returns,5)
    mc     = np.percentile(np.random.normal(mu,sigma,10000),5)
    cf_z   = z + (z**2-1)*s/6 + (z**3-3*z)*(k-3)/24 - (2*z**3-5*z)*(s**2)/36
    cf     = mu + cf_z*sigma
    exp    = (1+mu)**252 - 1

    return {
        "Normal95": round(normal,6),
        "Hist95":   round(hist,6),
        "MC95":     round(mc,6),
        "CF95":     round(cf,6),
        "ExpReturn":round(exp,6)
    }

# ---------- routes ----------
@app.get("/")
def root():
    return {"msg":"Portfolio VaR backend – LIVE"}

@app.get("/ticker/{ticker}")
def ticker(ticker: str):
    try:
        # 2-day history always gives the last close
        h = yf.download(ticker.upper(), period="2d", progress=False, threads=False)
        if h.empty or "Close" not in h.columns:
            raise ValueError
        price = float(h["Close"].iloc[-1])
        name  = yf.Ticker(ticker.upper()).info.get("longName", ticker.upper())
        return {"symbol":ticker.upper(), "name":name, "price":round(price,2)}
    except Exception:
        raise HTTPException(status_code=404, detail="Invalid ticker")

@app.post("/var")
def var(req: PortfolioReq):
    try:
        w = np.array(req.weights)/100
        if not np.isclose(w.sum(),1.0):
            raise ValueError("weights")
        data = yf.download(req.symbols, period="1y", progress=False, threads=False)["Adj Close"].dropna()
        ret  = np.log(data/data.shift(1)).dropna()
        out  = {}
        for s in req.symbols:
            out[s] = var_one(ret[s].values) if s in ret.columns else {"error":"no data"}
        out["Portfolio"] = var_one(ret.dot(w).values)
        return out
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
