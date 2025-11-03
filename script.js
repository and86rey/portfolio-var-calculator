// === GLOBALS ===
let portfolio = [];
let pyodideReady = false;
let riskChart = null;

// === DOM ELEMENTS ===
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
        loadingSpinner.innerHTML = "Loading Python engine... (20–40 sec)";

        const pyodide = await loadPyodide();
        await pyodide.loadPackage("micropip");

        console.log("Installing yfinance + deps...");
        await pyodide.runPythonAsync(`
            import micropip
            await micropip.install("yfinance==0.2.38")
            await micropip.install("pandas")
            await micropip.install("numpy")
            await micropip.install("scipy")
        `);

        // === PATCH requests.get TO USE CORS PROXY ===
        await pyodide.runPythonAsync(`
            import requests
            original_get = requests.get
            def proxy_get(url, **kwargs):
                proxy_url = "https://corsproxy.io/?" + url
                return original_get(proxy_url, **kwargs)
            requests.get = proxy_get
        `);

        // === LOAD var_calculator.py FROM GITHUB ===
        const moduleUrl = "https://cdn.jsdelivr.net/gh/and86rey/portfolio-var-calculator@main/var_calculator.py";
        console.log("Fetching var_calculator.py...");
        const response = await fetch(moduleUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const pyCode = await response.text();
        pyodide.runPython(pyCode);
        console.log("var_calculator.py loaded");

        window.pyodide = pyodide;
        pyodideReady = true;
        loadingSpinner.innerHTML = "Ready!";
        setTimeout(() => loadingSpinner.style.display = "none", 1000);
    } catch (err) {
        console.error("Setup failed:", err);
        loadingSpinner.innerHTML = `<span style="color:red;">Error: ${err.message}</span>`;
    }
}
loadPyodideAndModule();

// === SEARCH TICKER (FIXED FOR AAPL) ===
searchButton.addEventListener("click", () => {
    const query = searchInput.value.trim().toUpperCase();
    if (!query) return;
    searchResults.innerHTML = `<p>Searching <b>${query}</b>...</p>`;
    searchYahooFinance(query);
});

