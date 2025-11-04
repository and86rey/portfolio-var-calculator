from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return {"message": "Backend Live!"}

@app.get("/ticker/{ticker}")
def get_ticker(ticker: str):
    # TEST: Always returns AAPL for now
    if ticker.upper() == "AAPL":
        return {"symbol": "AAPL", "name": "Apple Inc.", "price": 227.48}
    else:
        raise HTTPException(status_code=400, detail="Invalid ticker")

@app.post("/var")
def calculate_var():
    return {"test": "VaR works"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
