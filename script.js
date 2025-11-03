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

function show(msg) { loading.innerHTML = `<p style="color:#f5a623">${msg}</p>`; loading.style.display = "block"; }
function hide() { setTimeout(() => loading.style.display = "none", 500); }

searchButton.onclick = async () => {
    const t = searchInput.value.trim().toUpperCase();
    if (!t) return;
    show(`Searching ${t}...`);
    try {
        const res = await fetch(`${API_URL}/ticker/${t}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        searchResults.innerHTML = `
            <p><b>${data.name}</b> (${data.symbol}) - $${data.price}</p>
            <input type="number" id="w" placeholder="Weight %" min="1" max="100" style="width:70px;">
            <button onclick="add('${data.symbol}', '${data.name.replace(/'/g, "\\'")}')">Add</button>
        `;
    } catch { searchResults.innerHTML = "<p style='color:red'>Invalid ticker</p>"; }
    hide();
};

function add(sym, name) {
    const w = parseFloat(document.getElementById("w").value);
    if (isNaN(w) || w <= 0 || w > 100) return alert("Weight 1–100%");
    const existing = portfolio.find(p => p.symbol === sym);
    if (existing) existing.weight = w; else portfolio.push({symbol: sym, name, weight: w});
    updateTable();
    searchResults.innerHTML = ""; searchInput.value = "";
}

function updateTable() {
    portfolioTable.innerHTML = "";
    let total = 0;
    portfolio.forEach((p, i) => {
        total += p.weight;
        portfolioTable.innerHTML += `<tr><td>${p.name} (${p.symbol})</td><td>${p.weight}%</td><td><button onclick="portfolio.splice(${i},1);updateTable()" style="background:red;color:white;">X</button></td></tr>`;
    });
    portfolioTable.innerHTML += `<tr><td><b>Total:</b></td><td><b>${total.toFixed(1)}%</b></td><td></td></tr>`;
}

calculateVarBtn.onclick = async () => {
    if (portfolio.length === 0) return resultsTable.innerHTML = "<p>Add securities</p>";
    show("Calculating VaR...");
    try {
        const res = await fetch(`${API_URL}/var`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({symbols: portfolio.map(p=>p.symbol), weights: portfolio.map(p=>p.weight)})
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        displayResults(data);
        drawChart(data);
    } catch (e) { resultsTable.innerHTML = `<p style="color:red">${e.message}</p>`; }
    hide();
};

function displayResults(data) {
    let html = `<table border="1" style="width:100%;margin:15px 0;"><tr style="background:#f5a623;color:black;">
        <th>Security</th><th>Normal 95%</th><th>Hist 95%</th><th>MC 95%</th><th>CF 95%</th><th>Exp Return</th>
    </tr>`;
    for (const [k, v] of Object.entries(data)) {
        const bold = k === "Portfolio" ? "style='font-weight:bold;color:#f5a623'" : "";
        html += `<tr><td ${bold}><b>${k}</b></td>
            <td>${v.Normal95}</td><td>${v.Hist95}</td><td>${v.MC95}</td><td>${v.CF95}</td>
            <td>${(v.ExpReturn*100).toFixed(2)}%</td></tr>`;
    }
    resultsTable.innerHTML = html + `</table>`;
}

function drawChart(data) {
    const ctx = document.getElementById("chart").getContext("2d");
    const labels = [], x = [], y = [], colors = [];
    for (const [k, v] of Object.entries(data)) {
        labels.push(k === "Portfolio" ? "PORTFOLIO" : k);
        x.push(-v.Normal95 * 100);
        y.push(v.ExpReturn * 100);
        colors.push(k === "Portfolio" ? "red" : "#f5a623");
    }
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: "scatter",
        data: { datasets: [{ data: labels.map((l,i)=>({x:x[i],y:y[i],label:l})), backgroundColor: colors, pointRadius: 8 }] },
        options: { responsive: true, scales: { x: { title: { display: true, text: "VaR 95% Loss (%)" }}, y: { title: { display: true, text: "Exp Return (%)" }}}}}
    });
}
