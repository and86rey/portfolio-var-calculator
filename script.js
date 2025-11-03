// === Global Variables ===
let portfolio = [];
let pyodideReady = false;

// === DOM Elements ===
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const searchResults = document.getElementById("searchResults");
const portfolioTable = document.getElementById("portfolioTable");
const calculateVarBtn = document.getElementById("calculateVar");
const resultsTable = document.getElementById("resultsTable");
const showPricesBtn = document.getElementById("showPrices");
const priceData = document.getElementById("priceData");

// === Initialize Pyodide ===
async function loadPyodideAndPackages() {
    if (pyodideReady) return;
    const pyodide = await loadPyodide();
    await pyodide.loadPackage("micropip");
    await pyodide.runPythonAsync(`
        import micropip
        await micropip.install("yfinance")
        await micropip.install("pandas")
        await micropip.install("numpy")
        await micropip.install("scipy")
    `);
    window.pyodide = pyodide;
    pyodideReady = true;
    console.log("Pyodide + yfinance loaded in browser");
}
loadPyodideAndPackages();

// === Search Security ===
searchButton.addEventListener("click", () => {
    const query = searchInput.value.trim().toUpperCase();
    if (!query) return;
    searchResults.innerHTML = `<p>Searching for <b>${query}</b>...</p>`;
    searchYahooFinance(query);
});

async function searchYahooFinance(ticker) {
    if (!pyodideReady) {
        searchResults.innerHTML = "<p>Python engine loading... please wait.</p>";
        setTimeout(() => searchYahooFinance(ticker), 1000);
        return;
    }

    try {
        const result = await window.pyodide.runPythonAsync(`
            import yfinance as yf
            import json
            ticker = yf.Ticker("${ticker}")
            info = ticker.info
            data = {
                "symbol": info.get("symbol", ticker),
                "name": info.get("longName") or info.get("shortName") or ticker,
                "price": info.get("currentPrice") or info.get("regularMarketPrice") or "N/A"
            }
            json.dumps(data)
        `);
        const stock = JSON.parse(result);
        displaySearchResult(stock);
    } catch (err) {
        searchResults.innerHTML = `<p>Error: Invalid ticker or no data. Try AAPL, MSFT.</p>`;
        console.error(err);
    }
}

function displaySearchResult(stock) {
    searchResults.innerHTML = `
        <p><b>${stock.name}</b> (${stock.symbol}) - Price: $${stock.price}</p>
        <input type="number" id="weightInput" placeholder="Weight %" min="1" max="100" style="width:80px;padding:5px;">
        <button onclick="addToPortfolio('${stock.symbol}', '${stock.name.replace(/'/g, "\\'")}')">Add</button>
    `;
}

// === Portfolio Management ===
function addToPortfolio(symbol, name) {
    if (portfolio.length >= 5) {
        alert("Maximum 5 securities allowed.");
        return;
    }
    const weightInput = document.getElementById("weightInput");
    const weight = parseFloat(weightInput.value);
    if (isNaN(weight) || weight <= 0 || weight > 100) {
        alert("Enter valid weight (1–100%)");
        return;
    }
    portfolio.push({ symbol, name, weight });
    updatePortfolioTable();
    searchResults.innerHTML = "";
    searchInput.value = "";
}

function removeFromPortfolio(index) {
    portfolio.splice(index, 1);
    updatePortfolioTable();
}

function updatePortfolioTable() {
    portfolioTable.innerHTML = "";
    portfolio.forEach((item, i) => {
        const row = portfolioTable.insertRow();
        row.innerHTML = `
            <td>${item.name} (${item.symbol})</td>
            <td>${item.weight}%</td>
            <td><button onclick="removeFromPortfolio(${i})" style="background:#c33;color:#fff;padding:4px 8px;">Remove</button></td>
        `;
    });
}

// === Calculate VaR ===
calculateVarBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) {
        resultsTable.innerHTML = "<p>No securities in portfolio.</p>";
        return;
    }
    resultsTable.innerHTML = "<p>Calculating VaR... (this may take 10–20 seconds)</p>";
    try {
        const result = await calculateVaRWithPyodide();
        displayVaRResults(result);
    } catch (err) {
        resultsTable.innerHTML = "<p>Error calculating VaR. Check console.</p>";
        console.error(err);
    }
});

