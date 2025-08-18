from fastapi import FastAPI
from pydantic import BaseModel
from math import log, sqrt, exp
from typing import Literal
from statistics import NormalDist

app = FastAPI(title="feature-options")
N = NormalDist()

def bs_iv_call(price, strike, ttm, rate, option_price, tol=1e-5, max_iter=100):
    # Simple bisection for implied vol
    low, high = 1e-6, 5.0
    for _ in range(max_iter):
        mid = (low + high) / 2
        c = bs_price(price, strike, ttm, rate, mid, 'C')
        if abs(c - option_price) < tol: return mid
        if c > option_price: high = mid
        else: low = mid
    return mid

def bs_price(S, K, T, r, sigma, typ):
    if T <= 0: return max(0.0, (S-K) if typ=='C' else (K-S))
    d1 = (log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*sqrt(T))
    d2 = d1 - sigma*sqrt(T)
    if typ=='C':
        return S*N.cdf(d1) - K*exp(-r*T)*N.cdf(d2)
    else:
        return K*exp(-r*T)*N.cdf(-d2) - S*N.cdf(-d1)

def greeks(S,K,T,r,sigma,typ):
    from math import sqrt
    if T<=0: return {"delta":0,"gamma":0,"vega":0,"theta":0,"rho":0}
    d1 = (log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*sqrt(T))
    d2 = d1 - sigma*sqrt(T)
    pdf = lambda x: (1/(sqrt(2*3.1415926535)))*exp(-0.5*x*x)
    if typ=='C':
        delta = N.cdf(d1)
        rho = K*T*exp(-r*T)*N.cdf(d2)/100
        theta = (-S*pdf(d1)*sigma/(2*sqrt(T)) - r*K*exp(-r*T)*N.cdf(d2))/365
    else:
        delta = -N.cdf(-d1)
        rho = -K*T*exp(-r*T)*N.cdf(-d2)/100
        theta = (-S*pdf(d1)*sigma/(2*sqrt(T)) + r*K*exp(-r*T)*N.cdf(-d2))/365
    gamma = pdf(d1)/(S*sigma*sqrt(T))
    vega = S*pdf(d1)*sqrt(T)/100
    return {"delta":delta,"gamma":gamma,"vega":vega,"theta":theta,"rho":rho}

class Req(BaseModel):
    price: float
    strike: float
    ttm: float
    rate: float = 0.06
    iv: float | None = None
    option_price: float | None = None
    typ: Literal['C','P'] = 'C'

@app.get("/health")
def health(): return {"ok": True}

@app.post("/greeks")
def api(req: Req):
    iv = req.iv
    if iv is None and req.option_price is not None:
        iv = bs_iv_call(req.price, req.strike, req.ttm, req.rate, req.option_price) if req.typ=='C' else 0.2
    iv = iv or 0.2
    g = greeks(req.price, req.strike, req.ttm, req.rate, iv, req.typ)
    return {"iv": iv, "greeks": g}
