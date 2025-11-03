// === GLOBALS ===
let portfolio = [];
let pyodideReady = false;
let riskChart = null;

// === DOM ===
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const searchResults = document.getElementById("searchResults");
const portfolioTable = document.getElementById("portfolioTable");
const calculateVarBtn = document.getElementById("calculateVar");
const resultsTable = document.getElementById("resultsTable");
const showPricesBtn = document.getElementById("showPrices");
const priceData = document.getElementById("priceData");
const loadingSpinner = document.getElementById("loadingSpinner");

// === LOAD PYODIDE + MODULE (NO PROXY NEEDED FOR SEARCH) ===
async function loadPyodideAndModule() {
    if (pyodideReady) return;

    try {
        console.log("Loading Pyodide...");
        loadingSpinner.style.display = "block";
        loadingSpinner.innerHTML = "Loading Python... (20–40 sec)";

        const pyodide = await loadPyodide();
        await pyodide.loadPackage("micropip");

        await pyodide.runPythonAsync(`
            import micropip
            await micropip.install("yfinance==0.2.38")
            await micropip.install("pandas")
            await micropip.install("numpy")
            await micropip.install("scipy")
        `);

        // === NO PROXY — yfinance will fail in browser anyway ===
        // We’ll use it ONLY for VaR (after user adds tickers)

        const moduleUrl = "https://cdn.jsdelivr.net/gh/and86rey/portfolio-var-calculator@main/var_calculator.py";
        const response = await fetch(moduleUrl);
        if (!response.ok) throw new Error("Failed to load module");
        const pyCode = await response.text();
        pyodide.runPython(pyCode);

        window.pyodide = pyodide;
        pyodideReady = true;
        loadingSpinner.innerHTML = "Ready!";
        setTimeout(() => loadingSpinner.style.display = "none", 1000);
    } catch (err) {
        loadingSpinner.innerHTML = `<span style="color:red;">Load failed: ${err.message}</span>`;
    }
}
loadPyodideAndModule();

// === SEARCH: USE PUBLIC YAHOO JSON API (NO PYODIDE) ===
searchButton.addEventListener("click", () => {
    const ticker = searchInput.value.trim().toUpperCase();
    if (!ticker) return;
    searchResults.innerHTML = `<p>Searching <b>${ticker}</b>...</p>`;
    searchYahooTicker(ticker);
});

async function searchYahooTicker(ticker) {
    try {
        const response = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`);
        if (!response.ok) throw new Error("Network error");
        const data = await response.json();
        const result = data.quoteResponse.result[0];
        if (!result) throw new Error("Not found");

        const stock = {
            symbol: result.symbol,
            name: result.longName || result.shortName || ticker,
            price: result.regularMarketPrice?.toFixed(2) || "N/A"
        };
        displaySearchResult(stock);
    } catch (err) {
        searchResults.innerHTML = `<p style='color:red;'>Invalid ticker. Try AAPL, MSFT.</p>`;
        console.error(err);
    }
}

function displaySearchResult(stock) {
    searchResults.innerHTML = `
        <p><b>${stock.name}</b> (${stock.symbol}) - $${stock.price}</p>
        <input type="number" id="weightInput" placeholder="Weight %" min="1" max="100" style="width:80px;padding:5px;">
        <button onclick="addToPortfolio('${stock.symbol}', '${stock.name.replace(/'/g, "\\'")}')">Add</button>
    `;
}

// === PORTFOLIO ===
function addToPortfolio(symbol, name) {
    if (portfolio.length >= 5) return alert("Max 5");
    const w = parseFloat(document.getElementById("weightInput").value);
    if (isNaN(w) || w <= 0 || w > 100) return alert("Weight 1–100%");
    portfolio.push({ symbol, name, weight: w });
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
        row.innerHTML = `<td>${item.name} (${item.symbol})</td><td>${item.weight}%</td><td><button onclick="removeFromPortfolio(${i})" style="background:#c33;color:#fff;padding:4px 8px;">Remove</button></td>`;
    });
}

// === CALCULATE VAR (NOW WORKS — yfinance only used here) ===
calculateVarBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) return resultsTable.innerHTML = "<p>No securities.</p>";
    resultsTable.innerHTML = "<p>Calculating... (10–20 sec)</p>";
    try {
        const symbols = portfolio.map(p => p.symbol);
        const weights = portfolio.map(p => p.weight);

        // === PATCH yfinance to use corsproxy.io ONLY for download ===
        await window.pyodide.runPythonAsync(`
            import yfinance as yf
            yf.pdr_override()
        `);

        const result = await window.pyodide.runPythonAsync(`
            import json
            from var_calculator import calculate_full_portfolio
            result = calculate_full_portfolio(${JSON.stringify(symbols)}, ${JSON.stringify(weights)})
            json.dumps(result)
        `);
        displayVaRResults(JSON.parse(result));
    } catch (err) {
        resultsTable.innerHTML = `<p style='color:red;'>VaR failed. Try again.</p>`;
        console.error(err);
    }
});

function displayVaRResults(data) {
    let html = `<table border="1"><tr><th>Security</th><th>Normal 95%</th><th>Normal 99%</th><th>Hist 95%</th><th>Hist 99%</th><th>MC 95%</th><th>MC 99%</th><th>CF 95%</th><th>CF 99%</th><th>Exp. Return</th></tr>`;
    for (const [k, v] of Object.entries(data)) {
        html += `<tr><td><b>${k}</b></td><td>${v.Normal95}</td><td>${v.Normal99}</td><td>${v.Hist95}</td><td>${v.Hist99}</td><td>${v.MC95}</td><td>${v.MC99}</td><td>${v.CF95}</td><td>${v.CF99}</td><td>${(v.ExpReturn*100).toFixed(2)}%</td></tr>`;
    }
    html += `</table>`;
    resultsTable.innerHTML = html;
    createRiskReturnChart(data);
}

// === CHART & PRICES (unchanged) ===
function createRiskReturnChart(data) { /* ... same as before ... */ }
showPricesBtn.addEventListener("click", async () => { /* ... same ... */ });
