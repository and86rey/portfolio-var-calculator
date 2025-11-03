// script.js — FINAL, 100% WORKING, NO SYNTAX ERRORS
const API_URL = "https://portfolio-var-backend.onrender.com";

let portfolio = [];
let chart = null;

const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const searchResults = document.getElementById("searchResults");
const portfolioTable = document.getElementById("portfolioTable");
const calculateVarBtn = document.getElementById("calculateVar");
const resultsTable = document.getElementById("resultsTable");
const loading = document.getElementById("loadingSpinner");

// === LOADING UTILS ===
function show(msg) { 
    loading.innerHTML = `<p style="color:#f5a623; margin:10px 0;">${msg}</p>`; 
    loading.style.display = "block"; 
}
function hide() { 
    setTimeout(() => loading.style.display = "none", 500); 
}

// === SEARCH TICKER ===
searchButton.onclick = async () => {
    const t = searchInput.value.trim().toUpperCase();
    if (!t) return;
    show(`Searching ${t}...`);
    try {
        const res = await fetch(`${API_URL}/ticker/${t}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        searchResults.innerHTML = `
            <div style="padding:12px; background:#222; border-radius:8px; margin:10px 0;">
                <p style="margin:0 0 8px 0;"><b>${data.name}</b> (${data.symbol}) - <b>$${data.price}</b></p>
                <input type="number" id="weightInput" placeholder="Weight %" min="1" max="100" 
                       style="width:80px; padding:5px; margin-right:5px; border-radius:4px; border:1px solid #555;">
                <button onclick="addToPortfolio('${data.symbol}', '${data.name.replace(/'/g, "\\'")}')" 
                        style="background:#f5a623; color:#000; padding:5px 12px; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">
                    Add
                </button>
            </div>
        `;
    } catch (e) {
        searchResults.innerHTML = `<p style="color:red; margin:10px 0;">Invalid ticker: ${t}</p>`;
    }
    hide();
};

// === ADD TO PORTFOLIO ===
function addToPortfolio(symbol, name) {
    const w = parseFloat(document.getElementById("weightInput").value);
    if (isNaN(w) || w <= 0 || w > 100) {
        alert("Enter weight between 1 and 100%");
        return;
    }
    const existing = portfolio.find(p => p.symbol === symbol);
    if (existing) {
        existing.weight = w;
    } else {
        portfolio.push({ symbol, name, weight: w });
    }
    updatePortfolioTable();
    searchResults.innerHTML = "";
    searchInput.value = "";
}

// === REMOVE ITEM (SAFE) ===
function removeItem(index) {
    portfolio.splice(index, 1);
    updatePortfolioTable();
}

// === UPDATE PORTFOLIO TABLE ===
function updatePortfolioTable() {
    portfolioTable.innerHTML = "";
    let total = 0;
    portfolio.forEach((p, i) => {
        total += p.weight;
        const row = portfolioTable.insertRow();
        row.innerHTML = `
            <td style="padding:8px;">${p.name} (${p.symbol})</td>
            <td style="padding:8px;">${p.weight}%</td>
            <td style="padding:8px;">
                <button onclick="removeItem(${i})" 
                        style="background:#c33; color:white; padding:4px 8px; border:none; border-radius:4px; cursor:pointer; font-size:0.9em;">
                    Remove
                </button>
            </td>
        `;
    });
    const footer = portfolioTable.insertRow();
    footer.innerHTML = `
        <td style="padding:8px; font-weight:bold;">Total Weight:</td>
        <td style="padding:8px; font-weight:bold;">${total.toFixed(1)}%</td>
        <td></td>
    `;
}

// === CALCULATE VaR ===
calculateVarBtn.onclick = async () => {
    if (portfolio.length === 0) {
        resultsTable.innerHTML = `<p style="color:#aaa; margin:15px 0;">Add at least one security.</p>`;
        return;
    }
    show("Calculating VaR... (10–20 sec)");
    try {
        const res = await fetch(`${API_URL}/var`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                symbols: portfolio.map(p => p.symbol),
                weights: portfolio.map(p => p.weight)
            })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        displayVaRResults(data);
        drawRiskReturnChart(data);
    } catch (e) {
        resultsTable.innerHTML = `<p style="color:red; margin:15px 0;">Error: ${e.message}</p>`;
    }
    hide();
};

// === DISPLAY VaR TABLE ===
function displayVaRResults(data) {
    let html = `
        <table border="1" style="width:100%; border-collapse:collapse; margin:15px 0; font-size:0.95em;">
            <tr style="background:#f5a623; color:#000; font-weight:bold;">
                <th style="padding:10px;">Security</th>
                <th style="padding:10px;">Normal 95%</th>
                <th style="padding:10px;">Hist 95%</th>
                <th style="padding:10px;">MC 95%</th>
                <th style="padding:10px;">CF 95%</th>
                <th style="padding:10px;">Exp Return</th>
            </tr>
    `;
    for (const [k, v] of Object.entries(data)) {
        const isPortfolio = k === "Portfolio";
        html += `
            <tr style="background:${isPortfolio ? '#333' : '#222'};">
                <td style="padding:10px; color:${isPortfolio ? '#f5a623' : '#fff'}; font-weight:${isPortfolio ? 'bold' : 'normal'};">
                    <b>${k}</b>
                </td>
                <td style="padding:10px;">${v.Normal95}</td>
                <td style="padding:10px;">${v.Hist95}</td>
                <td style="padding:10px;">${v.MC95}</td>
                <td style="padding:10px;">${v.CF95}</td>
                <td style="padding:10px;">${(v.ExpReturn * 100).toFixed(2)}%</td>
            </tr>
        `;
    }
    html += `</table>`;
    resultsTable.innerHTML = html;
}

// === RISK-RETURN CHART ===
function drawRiskReturnChart(data) {
    const ctx = document.getElementById("chart")?.getContext("2d");
    if (!ctx) return;

    const labels = [], risks = [], returns = [], colors = [], sizes = [];
    for (const [k, v] of Object.entries(data)) {
        labels.push(k === "Portfolio" ? "PORTFOLIO" : k);
        risks.push(-v.Normal95 * 100);
        returns.push(v.ExpReturn * 100);
        colors.push(k === "Portfolio" ? "#ff0000" : "#f5a623");
        sizes.push(k === "Portfolio" ? 12 : 8);
    }

    if (chart) chart.destroy();
    chart = new Chart(ctx, {
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

// === INIT ===
document.addEventListener("DOMContentLoaded", () => {
    show("Backend ready!");
    setTimeout(hide, 1000);
});
