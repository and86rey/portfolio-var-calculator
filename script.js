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

// === LOAD PYODIDE + var_calculator.py FROM jsDelivr ===
async function loadPyodideAndModule() {
    if (pyodideReady) return;

    try {
        console.log("Loading Pyodide...");
        loadingSpinner.style.display = "block";
        loadingSpinner.innerHTML = "Loading Python... (20-40 sec)";

        const pyodide = await loadPyodide();
        await pyodide.loadPackage("micropip");

        console.log("Installing yfinance 0.2.38...");
        await pyodide.runPythonAsync(
            "import micropip\n" +
            "await micropip.install('yfinance==0.2.38')\n" +
            "await micropip.install('pandas')\n" +
            "await micropip.install('numpy')\n" +
            "await micropip.install('scipy')\n"
        );

        // === LOAD FROM YOUR REPO VIA jsDelivr ===
        const moduleUrl = "https://cdn.jsdelivr.net/gh/and86rey/portfolio-var-calculator@main/var_calculator.py";
        console.log("Fetching var_calculator.py...");
        const response = await fetch(moduleUrl);
        if (!response.ok) throw new Error("HTTP " + response.status);
        const pyCode = await response.text();
        pyodide.runPython(pyCode);
        console.log("var_calculator.py loaded");

        window.pyodide = pyodide;
        pyodideReady = true;
        loadingSpinner.innerHTML = "Ready!";
        setTimeout(() => loadingSpinner.style.display = "none", 1000);
    } catch (e) {
        console.error(e);
        loadingSpinner.innerHTML = "<span style='color:red;'>Error: " + e.message + "</span>";
    }
}
loadPyodideAndModule();

// === SEARCH ===
searchButton.addEventListener("click", () => {
    const q = searchInput.value.trim().toUpperCase();
    if (!q) return;
    searchResults.innerHTML = "<p>Searching <b>" + q + "</b>...</p>";
    searchYahooFinance(q);
});

async function searchYahooFinance(ticker) {
    let attempts = 0;
    while (!pyodideReady && attempts < 40) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
    }
    if (!pyodideReady) {
        searchResults.innerHTML = "<p style='color:red;'>Timeout. Refresh.</p>";
        return;
    }

    try {
        const result = await window.pyodide.runPythonAsync(
            "import yfinance as yf\n" +
            "import json\n" +
            "t = yf.Ticker('" + ticker + "')\n" +
            "info = t.fast_info\n" +
            "data = {\n" +
            "  'symbol': info.get('symbol', '" + ticker + "'),\n" +
            "  'name': info.get('longName') or info.get('shortName') or '" + ticker + "',\n" +
            "  'price': round(info.get('lastPrice') or info.get('regularMarketPrice'), 2) or 'N/A'\n" +
            "}\n" +
            "json.dumps(data)"
        );
        const stock = JSON.parse(result);
        displaySearchResult(stock);
    } catch (e) {
        searchResults.innerHTML = "<p style='color:red;'>Invalid ticker.</p>";
        console.error(e);
    }
}

function displaySearchResult(stock) {
    searchResults.innerHTML =
        "<p><b>" + stock.name + "</b> (" + stock.symbol + ") - $" + stock.price + "</p>" +
        "<input type='number' id='weightInput' placeholder='Weight %' min='1' max='100' style='width:80px;padding:5px;'>" +
        "<button onclick=\"addToPortfolio('" + stock.symbol + "', '" + stock.name.replace(/'/g, "\\'") + "')\">Add</button>";
}

// === PORTFOLIO ===
function addToPortfolio(symbol, name) {
    if (portfolio.length >= 5) { alert("Max 5"); return; }
    const w = parseFloat(document.getElementById("weightInput").value);
    if (isNaN(w) || w <= 0 || w > 100) { alert("Weight 1-100%"); return; }
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
        row.innerHTML = "<td>" + item.name + " (" + item.symbol + ")</td><td>" + item.weight + "%</td>" +
                        "<td><button onclick='removeFromPortfolio(" + i + ")' style='background:#c33;color:#fff;padding:4px 8px;'>Remove</button></td>";
    });
}

