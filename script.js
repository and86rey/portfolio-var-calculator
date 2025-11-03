// script.js — MINIMAL, WORKING, NO PYODIDE
const API_URL = "https://portfolio-var-backend.onrender.com"; // ← YOUR BACKEND

let portfolio = [];

// === DOM ===
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const searchResults = document.getElementById("searchResults");
const portfolioTable = document.getElementById("portfolioTable");
const calculateVarBtn = document.getElementById("calculateVar");
const resultsTable = document.getElementById("resultsTable");
const showPricesBtn = document.getElementById("showPrices");
const priceData = document.getElementById("priceData");

// === SEARCH ===
searchButton.addEventListener("click", async () => {
    const ticker = searchInput.value.trim().toUpperCase();
    if (!ticker) return;
    searchResults.innerHTML = "Searching...";
    try {
        const res = await fetch(`${API_URL}/ticker/${ticker}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        displaySearchResult(data);
    } catch (e) {
        searchResults.innerHTML = `<p style="color:red;">Invalid ticker: ${ticker}</p>`;
    }
});

function displaySearchResult(stock) {
    searchResults.innerHTML = `
        <p><b>${stock.name}</b> (${stock.symbol}) - $${stock.price}</p>
        <input type="number" id="weightInput" placeholder="Weight %" min="1" max="100" style="width:80px;">
        <button onclick="addToPortfolio('${stock.symbol}', '${stock.name}')">Add</button>
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
        portfolioTable.insertRow().innerHTML = `
            <td>${item.name} (${item.symbol})</td>
            <td>${item.weight}%</td>
            <td><button onclick="removeFromPortfolio(${i})" style="background:#c33;color:#fff;padding:4px 8px;">Remove</button></td>
        `;
    });
}

// === CALCULATE VAR ===
calculateVarBtn.addEventListener("click", async () => {
    if (portfolio.length === 0) return resultsTable.innerHTML = "<p>No securities.</p>";
    resultsTable.innerHTML = "Calculating...";
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
        displayVaRResults(data);
    } catch (e) {
        resultsTable.innerHTML = `<p style="color:red;">Error: ${e.message}</p>`;
    }
});

function displayVaRResults(data) {
    let html = `<table border="1"><tr><th>Security</th><th>Normal 95%</th><th>Hist 95%</th><th>MC 95%</th><th>CF 95%</th><th>Exp Return</th></tr>`;
    for (const [k, v] of Object.entries(data)) {
        html += `<tr><td><b>${k}</b></td><td>${v.Normal95}</td><td>${v.Hist95}</td><td>${v.MC95}</td><td>${v.CF95}</td><td>${(v.ExpReturn*100).toFixed(2)}%</td></tr>`;
    }
    html += `</table>`;
    resultsTable.innerHTML = html;
}
