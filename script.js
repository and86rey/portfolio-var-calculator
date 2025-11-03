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

// === Initialize Pyodide + Import Python Module ===
async function loadPyodideAndModule() {
    if (pyodideReady) return;

    const pyodide = await loadPyodide();
    await pyodide.loadPackage("micropip");
    
    // Install required packages
    await pyodide.runPythonAsync(`
        import micropip
        await micropip.install("yfinance")
        await micropip.install("pandas")
        await micropip.install("numpy")
        await micropip.install("scipy")
    `);

    // Load the var_calculator.py module from GitHub
    const moduleUrl = "https://raw.githubusercontent.com/YOUR-USERNAME/portfolio-var-calculator/main/var_calculator.py";
    const response = await fetch(moduleUrl);
    const pyCode = await response.text();
    pyodide.runPython(pyCode);

    window.pyodide = pyodide;
    pyodideReady = true;
    console.log("Pyodide + var_calculator.py loaded");
}
loadPyodideAndModule();

// === Search Security ===
searchButton.addEventListener("click", () => {
    const query = searchInput.value.trim().toUpperCase();
    if (!query) return;
    searchResults.innerHTML = `<p>Searching <b>${query}</b>...</p>`;
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
            t = yf.Ticker("${ticker}")
            info = t.info
            data = {
                "symbol": info.get("symbol", "${ticker}"),
                "name": info.get("longName") or info.get("shortName") or "${ticker}",
                "price": info.get("currentPrice") or info.get("regularMarketPrice") or "N/A"
            }
            json.dumps(data)
        `);
        const stock = JSON.parse(result);
        displaySearchResult(stock);
    } catch (err) {
        searchResults.innerHTML = `<p>Error: Invalid ticker. Try AAPL, MSFT.</p>`;
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
        row.innerHTML = `
            <td>${item.name} (${item.symbol})</td>
            <td>${item.weight}%</td>
            <td><button onclick="removeFromPortfolio(${i})" style="background:#c33;color:#fff;padding:4px 8px;">Remove</button></td>
        `;
    });
}

// === Calculate VaR using Python Module ===
calculateVarBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) {
        resultsTable.innerHTML = "<p>No securities.</p>";
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
        resultsTable.innerHTML = "<p>Error. Check console.</p>";
        console.error(err);
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

    // Generate Chart
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
                        label: ctx => `${ctx.raw.label}: Risk ${ctx.raw.x.toFixed(3)}%, Return ${ctx.raw.y.toFixed(2)}%`
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
    const prices = await window.pyodide.runPythonAsync(`
        import yfinance as yf
        import json
        data = yf.download(${JSON.stringify(symbols)}, period="3mo", progress=False)["Adj Close"]
        data = data.tail(30).round(2)
        json.dumps({"index": data.index.strftime('%Y-%m-%d').tolist(), "data": data.values.tolist()})
    `);
    const df = JSON.parse(prices);
    let html = `<table border="1"><tr><th>Date</th>`;
    symbols.forEach(s => html += `<th>${s}</th>`);
    html += `</tr>`;
    df.data.forEach((row, i) => {
        html += `<tr><td>${df.index[i]}</td>`;
        row.forEach(v => html += `<td>${v !== null ? v : 'N/A'}</td>`);
        html += `</tr>`;
    });
    html += `</table>`;
    priceData.innerHTML = html;
});