// === CALCULATE VAR ===
calculateVarBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) { resultsTable.innerHTML = "<p>No securities.</p>"; return; }
    resultsTable.innerHTML = "<p>Calculating...</p>";
    try {
        const symbols = portfolio.map(p => p.symbol);
        const weights = portfolio.map(p => p.weight);
        const result = await window.pyodide.runPythonAsync(
            "import json\n" +
            "from var_calculator import calculate_full_portfolio\n" +
            "result = calculate_full_portfolio(" + JSON.stringify(symbols) + ", " + JSON.stringify(weights) + ")\n" +
            "json.dumps(result)"
        );
        displayVaRResults(JSON.parse(result));
    } catch (e) {
        resultsTable.innerHTML = "<p style='color:red;'>Error.</p>";
        console.error(e);
    }
});

function displayVaRResults(data) {
    let html = "<table border='1'><tr><th>Security</th><th>Normal 95%</th><th>Normal 99%</th><th>Hist 95%</th><th>Hist 99%</th><th>MC 95%</th><th>MC 99%</th><th>CF 95%</th><th>CF 99%</th><th>Exp. Return</th></tr>";
    for (const [k, v] of Object.entries(data)) {
        html += "<tr><td><b>" + k + "</b></td>" +
                "<td>" + v.Normal95 + "</td>" +
                "<td>" + v.Normal99 + "</td>" +
                "<td>" + v.Hist95 + "</td>" +
                "<td>" + v.Hist99 + "</td>" +
                "<td>" + v.MC95 + "</td>" +
                "<td>" + v.MC99 + "</td>" +
                "<td>" + v.CF95 + "</td>" +
                "<td>" + v.CF99 + "</td>" +
                "<td>" + (v.ExpReturn * 100).toFixed(2) + "%</td></tr>";
    }
    html += "</table>";
    resultsTable.innerHTML = html;
    createRiskReturnChart(data);
}

// === CHART ===
function createRiskReturnChart(data) {
    const ctx = document.getElementById("riskReturnChart").getContext("2d");
    const labels = [], risks = [], returns = [], colors = [], sizes = [];
    for (const [k, v] of Object.entries(data)) {
        if (k === "Portfolio") {
            labels.push("PORTFOLIO"); risks.push(-v.Normal95*100); returns.push(v.ExpReturn*100); colors.push("rgba(255,0,0,0.8)"); sizes.push(12);
        } else {
            labels.push(k); risks.push(-v.Normal95*100); returns.push(v.ExpReturn*100); colors.push("rgba(245,166,35,0.7)"); sizes.push(8);
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
    if (portfolio.length === 0) { priceData.innerHTML = "<p>No securities.</p>"; return; }
    priceData.innerHTML = "<p>Fetching...</p>";
    const symbols = portfolio.map(p => p.symbol);
    try {
        const result = await window.pyodide.runPythonAsync(
            "import yfinance as yf\n" +
            "import json\n" +
            "data = yf.download(" + JSON.stringify(symbols) + ", period='3mo', progress=False)['Adj Close'].tail(30).round(2)\n" +
            "json.dumps({'index': data.index.strftime('%Y-%m-%d').tolist(), 'data': data.values.tolist()})"
        );
        const df = JSON.parse(result);
        let html = "<table border='1'><tr><th>Date</th>";
        symbols.forEach(s => html += "<th>" + s + "</th>");
        html += "</tr>";
        df.data.forEach((row, i) => {
            html += "<tr><td>" + df.index[i] + "</td>";
            row.forEach(v => html += "<td>" + (v !== null ? v : "N/A") + "</td>");
            html += "</tr>";
        });
        html += "</table>";
        priceData.innerHTML = html;
    } catch (e) {
        priceData.innerHTML = "<p style='color:red;'>Failed.</p>";
    }
});