async function calculateVaRWithPyodide() {
    const symbols = portfolio.map(p => p.symbol);
    const weights = portfolio.map(p => p.weight);
    return await window.pyodide.runPythonAsync(`
        import yfinance as yf
        import pandas as pd
        import numpy as np
        from scipy.stats import norm, skew, kurtosis
        import json

        symbols = ${JSON.stringify(symbols)}
        weights = np.array(${JSON.stringify(weights)}) / 100

        # Fetch 252 days of data
        data = yf.download(symbols, period="1y", progress=False)["Adj Close"]
        data = data.dropna()
        if data.empty:
            raise ValueError("No price data")

        returns = np.log(data / data.shift(1)).dropna()
        portfolio_returns = returns.dot(weights)

        # Individual VaR
        results = {}
        for sym in symbols:
            r = returns[sym]
            mean, std = r.mean(), r.std()
            skew_val, kurt_val = skew(r), kurtosis(r, fisher=True)

            var95 = norm.ppf(0.05, mean, std)
            var99 = norm.ppf(0.01, mean, std)

            # Cornish-Fisher
            z95 = norm.ppf(0.05)
            z99 = norm.ppf(0.01)
            cf95 = z95 + (z95**2 - 1)*skew_val/6 + (z95**3 - 3*z95)*(kurt_val-3)/24 - (2*z95**3 - 5*z95)*(skew_val**2)/36
            cf99 = z99 + (z99**2 - 1)*skew_val/6 + (z99**3 - 3*z99)*(kurt_val-3)/24 - (2*z99**3 - 5*z99)*(skew_val**2)/36
            cf_var95 = mean + cf95 * std
            cf_var99 = mean + cf99 * std

            # Historical
            hist95 = np.percentile(r, 5)
            hist99 = np.percentile(r, 1)

            # Monte Carlo (simple)
            sims = np.random.normal(mean, std, 10000)
            mc95 = np.percentile(sims, 5)
            mc99 = np.percentile(sims, 1)

            # Expected return
            exp_ret = (1 + mean) ** 252 - 1

            results[sym] = {
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

        # Portfolio VaR
        p_mean, p_std = portfolio_returns.mean(), portfolio_returns.std()
        p_skew, p_kurt = skew(portfolio_returns), kurtosis(portfolio_returns, fisher=True)

        p_var95 = norm.ppf(0.05, p_mean, p_std)
        p_var99 = norm.ppf(0.01, p_mean, p_std)

        z95 = norm.ppf(0.05)
        z99 = norm.ppf(0.01)
        p_cf95 = z95 + (z95**2-1)*p_skew/6 + (z95**3-3*z95)*(p_kurt-3)/24 - (2*z95**3-5*z95)*(p_skew**2)/36
        p_cf99 = z99 + (z99**2-1)*p_skew/6 + (z99**3-3*z99)*(p_kurt-3)/24 - (2*z99**3-5*z99)*(p_skew**2)/36
        p_cf_var95 = p_mean + p_cf95 * p_std
        p_cf_var99 = p_mean + p_cf99 * p_std

        p_hist95 = np.percentile(portfolio_returns, 5)
        p_hist99 = np.percentile(portfolio_returns, 1)

        p_sims = np.random.normal(p_mean, p_std, 10000)
        p_mc95 = np.percentile(p_sims, 5)
        p_mc99 = np.percentile(p_sims, 1)

        p_exp_ret = (1 + p_mean) ** 252 - 1

        results["Portfolio"] = {
            "Normal95": round(p_var95, 6),
            "Normal99": round(p_var99, 6),
            "Hist95": round(p_hist95, 6),
            "Hist99": round(p_hist99, 6),
            "MC95": round(p_mc95, 6),
            "MC99": round(p_mc99, 6),
            "CF95": round(p_cf_var95, 6),
            "CF99": round(p_cf_var99, 6),
            "ExpReturn": round(p_exp_ret, 6)
        }

        json.dumps(results)
    `);
}

function displayVaRResults(data) {
    const result = JSON.parse(data);
    let html = `
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
    `;
    for (const [sym, vals] of Object.entries(result)) {
        html += `<tr>
            <td><b>${sym}</b></td>
            <td>${vals.Normal95}</td>
            <td>${vals.Normal99}</td>
            <td>${vals.Hist95}</td>
            <td>${vals.Hist99}</td>
            <td>${vals.MC95}</td>
            <td>${vals.MC99}</td>
            <td>${vals.CF95}</td>
            <td>${vals.CF99}</td>
            <td>${(vals.ExpReturn*100).toFixed(2)}%</td>
        </tr>`;
    }
    html += `</table>`;
    resultsTable.innerHTML = html;
}

// === Show Historical Prices ===
showPricesBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) {
        priceData.innerHTML = "<p>No securities.</p>";
        return;
    }
    priceData.innerHTML = "<p>Fetching prices...</p>";
    const symbols = portfolio.map(p => p.symbol);
    const prices = await window.pyodide.runPythonAsync(`
        import yfinance as yf
        import json
        data = yf.download(${JSON.stringify(symbols)}, period="3mo", progress=False)["Adj Close"]
        data = data.tail(30).round(2)
        data.to_json(orient="split")
    `);
    const df = JSON.parse(prices);
    let html = `<table border="1"><tr><th>Date</th>`;
    symbols.forEach(s => html += `<th>${s}</th>`);
    html += `</tr>`;
    df.data.forEach((row, i) => {
        html += `<tr><td>${df.index[i].slice(0,10)}</td>`;
        row.forEach(val => html += `<td>${val !== null ? val : 'N/A'}</td>`);
        html += `</tr>`;
    });
    html += `</table>`;
    priceData.innerHTML = html;
});
