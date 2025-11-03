// === Global Variables ===
let portfolio = [];
let pyodideReady = false;
let riskChart = null;

// === DOM Elements ===
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const searchResults = document.getElementById("searchResults");
const portfolioTable = document.getElementById("portfolioTable");
const calculateVarBtn = document.getElementById("calculateVar");
const resultsTable = document.getElementById("resultsTable");
const showPricesBtn = document.getElementById("showPrices");
const priceData = document.getElementById("priceData");
const loadingSpinner = document.getElementById("loadingSpinner");

// === Embedded Python Module (NO FETCH!) ===
const VAR_CALCULATOR_PY = `
import numpy as np
import pandas as pd
from scipy.stats import norm, skew, kurtosis
from typing import List, Dict

def fetch_returns(symbols: List[str], period: str = "1y") -> pd.DataFrame:
    import yfinance as yf
    data = yf.download(symbols, period=period, progress=False)["Adj Close"]
    data = data.dropna()
    if data.empty:
        raise ValueError("No data found for symbols")
    return np.log(data / data.shift(1)).dropna()

def calculate_var_single(returns: pd.Series) -> Dict[str, float]:
    mean, std = returns.mean(), returns.std()
    s, k = skew(returns), kurtosis(returns, fisher=True)

    var95 = norm.ppf(0.05, mean, std)
    var99 = norm.ppf(0.01, mean, std)

    hist95 = np.percentile(returns, 5)
    hist99 = np.percentile(returns, 1)

    sims = np.random.normal(mean, std, 10000)
    mc95 = np.percentile(sims, 5)
    mc99 = np.percentile(sims, 1)

    z95, z99 = norm.ppf(0.05), norm.ppf(0.01)
    cf95 = z95 + (z95**2-1)*s/6 + (z95**3-3*z95)*(k-3)/24 - (2*z95**3-5*z95)*(s**2)/36
    cf99 = z99 + (z99**2-1)*s/6 + (z99**3-3*z99)*(k-3)/24 - (2*z99**3-5*z99)*(s**2)/36
    cf_var95 = mean + cf95 * std
    cf_var99 = mean + cf99 * std

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

def calculate_portfolio_var(returns: pd.DataFrame, weights: np.ndarray) -> Dict[str, float]:
    portfolio_returns = returns.dot(weights)
    return calculate_var_single(portfolio_returns)

def calculate_full_portfolio(symbols: List[str], weights: List[float]) -> Dict:
    weights = np.array(weights) / 100
    if not np.isclose(weights.sum(), 1.0):
        raise ValueError("Weights must sum to 100%")
    returns = fetch_returns(symbols)
    results = {}
    for sym in symbols:
        results[sym] = calculate_var_single(returns[sym])
    results["Portfolio"] = calculate_portfolio_var(returns, weights)
    return results
`;

