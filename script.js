// script.js — FINAL, WORKING, WITH PROXY PARSE
const API = "https://corsproxy.io/?https://portfolio-var-calculator.onrender.com";

let portfolio = [];
let chart = null;
const inp = document.getElementById("searchInput");
const btn = document.getElementById("searchButton");
const res = document.getElementById("searchResults");
const tbl = document.getElementById("portfolioTable");
const calc = document.getElementById("calculateVar");
const out = document.getElementById("resultsTable");
const spin = document.getElementById("loadingSpinner");

function loading(txt) { spin.style.display = "block"; spin.textContent = txt; }
function hide() { setTimeout(() => { spin.style.display = "none"; }, 400); }

btn.onclick = async () => {
  const t = inp.value.trim().toUpperCase(); if (!t) return;
  loading(`Searching ${t}…`);
  try {
    const proxy = await fetch(`${API}/ticker/${t}`);
    if (!proxy.ok) throw new Error(`HTTP ${proxy.status}`);
    const proxyData = await proxy.json();
    const d = JSON.parse(proxyData.contents);  // FIXED: Parse proxy "contents"
    res.innerHTML = `
      <div style="padding:10px;background:#222;border-radius:6px;margin:8px 0;">
        <strong>${d.name}</strong> (${d.symbol}) – $${d.price}
        <input id="w" type="number" min="1" max="100" placeholder="Weight %" style="width:70px;margin-left:8px;">
        <button onclick="add('${d.symbol}','${d.name.replace(/'/g,"\\'")}')" 
                style="margin-left:6px;background:#f5a623;color:#000;border:none;padding:4px 10px;border-radius:4px;">Add</button>
      </div>`;
  } catch (e) {
    res.innerHTML = `<p style="color:#f66;">Error: ${e.message}</p>`;
  }
  hide();
};

function add(sym, name) {
  const w = parseFloat(document.getElementById("w").value);
  if (isNaN(w) || w < 1 || w > 100) { alert("Weight 1-100%"); return; }
  const ex = portfolio.find(p => p.symbol === sym);
  ex ? ex.weight = w : portfolio.push({ symbol: sym, name, weight: w });
  drawTable(); res.innerHTML = ""; inp.value = "";
}

function remove(i) { portfolio.splice(i, 1); drawTable(); }

function drawTable() {
  tbl.innerHTML = ""; let tot = 0;
  portfolio.forEach((p, i) => {
    tot += p.weight;
    const tr = tbl.insertRow();
    tr.innerHTML = `<td>${p.name} (${p.symbol})</td><td>${p.weight}%</td>
                    <td><button onclick="remove(${i})" 
                    style="background:#c33;color:#fff;padding:3px 7px;border:none;border-radius:3px;">X</button></td>`;
  });
  const ft = tbl.insertRow(); ft.innerHTML = `<td><b>Total</b></td><td><b>${tot.toFixed(1)}%</b></td><td></td>`;
}

calc.onclick = async () => {
  if (!portfolio.length) { out.innerHTML = "<p>Add securities first.</p>"; return; }
  loading("Calculating VaR…");
  try {
    const payload = JSON.stringify({symbols:portfolio.map(p=>p.symbol),weights:portfolio.map(p=>p.weight)});
    const proxy = await fetch(`${API}/var`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload
    });
    if (!proxy.ok) throw new Error(`HTTP ${proxy.status}`);
    const proxyData = await proxy.json();
    const d = JSON.parse(proxyData.contents);  // FIXED: Parse proxy "contents"
    renderTable(d);
    renderChart(d);
  } catch (e) {
    out.innerHTML = `<p style="color:#f66;">Error: ${e.message}</p>`;
  }
  hide();
};

function renderTable(data) {
  let h = `<table border=1 style="width:100%;margin:12px 0;border-collapse:collapse;">
           <tr style="background:#f5a623;color:#000;"><th>Security</th><th>Normal 95%</th>
           <th>Hist 95%</th><th>MC 95%</th><th>CF 95%</th><th>Exp Return</th></tr>`;
  for (const [k, v] of Object.entries(data)) {
    const bold = k === "Portfolio" ? "style='font-weight:bold;color:#f5a623'" : "";
    h += `<tr><td ${bold}><b>${k}</b></td>
           <td>${v.Normal95}</td><td>${v.Hist95}</td><td>${v.MC95}</td>
           <td>${v.CF95}</td><td>${(v.ExpReturn * 100).toFixed(2)}%</td></tr>`;
  }
  out.innerHTML = h + "</table>";
}

function renderChart(data) {
  const ctx = document.getElementById("chart")?.getContext("2d");
  if (!ctx) return;
  const pts = [], col = [], sz = [];
  for (const [k, v] of Object.entries(data)) {
    pts.push({ x: -v.Normal95 * 100, y: v.ExpReturn * 100, label: k === "Portfolio" ? "PORTFOLIO" : k });
    col.push(k === "Portfolio" ? "#ff0000" : "#f5a623");
    sz.push(k === "Portfolio" ? 12 : 8);
  }
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "scatter",
    data: { datasets: [{ data: pts, backgroundColor: col, pointRadius: sz }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: "VaR 95% loss (%)" } },
        y: { title: { display: true, text: "Exp. annual return (%)" } }
      }
    }
  });
}
