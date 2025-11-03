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

// === LOAD PYODIDE + MODULE ===
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

        // === NUCLEAR CORS FIX: Use allorigins.win ===
        await pyodide.runPythonAsync(`
            import requests
            import json
            from urllib.parse import quote

            original_get = requests.get

            def proxy_get(url, **kwargs):
                encoded_url = quote(url, safe='')
                proxy_url = f"https://api.allorigins.win/get?url={encoded_url}"
                response = original_get(proxy_url, **kwargs)
                if response.status_code == 200:
                    data = json.loads(response.text)
                    return type('Response', (), {
                        'text': data['contents'],
                        'content': data['contents'].encode(),
                        'status_code': 200,
                        'url': url
                    })
                else:
                    return response

            requests.get = proxy_get
        `);

        // === LOAD var_calculator.py ===
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
        console.error(err);
    }
}
loadPyodideAndModule();

// === SEARCH (FIXED FOR AAPL) ===
searchButton.addEventListener("click", () => {
    const q = searchInput.value.trim().toUpperCase();
    if (!q) return;
    searchResults.innerHTML = `<p>Searching <b>${q}</b>...</p>`;
    searchYahooFinance(q);
});

async function searchYahooFinance(ticker) {
    while (!pyodideReady) await new Promise(r => setTimeout(r, 1000));
    try {
        const result = await window.pyodide.runPythonAsync(`
            import yfinance as yf
            import json
            t = yf.Ticker("${ticker}")
            info = t.info
            price = info.get("regularMarketPrice") or info.get("currentPrice") or info.get("previousClose") or 0
            data = {
                "symbol": info.get("symbol", "${ticker}"),
                "name": info.get("longName") or info.get("shortName") or "${ticker}",
                "price": round(price, 2) if price else "N/A"
            }
            json.dumps(data)
        `);
        const stock = JSON.parse(result);
        displaySearchResult(stock);
    } catch (err) {
        searchResults.innerHTML = `<p style='color:red;'>Invalid ticker. Try AAPL.</p>`;
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

// === CALCULATE VAR ===
calculateVarBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) return resultsTable.innerHTML = "<p>No securities.</p>";
    resultsTable.innerHTML = "<p>Calculating... (10–20 sec)</p>";
    try {
        const symbols = portfolio.map(p => p.symbol);
        const weights = portfolio.map(p => p.weight);
        const result = await window.pyodide.runPythonAsync(`
            import json
            from var_calculator import calculate_full_portfolio
            result = calculate_full_portfolio(${JSON.stringify(symbols)}, ${JSON.stringify(weights)})
            json.dumps(result)
        `);
        displayVaRResults(JSON.parse(result));
    } catch (err) {
        resultsTable.innerHTML = `<p style='color:red;'>Error. Check console.</p>`;
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

// === CHART ===
function createRiskReturnChart(data) {
    const ctx = document.getElementById("riskReturnChart").getContext("2d");
    const labels = [], risks = [], returns = [], colors = [], sizes = [];
    for (const [k, v] of Object.entries(data)) {
        if (k === "Portfolio") {
            labels.push("PORTFOLIO"); risks.push(-v.Normal95*100); returns.push(v.ExpReturn*100); colors.push("rgba(255,0,0,0.9)"); sizes.push(14);
        } else {
            labels.push(k); risks.push(-v.Normal95*100); returns.push(v.ExpReturn*100); colors.push("rgba(245,166,35,0.7)"); sizes.push(9);
        }
    }
    if (riskChart) riskChart.destroy();
    riskChart = new Chart(ctx, {
        type: "scatter",
        data: { datasets: [{ data: labels.map((l,i)=>({x:risks[i],y:returns[i],label:l})), backgroundColor: colors, borderWidth: 2, pointRadius: sizes }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: "1-Day VaR 95% (Loss %)" } }, y: { title: { display: true, text: "Expected Annual Return (%)" } } } }
    });
}

// === PRICES ===
showPricesBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) return priceData.innerHTML = "<p>No securities.</p>";
    priceData.innerHTML = "<p>Fetching...</p>";
    const symbols = portfolio.map(p => p.symbol);
    try {
        const result = await window.pyodide.runPythonAsync(`
            import yfinance as yf
            import json
            data = yf.download(${JSON.stringify(symbols)}, period="3mo", progress=False)["Adj Close"].tail(30).round(2)
            json.dumps({"index": data.index.strftime("%Y-%m-%d").tolist(), "data": data.values.tolist(), "columns": data.columns.tolist()})
        `);
        const { index, data, columns } = JSON.parse(result);
        let html = `<table border="1"><tr><th>Date</th>${columns.map(c => "<th>" + c + "</th>").join("")}</tr>`;
        data.forEach((row, i) => {
            html += `<tr><td>${index[i]}</td>${row.map(v => "<td>" + (v ?? "N/A") + "</td>").join("")}</tr>`;
        });
        html += `</table>`;
        priceData.innerHTML = html;
    } catch (err) {
        priceData.innerHTML = `<p style='color:red;'>Failed.</p>`;
        console.error(err);
    }
});