async function searchYahooFinance(ticker) {
    let attempts = 0;
    const maxAttempts = 60;
    while (!pyodideReady && attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
    }
    if (!pyodideReady) {
        searchResults.innerHTML = "<p style='color:red;'>Timeout. Refresh page.</p>";
        return;
    }

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
                "price": round(price, 2)
            }
            json.dumps(data)
        `);
        const stock = JSON.parse(result);
        if (!stock.price || stock.price === 0) throw new Error("No price data");
        displaySearchResult(stock);
    } catch (err) {
        searchResults.innerHTML = `<p style='color:red;'>Invalid ticker. Try AAPL, MSFT, GOOGL.</p>`;
        console.error("Search error:", err);
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
    if (portfolio.length >= 5) {
        alert("Maximum 5 securities allowed.");
        return;
    }
    const weight = parseFloat(document.getElementById("weightInput").value);
    if (isNaN(weight) || weight <= 0 || weight > 100) {
        alert("Enter weight between 1 and 100%");
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
        row.innerHTML = `
            <td>${item.name} (${item.symbol})</td>
            <td>${item.weight}%</td>
            <td><button onclick="removeFromPortfolio(${i})" style="background:#c33;color:#fff;padding:4px 8px;">Remove</button></td>
        `;
    });
}

// === CALCULATE VAR ===
calculateVarBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) {
        resultsTable.innerHTML = "<p>Add at least one security.</p>";
        return;
    }
    resultsTable.innerHTML = "<p>Calculating VaR... (10–20 sec)</p>";
    try {
        const symbols = portfolio.map(p => p.symbol);
        const weights = portfolio.map(p => p.weight);

        const resultJson = await window.pyodide.runPythonAsync(`
            import json
            from var_calculator import calculate_full_portfolio
            result = calculate_full_portfolio(${JSON.stringify(symbols)}, ${JSON.stringify(weights)})
            json.dumps(result)
        `);

        const result = JSON.parse(resultJson);
        displayVaRResults(result);
    } catch (err) {
        resultsTable.innerHTML = `<p style='color:red;'>Error. Check console (F12).</p>`;
        console.error("VaR error:", err);
    }
});

function displayVaRResults(data) {
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

    for (const [sym, vals] of Object.entries(data)) {
        html += `
            <tr>
                <td><b>${sym}</b></td>
                <td>${vals.Normal95}</td>
                <td>${vals.Normal99}</td>
                <td>${vals.Hist95}</td>
                <td>${vals.Hist99}</td>
                <td>${vals.MC95}</td>
                <td>${vals.MC99}</td>
                <td>${vals.CF95}</td>
                <td>${vals.CF99}</td>
                <td>${(vals.ExpReturn * 100).toFixed(2)}%</td>
            </tr>
        `;
    }
    html += "</table>";
    resultsTable.innerHTML = html;
    createRiskReturnChart(data);
}

// === RISK-RETURN CHART ===
function createRiskReturnChart(data) {
    const ctx = document.getElementById("riskReturnChart").getContext("2d");
    const labels = [], risks = [], returns = [], colors = [], sizes = [];

    for (const [sym, vals] of Object.entries(data)) {
        const risk = -vals.Normal95 * 100;
        const ret = vals.ExpReturn * 100;

        if (sym === "Portfolio") {
            labels.push("PORTFOLIO");
            colors.push("rgba(255, 0, 0, 0.9)");
            sizes.push(14);
        } else {
            labels.push(sym);
            colors.push("rgba(245, 166, 35, 0.7)");
            sizes.push(9);
        }
        risks.push(risk);
        returns.push(ret);
    }

    if (riskChart) riskChart.destroy();

    riskChart = new Chart(ctx, {
        type: "scatter",
        data: {
            datasets: [{
                data: labels.map((l, i) => ({ x: risks[i], y: returns[i], label: l })),
                backgroundColor: colors,
                borderColor: colors.map(c => c.replace("0.7", "1").replace("0.9", "1")),
                borderWidth: 2,
                pointRadius: sizes
            }]
        },
        options: {
            responsive: true,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.raw.label}: Risk ${ctx.raw.x.toFixed(3)}%, Return ${ctx.raw.y.toFixed(2)}%`
                    }
                },
                legend: { display: false }
            },
            scales: {
                x: { title: { display: true, text: "1-Day VaR 95% (Loss %)", color: "#fff" }, ticks: { color: "#fff" }, grid: { color: "#333" } },
                y: { title: { display: true, text: "Expected Annual Return (%)", color: "#fff" }, ticks: { color: "#fff" }, grid: { color: "#333" } }
            }
        }
    });
}

// === SHOW PRICES ===
showPricesBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) {
        priceData.innerHTML = "<p>No securities.</p>";
        return;
    }
    priceData.innerHTML = "<p>Fetching prices...</p>";
    const symbols = portfolio.map(p => p.symbol);

    try {
        const result = await window.pyodide.runPythonAsync(`
            import yfinance as yf
            import json
            data = yf.download(${JSON.stringify(symbols)}, period="3mo", progress=False)["Adj Close"]
            data = data.tail(30).round(2)
            json.dumps({
                "dates": data.index.strftime("%Y-%m-%d").tolist(),
                "values": data.values.tolist(),
                "columns": data.columns.tolist()
            })
        `);
        const { dates, values, columns } = JSON.parse(result);

        let html = "<table border='1'><tr><th>Date</th>";
        columns.forEach(col => html += `<th>${col}</th>`);
        html += "</tr>";

        values.forEach((row, i) => {
            html += `<tr><td>${dates[i]}</td>`;
            row.forEach(val => html += `<td>${val !== null ? val : "N/A"}</td>`);
            html += "</tr>";
        });
        html += "</table>";
        priceData.innerHTML = html;
    } catch (err) {
        priceData.innerHTML = `<p style='color:red;'>Failed to load prices.</p>`;
        console.error(err);
    }
});