// === Initialize Pyodide + Load Embedded Module ===
async function loadPyodideAndModule() {
    if (pyodideReady) return;

    try {
        console.log("Loading Pyodide...");
        loadingSpinner.style.display = "block";
        loadingSpinner.innerHTML = "Loading Python... (20–40 sec)";

        const pyodide = await loadPyodide();
        await pyodide.loadPackage("micropip");

        console.log("Installing yfinance 0.2.38 + deps...");
        await pyodide.runPythonAsync(`
            import micropip
            await micropip.install("yfinance==0.2.38")
            await micropip.install("pandas")
            await micropip.install("numpy")
            await micropip.install("scipy")
        `);

        console.log("Loading embedded var_calculator.py...");
        pyodide.runPython(VAR_CALCULATOR_PY);
        console.log("Python module loaded");

        window.pyodide = pyodide;
        pyodideReady = true;
        loadingSpinner.innerHTML = "Ready!";
        setTimeout(() => loadingSpinner.style.display = "none", 1000);
    } catch (error) {
        console.error("Setup failed:", error);
        loadingSpinner.innerHTML = \`<span style="color:red;">Error: \${error.message}</span>\`;
    }
}
loadPyodideAndModule();

// === Search Security ===
searchButton.addEventListener("click", () => {
    const query = searchInput.value.trim().toUpperCase();
    if (!query) return;
    searchResults.innerHTML = \`<p>Searching <b>\${query}</b>...</p>\`;
    searchYahooFinance(query);
});

async function searchYahooFinance(ticker) {
    let attempts = 0;
    const maxAttempts = 40;
    while (!pyodideReady && attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
    }
    if (!pyodideReady) {
        searchResults.innerHTML = "<p style='color:red;'>Timeout. Refresh.</p>";
        return;
    }

    try {
        const result = await window.pyodide.runPythonAsync(\`
            import yfinance as yf
            import json
            t = yf.Ticker("\${ticker}")
            info = t.fast_info
            data = {
                "symbol": info.get("symbol", "\${ticker}"),
                "name": info.get("longName") or info.get("shortName") or "\${ticker}",
                "price": round(info.get("lastPrice") or info.get("regularMarketPrice"), 2) or "N/A"
            }
            json.dumps(data)
        \`);
        const stock = JSON.parse(result);
        displaySearchResult(stock);
    } catch (err) {
        searchResults.innerHTML = \`<p style='color:red;'>Invalid ticker. Try AAPL, MSFT.</p>\`;
        console.error(err);
    }
}

function displaySearchResult(stock) {
    searchResults.innerHTML = \`
        <p><b>\${stock.name}</b> (\${stock.symbol}) - $\${stock.price}</p>
        <input type="number" id="weightInput" placeholder="Weight %" min="1" max="100" style="width:80px;padding:5px;">
        <button onclick="addToPortfolio('\${stock.symbol}', '\${stock.name.replace(/'/g, "\\'")}')">Add</button>
    \`;
}

// === Portfolio Management ===
function addToPortfolio(symbol, name) {
    if (portfolio.length >= 5) {
        alert("Maximum 5 securities.");
        return;
    }
    const weight = parseFloat(document.getElementById("weightInput").value);
    if (isNaN(weight) || weight <= 0 || weight > 100) {
        alert("Enter weight 1–100%");
        return;
    }
    portfolio.push({ symbol, name, weight });
    updatePortfolioTable();
    searchResults.innerHTML = "";
    searchInput.value = "";
}

function removeFromPortfolio(i) {
    portfolio.splice(i, 1);
    updatePortfolioTable();
}

function updatePortfolioTable() {
    portfolioTable.innerHTML = "";
    portfolio.forEach((item, i) => {
        const row = portfolioTable.insertRow();
        row.innerHTML = \`
            <td>\${item.name} (\${item.symbol})</td>
            <td>\${item.weight}%</td>
            <td><button onclick="removeFromPortfolio(\${i})" style="background:#c33;color:#fff;padding:4px 8px;">Remove</button></td>
        \`;
    });
}

// === Calculate VaR ===
calculateVarBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) {
        resultsTable.innerHTML = "<p>No securities.</p>";
        return;
    }
    resultsTable.innerHTML = "<p>Calculating VaR... (10–20 sec)</p>";
    try {
        const symbols = portfolio.map(p => p.symbol);
        const weights = portfolio.map(p => p.weight);
        const resultJson = await window.pyodide.runPythonAsync(\`
            import json
            from var_calculator import calculate_full_portfolio
            result = calculate_full_portfolio(\${JSON.stringify(symbols)}, \${JSON.stringify(weights)})
            json.dumps(result)
        \`);
        const result = JSON.parse(resultJson);
        displayVaRResults(result);
    } catch (err) {
        resultsTable.innerHTML = "<p style='color:red;'>Error. Check console.</p>";
        console.error(err);
    }
});

function displayVaRResults(data) {
    let html = \`
        <table border="1">
            <tr>
                <th>Security</th>
                <th>Normal 95%</th>
                <th>Normal 99%</th>
                <th>Hist 95%</th>
                <th>Hist 99%</th>
                <th>MC 95%</th>
                <th>MC 99%</th>
                <th>CF 95%</th>
                <th>CF 99%</th>
                <th>Exp. Return</th>
            </tr>
    \`;
    for (const [sym, vals] of Object.entries(data)) {
        html += \`<tr>
            <td><b>\${sym}</b></td>
            <td>\${vals.Normal95}</td>
            <td>\${vals.Normal99}</td>
            <td>\${vals.Hist95}</td>
            <td>\${vals.Hist99}</td>
            <td>\${vals.MC95}</td>
            <td>\${vals.MC99}</td>
            <td>\${vals.CF95}</td>
            <td>\${vals.CF99}</td>
            <td>\${(vals.ExpReturn*100).toFixed(2)}%</td>
        </tr>\`;
    }
    html += \`</table>\`;
    resultsTable.innerHTML = html;
    createRiskReturnChart(data);
}

// === Risk-Return Chart ===
function createRiskReturnChart(data) {
    const ctx = document.getElementById('riskReturnChart').getContext('2d');
    const labels = [], risks = [], returns = [], colors = [], sizes = [];

    for (const [sym, vals] of Object.entries(data)) {
        if (sym === "Portfolio") {
            labels.push("PORTFOLIO");
            risks.push(-vals.Normal95 * 100);
            returns.push(vals.ExpReturn * 100);
            colors.push('rgba(255, 0, 0, 0.8)');
            sizes.push(120);
        } else {
            labels.push(sym);
            risks.push(-vals.Normal95 * 100);
            returns.push(vals.ExpReturn * 100);
            colors.push('rgba(245, 166, 35, 0.7)');
            sizes.push(80);
        }
    }

    if (riskChart) riskChart.destroy();
    riskChart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: [{
            data: labels.map((l, i) => ({ x: risks[i], y: returns[i], label: l })),
            backgroundColor: colors,
            borderColor: colors.map(c => c.replace('0.7', '1').replace('0.8', '1')),
            borderWidth: 2,
            pointRadius: sizes.map(s => s / 10)
        }]},
        options: {
            responsive: true,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => \`\${ctx.raw.label}: Risk \${ctx.raw.x.toFixed(3)}%, Return \${ctx.raw.y.toFixed(2)}%\`
                    }
                },
                legend: { display: false }
            },
            scales: {
                x: { title: { display: true, text: '1-Day VaR 95% (Loss %)', color: '#fff' }, ticks: { color: '#fff' }, grid: { color: '#333' } },
                y: { title: { display: true, text: 'Expected Annual Return (%)', color: '#fff' }, ticks: { color: '#fff' }, grid: { color: '#333' } }
            }
        }
    });
}

// === Show Historical Prices ===
showPricesBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) {
        priceData.innerHTML = "<p>No securities.</p>";
        return;
    }
    priceData.innerHTML = "<p>Fetching prices...</p>";
    const symbols = portfolio.map(p => p.symbol);
    try {
        const prices = await window.pyodide.runPythonAsync(\`
            import yfinance as yf
            import json
            data = yf.download(\${JSON.stringify(symbols)}, period="3mo", progress=False)["Adj Close"]
            data = data.tail(30).round(2)
            json.dumps({"index": data.index.strftime('%Y-%m-%d').tolist(), "data": data.values.tolist()})
        \`);
        const df = JSON.parse(prices);
        let html = \`<table border="1"><tr><th>Date</th>\`;
        symbols.forEach(s => html += \`<th>\${s}</th>\`);
        html += \`</tr>\`;
        df.data.forEach((row, i) => {
            html += \`<tr><td>\${df.index[i]}</td>\`;
            row.forEach(v => html += \`<td>\${v !== null ? v : 'N/A'}</td>\`);
            html += \`</tr>\`;
        });
        html += \`</table>\`;
        priceData.innerHTML = html;
    } catch (err) {
        priceData.innerHTML = "<p style='color:red;'>Failed to load prices.</p>";
    }
});
