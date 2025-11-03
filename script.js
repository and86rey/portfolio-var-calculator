// script.js — FINAL PRODUCTION VERSION (BULLETPROOF)
const API_URL = "https://portfolio-var-backend.onrender.com";  // ← YOUR RENDER URL

let portfolio = [];
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

// === UTILS ===
function showLoading(msg = "Loading...") {
    loadingSpinner.style.display = "block";
    loadingSpinner.innerHTML = `<p style="color:#f5a623;">${msg}</p>`;
}

function hideLoading() {
    setTimeout(() => loadingSpinner.style.display = "none", 500);
}

function showError(msg) {
    return `<p style="color:red; font-weight:bold;">${msg}</p>`;
}

// === SEARCH TICKER ===
searchButton.addEventListener("click", () => {
    const ticker = searchInput.value.trim().toUpperCase();
    if (!ticker) return;
    searchResults.innerHTML = "";
    showLoading(`Searching <b>${ticker}</b>...`);
    searchYahooTicker(ticker);
});

async function searchYahooTicker(ticker) {
    try {
        const res = await fetch(`${API_URL}/ticker/${ticker}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        displaySearchResult(data);
    } catch (err) {
        searchResults.innerHTML = showError(`Invalid ticker: ${ticker}`);
        console.error("Search error:", err);
    } finally {
        hideLoading();
    }
}

function displaySearchResult(stock) {
    searchResults.innerHTML = `
        <div style="padding:10px; background:#222; border-radius:8px; margin:10px 0;">
            <p><b>${stock.name}</b> (${stock.symbol}) - <b>$${stock.price}</b></p>
            <input type="number" id="weightInput" placeholder="Weight %" min="1" max="100" 
                   style="width:80px; padding:5px; margin-right:5px;">
            <button onclick="addToPortfolio('${stock.symbol}', '${stock.name.replace(/'/g, "\\'")}')" 
                    style="background:#f5a623; color:#000; padding:5px 10px; border:none; border-radius:4px; cursor:pointer;">
                Add
            </button>
        </div>
    `;
}

// === PORTFOLIO MANAGEMENT ===
function addToPortfolio(symbol, name) {
    if (portfolio.length >= 5) return alert("Maximum 5 securities");
    const weight = parseFloat(document.getElementById("weightInput").value);
    if (isNaN(weight) || weight <= 0 || weight > 100) return alert("Enter weight 1–100%");

    const existing = portfolio.find(p => p.symbol === symbol);
    if (existing) {
        existing.weight = weight;
    } else {
        portfolio.push({ symbol, name, weight });
    }
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
    const totalWeight = portfolio.reduce((sum, p) => sum + p.weight, 0);
    portfolio.forEach((item, i) => {
        const row = portfolioTable.insertRow();
        row.innerHTML = `
            <td>${item.name} (${item.symbol})</td>
            <td>${item.weight}%</td>
            <td><button onclick="removeFromPortfolio(${i})" 
                   style="background:#c33; color:#fff; padding:4px 8px; border:none; border-radius:4px; font-size:0.8em;">
                Remove
            </button></td>
        `;
    });
    // Show total weight
    const footer = portfolioTable.insertRow();
    footer.innerHTML = `<td colspan="2"><b>Total Weight:</b> ${totalWeight.toFixed(1)}%</td><td></td>`;
}

// === CALCULATE VaR ===
calculateVarBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) {
        resultsTable.innerHTML = showError("Add at least one security");
        return;
    }
    resultsTable.innerHTML = "";
    showLoading("Calculating VaR... (10–20 sec)");
    try {
        const res = await fetch(`${API_URL}/var`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                symbols: portfolio.map(p => p.symbol),
                weights: portfolio.map(p => p.weight)
            })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        displayVaRResults(data);
        createRiskReturnChart(data);
    } catch (err) {
        resultsTable.innerHTML = showError(`Calculation failed: ${err.message}`);
        console.error("VaR error:", err);
    } finally {
        hideLoading();
    }
});

function displayVaRResults(data) {
    let html = `
        <table border="1" style="width:100%; border-collapse:collapse; margin:15px 0;">
            <tr style="background:#f5a623; color:#000;">
                <th>Security</th>
                <th>Normal 95%</th>
                <th>Hist 95%</th>
                <th>MC 95%</th>
                <th>CF 95%</th>
                <th>Exp Return</th>
            </tr>
    `;
    for (const [sym, vals] of Object.entries(data)) {
        const isPortfolio = sym === "Portfolio";
        html += `
            <tr style="background:${isPortfolio ? '#333' : '#222'}; font-weight:${isPortfolio ? 'bold' : 'normal'};">
                <td style="color:${isPortfolio ? '#f5a623' : '#fff'};"><b>${sym}</b></td>
                <td>${vals.Normal95}</td>
                <td>${vals.Hist95}</td>
                <td>${vals.MC95}</td>
                <td>${vals.CF95}</td>
                <td>${(vals.ExpReturn * 100).toFixed(2)}%</td>
            </tr>
        `;
    }
    html += `</table>`;
    resultsTable.innerHTML = html;
}

// === RISK-RETURN CHART ===
function createRiskReturnChart(data) {
    const ctx = document.getElementById("riskReturnChart")?.getContext("2d");
    if (!ctx) return;

    const labels = [], risks = [], returns = [], colors = [], sizes = [];
    for (const [sym, vals] of Object.entries(data)) {
        labels.push(sym === "Portfolio" ? "PORTFOLIO" : sym);
        risks.push(-vals.Normal95 * 100);
        returns.push(vals.ExpReturn * 100);
        colors.push(sym === "Portfolio" ? "#ff0000" : "#f5a623");
        sizes.push(sym === "Portfolio" ? 12 : 8);
    }

    if (riskChart) riskChart.destroy();
    riskChart = new Chart(ctx, {
        type: "scatter",
        data: {
            datasets: [{
                data: labels.map((l, i) => ({ x: risks[i], y: returns[i], label: l })),
                backgroundColor: colors,
                borderColor: colors.map(c => c + "CC"),
                borderWidth: 2,
                pointRadius: sizes
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.raw.label}: Risk ${ctx.raw.x.toFixed(3)}%, Return ${ctx.raw.y.toFixed(2)}%`
                    }
                },
                legend: { display: false }
            },
            scales: {
                x: {
                    title: { display: true, text: "1-Day VaR 95% (Loss %)", color: "#fff" },
                    ticks: { color: "#fff" },
                    grid: { color: "#444" }
                },
                y: {
                    title: { display: true, text: "Expected Annual Return (%)", color: "#fff" },
                    ticks: { color: "#fff" },
                    grid: { color: "#444" }
                }
            }
        }
    });
}

// === HISTORICAL PRICES ===
showPricesBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) {
        priceData.innerHTML = showError("No securities in portfolio");
        return;
    }
    priceData.innerHTML = "";
    showLoading("Fetching prices...");
    const symbols = portfolio.map(p => p.symbol);
    try {
        const res = await fetch(`${API_URL}/prices`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbols })
        });
        if (!res.ok) throw new Error("Network error");
        const { dates, values, columns } = await res.json();
        let html = `<table border="1" style="width:100%; font-size:0.9em;"><tr><th>Date</th>`;
        columns.forEach(c => html += `<th>${c}</th>`);
        html += `</tr>`;
        values.forEach((row, i) => {
            html += `<tr><td>${dates[i]}</td>`;
            row.forEach(v => html += `<td>${v !== null ? v : "N/A"}</td>`);
            html += `</tr>`;
        });
        html += `</table>`;
        priceData.innerHTML = html;
    } catch (err) {
        priceData.innerHTML = showError("Failed to load prices");
        console.error(err);
    } finally {
        hideLoading();
    }
});

// === INIT ===
document.addEventListener("DOMContentLoaded", () => {
    showLoading("Backend ready!");
    setTimeout(hideLoading, 1000);
});
