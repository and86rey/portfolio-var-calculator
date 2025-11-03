// === Global Variables ===
let portfolio = [];
let pyodideReady = false;

// === DOM Elements ===
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const searchResults = document.getElementById("searchResults");
const portfolioTable = document.getElementById("portfolioTable");
const calculateVarBtn = document.getElementById("calculateVar");
const resultsTable = document.getElementById("resultsTable");
const showPricesBtn = document.getElementById("showPrices");
const priceData = document.getElementById("priceData");

// === Initialize Pyodide ===
async function loadPyodideAndPackages() {
    if (pyodideReady) return;
    const pyodide = await loadPyodide();
    await pyodide.loadPackage("micropip");
    await pyodide.runPythonAsync(`
        import micropip
        await micropip.install("yfinance")
        await micropip.install("pandas")
        await micropip.install("numpy")
        await micropip.install("scipy")
    `);
    window.pyodide = pyodide;
    pyodideReady = true;
    console.log("Pyodide + yfinance loaded in browser");
}
loadPyodideAndPackages();

// === Search Security ===
searchButton.addEventListener("click", () => {
    const query = searchInput.value.trim().toUpperCase();
    if (!query) return;
    searchResults.innerHTML = `<p>Searching for <b>${query}</b>...</p>`;
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
            ticker = yf.Ticker("${ticker}")
            info = ticker.info
            data = {
                "symbol": info.get("symbol", ticker),
                "name": info.get("longName") or info.get("shortName") or ticker,
                "price": info.get("currentPrice") or info.get("regularMarketPrice") or "N/A"
            }
            json.dumps(data)
        `);
        const stock = JSON.parse(result);
        displaySearchResult(stock);
    } catch (err) {
       
