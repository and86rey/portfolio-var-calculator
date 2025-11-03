"""
var_calculator.py
~~~~~~~~~~~~~~~~~
Portfolio Value at Risk (VaR) Calculator

Features:
- 4 VaR methods: Normal, Historical, Monte Carlo, Cornish-Fisher
- Expected annual return
- Works with yfinance (free)
- Fully typed, documented, modular
- Runs locally: `python var_calculator.py`
- Imported by Pyodide in browser

Author: [Your Name]
GitHub: https://github.com/YOUR-USERNAME/portfolio-var-calculator
"""

import numpy as np
import pandas as pd
from scipy.stats import norm, skew, kurtosis
from typing import List, Dict


def fetch_returns(symbols: List[str], period: str = "1y") -> pd.DataFrame:
    """Fetch adjusted close prices and return log returns."""
    import yfinance as yf
    data = yf.download(symbols, period=period, progress=False)["Adj Close"]
    data = data.dropna()
    if data.empty:
        raise ValueError("No data found for symbols")
    return np.log(data / data.shift(1)).dropna()


def calculate_var_single(returns: pd.Series) -> Dict[str, float]:
    """Calculate all VaR types for one security."""
    mean, std = returns.mean(), returns.std()
    s, k = skew(returns), kurtosis(returns, fisher=True)

    # Normal
    var95 = norm.ppf(0.05, mean, std)
    var99 = norm.ppf(0.01, mean, std)

    # Historical
    hist95 = np.percentile(returns, 5)
    hist99 = np.percentile(returns, 1)

    # Monte Carlo
    sims = np.random.normal(mean, std, 10000)
    mc95 = np.percentile(sims, 5)
    mc99 = np.percentile(sims, 1)

    # Cornish-Fisher
    z95, z99 = norm.ppf(0.05), norm.ppf(0.01)
    cf95 = z95 + (z95**2-1)*s/6 + (z95**3-3*z95)*(k-3)/24 - (2*z95**3-5*z95)*(s**2)/36
    cf99 = z99 + (z99**2-1)*s/6 + (z99**3-3*z99)*(k-3)/24 - (2*z99**3-5*z99)*(s**2)/36
    cf_var95 = mean + cf95 * std
    cf_var99 = mean + cf99 * std

    # Expected return
    exp_ret = (1 + mean) ** 252 - 1

    return {
        "Normal95": round(var95, 6),
        "Normal99": round(var99, 6),
        "Hist95": round(hist95, 6),
        "Hist99": round(hist99, 6),
        "MC95": round(mc95, 6),
        "MC99": round(mc99, 6),
        "CF95": round(cf_var95, 6),
        "CF99": round(cf_var99, 6),
        "ExpReturn": round(exp_ret, 6)
    }


def calculate_portfolio_var(
    returns: pd.DataFrame,
    weights: np.ndarray
) -> Dict[str, float]:
    """Calculate VaR for weighted portfolio."""
    portfolio_returns = returns.dot(weights)
    return calculate_var_single(portfolio_returns)


def calculate_full_portfolio(
    symbols: List[str],
    weights: List[float]
) -> Dict:
    """Main function: individual + portfolio VaR."""
    weights = np.array(weights) / 100
    if not np.isclose(weights.sum(), 1.0):
        raise ValueError("Weights must sum to 100%")

    returns = fetch_returns(symbols)

    results = {}
    for sym in symbols:
        results[sym] = calculate_var_single(returns[sym])

    results["Portfolio"] = calculate_portfolio_var(returns, weights)
    return results


# === LOCAL DEMO ===
if __name__ == "__main__":
    print("Running local demo...")
    try:
        result = calculate_full_portfolio(
            symbols=["AAPL", "MSFT"],
            weights=[60, 40]
        )
        print("\nVaR Results:")
        for name, vals in result.items():
            print(f"\n{name}:")
            print(f"  Normal 95%: {vals['Normal95']:.4f}")
            print(f"  Expected Return: {vals['ExpReturn']:.2%}")
    except Exception as e:
        print(f"Demo failed: {e}")
