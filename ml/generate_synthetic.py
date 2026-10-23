"""Generate a SYNTHETIC hourly parking-occupancy history for training the demand model.

ParkEase does not yet have enough real bookings to train a model, so this script simulates
one year of hourly occupancy for a set of parking lots. Every row is labelled source="synthetic".
The simulation is a set of hand-written assumptions (below), not observed data: the trained
model can only learn these assumptions back. Replace or extend it with real history exported
by `backend/scripts/export-occupancy.js` as bookings accumulate.

Assumptions:
  * Each lot type has an hourly occupancy profile for weekdays and weekends.
  * Higher prices reduce demand slightly (about -0.4 percentage points per $1 above $30).
  * Seasonality: malls are busier in December; offices are quieter in August and late December.
  * A random per-day effect (weather, local events) and per-hour noise make the data imperfect.
  * Occupied spots in an hour ~ Binomial(capacity, p).

Usage: python generate_synthetic.py --out data/synthetic_occupancy.csv --seed 42
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

# The six lots in backend/scripts/seed.js plus six extra synthetic lots with other capacities and
# prices, so the model learns from lot characteristics rather than memorising specific lots.
LOTS = [
    ("Skyline Central Parking", "Mall", 48, 40), ("Greenway Business Hub", "Office", 36, 30),
    ("Sunset Plaza Garage", "Mall", 62, 50), ("MetroLink Park & Ride", "Transit", 80, 20),
    ("Aurora Medical Centre", "Hospital", 40, 25), ("The Foundry Social", "Event", 52, 35),
    ("Synthetic Office B", "Office", 120, 45), ("Synthetic Mall B", "Mall", 150, 25),
    ("Synthetic Transit B", "Transit", 40, 15), ("Synthetic Hospital B", "Hospital", 90, 35),
    ("Synthetic Event B", "Event", 200, 60), ("Synthetic Office C", "Office", 24, 20),
]


def base_profile(lot_type: str, hour: int, dow: int) -> float:
    """Expected occupancy rate (0..1) before noise, for a lot type, hour (0-23) and day (Mon=0)."""
    weekend = dow >= 5
    if lot_type == "Office":
        if weekend:
            return 0.10 if 9 <= hour < 17 else 0.04
        if 9 <= hour < 17: return 0.86
        if hour in (7, 8): return 0.50
        if hour in (17, 18): return 0.48
        return 0.05
    if lot_type == "Mall":
        if hour < 10 or hour >= 22: return 0.04
        if weekend: return 0.88 if 12 <= hour < 19 else 0.58
        return 0.72 if 17 <= hour < 21 else 0.38
    if lot_type == "Transit":
        if weekend: return 0.30 if 8 <= hour < 20 else 0.08
        if 7 <= hour < 18: return 0.90
        if hour == 6 or 18 <= hour < 20: return 0.55
        return 0.10
    if lot_type == "Hospital":
        if 8 <= hour < 20: return 0.62 if weekend else 0.76
        return 0.25
    if lot_type == "Event":
        if 18 <= hour < 24: return 0.92 if dow in (4, 5) else 0.42
        if 12 <= hour < 18: return 0.30 if weekend else 0.15
        return 0.04
    raise ValueError(lot_type)


def seasonal(lot_type: str, month: int, day: int) -> float:
    if lot_type == "Mall" and month == 12: return 0.10
    if lot_type == "Office" and (month == 8 or (month == 12 and day >= 22)): return -0.15
    return 0.0


def demand_level(rate: float) -> str:
    """Label used by the model. Thresholds are a design choice documented in ml/README.md."""
    if rate >= 0.75: return "high"
    if rate >= 0.40: return "medium"
    return "low"


def generate(start: str, end: str, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.date_range(start, end, freq="D")
    rows = []
    for name, lot_type, capacity, price in LOTS:
        price_effect = -0.004 * (price - 30)
        for d in dates:
            day_effect = rng.normal(0, 0.08)
            for hour in range(24):
                p = base_profile(lot_type, hour, d.dayofweek) + seasonal(lot_type, d.month, d.day) + price_effect
                p = float(np.clip(p + day_effect + rng.normal(0, 0.05), 0.0, 1.0))
                occupied = int(rng.binomial(capacity, p))
                rate = occupied / capacity
                rows.append((name, lot_type, capacity, price, d.strftime("%Y-%m-%d"), hour, occupied, rate, demand_level(rate), "synthetic"))
    return pd.DataFrame(rows, columns=["lot_name", "lot_type", "capacity", "price", "date", "hour", "occupied", "occupancy_rate", "demand", "source"])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/synthetic_occupancy.csv")
    ap.add_argument("--start", default="2025-01-01")
    ap.add_argument("--end", default="2025-12-31")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    df = generate(args.start, args.end, args.seed)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"Wrote {len(df):,} SYNTHETIC rows to {args.out}")
    print(df["demand"].value_counts(normalize=True).round(3).to_string())
