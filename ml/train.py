"""Train, evaluate and export the ParkEase parking-demand Random Forest.

Input : data/synthetic_occupancy.csv (from generate_synthetic.py) and, optionally, real history
        exported from MongoDB with backend/scripts/export-occupancy.js (--real path.csv).
Output: backend/src/ml/demand-model.json      model used by the Node API for inference
        ml/reports/metrics.json               all evaluation numbers
        ml/reports/confusion_matrix.png       confusion matrix on the held-out test period
        ml/reports/feature_importance.png
        backend/tests/fixtures/demand-vectors.json   Python predictions used by the Node parity test

The target is the demand level of a (lot, date, hour): low (<40% occupied), medium (40-75%) or high (>=75%).
The split is by time: the model is trained on earlier dates and tested on the final ~2 months it has never seen.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import sklearn
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score, ConfusionMatrixDisplay
from sklearn.model_selection import GridSearchCV, TimeSeriesSplit

ROOT = Path(__file__).resolve().parent.parent
LOT_TYPES = ["Mall", "Office", "Transit", "Hospital", "Event"]
# Order matters: backend/src/ml/predictor.js builds the same vector in the same order.
FEATURES = ["hour", "day_of_week", "is_weekend", "month", "capacity", "price"] + [f"type_{t}" for t in LOT_TYPES]
LABELS = ["low", "medium", "high"]


def featurize(df: pd.DataFrame) -> pd.DataFrame:
    d = pd.to_datetime(df["date"])
    X = pd.DataFrame({
        "hour": df["hour"].astype(int),
        "day_of_week": d.dt.dayofweek,          # Monday = 0
        "is_weekend": (d.dt.dayofweek >= 5).astype(int),
        "month": d.dt.month,
        "capacity": df["capacity"].astype(float),
        "price": df["price"].astype(float),
    })
    for t in LOT_TYPES:
        X[f"type_{t}"] = (df["lot_type"] == t).astype(int)
    return X[FEATURES]


def export_forest(model: RandomForestClassifier) -> list:
    trees = []
    for est in model.estimators_:
        t = est.tree_
        leaf = t.children_left == -1
        values = t.value[:, 0, :]
        probs = values / values.sum(axis=1, keepdims=True)
        trees.append({
            "feature": [int(f) if not lf else -1 for f, lf in zip(t.feature, leaf)],
            "threshold": [round(float(x), 6) if not lf else 0 for x, lf in zip(t.threshold, leaf)],
            "left": t.children_left.tolist(),
            "right": t.children_right.tolist(),
            "value": [[round(float(p), 5) for p in row] if lf else None for row, lf in zip(probs, leaf)],
        })
    return trees


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--synthetic", default=str(ROOT / "ml/data/synthetic_occupancy.csv"))
    ap.add_argument("--real", help="optional CSV of real hourly occupancy exported from MongoDB")
    ap.add_argument("--test-from", default="2025-11-01", help="first date of the held-out test period")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    df = pd.read_csv(args.synthetic)
    if args.real:
        real = pd.read_csv(args.real)
        real["source"] = "real"
        df = pd.concat([df, real], ignore_index=True)
    df = df.sort_values(["date", "hour"]).reset_index(drop=True)
    sources = df["source"].value_counts().to_dict()
    print("Rows by source:", sources)

    train_df, test_df = df[df["date"] < args.test_from], df[df["date"] >= args.test_from]
    X_train, y_train = featurize(train_df), train_df["demand"]
    X_test, y_test = featurize(test_df), test_df["demand"]

    # Small grid search with time-ordered folds, so validation folds are always later than training folds.
    grid = GridSearchCV(
        RandomForestClassifier(n_estimators=60, class_weight="balanced", random_state=args.seed, n_jobs=-1),
        {"max_depth": [8, 12, 16], "min_samples_leaf": [5, 20]},
        cv=TimeSeriesSplit(n_splits=3), scoring="f1_macro", n_jobs=1,
    )
    grid.fit(X_train, y_train)
    model = grid.best_estimator_
    print("Best params:", grid.best_params_, "CV macro F1:", round(grid.best_score_, 4))

    y_pred = model.predict(X_test)
    baseline = DummyClassifier(strategy="most_frequent").fit(X_train, y_train)
    y_base = baseline.predict(X_test)
    cm = confusion_matrix(y_test, y_pred, labels=LABELS)
    report = classification_report(y_test, y_pred, labels=LABELS, output_dict=True, zero_division=0)
    metrics = {
        "data": {
            "rows_by_source": {k: int(v) for k, v in sources.items()},
            "train_rows": int(len(train_df)), "test_rows": int(len(test_df)),
            "train_period": [train_df["date"].min(), train_df["date"].max()],
            "test_period": [test_df["date"].min(), test_df["date"].max()],
            "class_share_test": {k: round(float(v), 4) for k, v in y_test.value_counts(normalize=True).items()},
            "note": "Synthetic rows are simulated from documented assumptions in generate_synthetic.py, not observed parking data.",
        },
        "model": {"type": "RandomForestClassifier", "n_estimators": 60, **grid.best_params_, "class_weight": "balanced",
                  "cv_macro_f1": round(float(grid.best_score_), 4), "sklearn_version": sklearn.__version__},
        "test": {
            "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
            "macro_f1": round(float(f1_score(y_test, y_pred, average="macro")), 4),
            "weighted_f1": round(float(f1_score(y_test, y_pred, average="weighted")), 4),
            "per_class": {k: {m: round(float(v), 4) for m, v in report[k].items()} for k in LABELS},
            "confusion_matrix": {"labels": LABELS, "rows_are": "actual", "columns_are": "predicted", "matrix": cm.tolist()},
        },
        "baseline_most_frequent": {
            "predicts": str(y_base[0]),
            "accuracy": round(float(accuracy_score(y_test, y_base)), 4),
            "macro_f1": round(float(f1_score(y_test, y_base, average="macro")), 4),
        },
        "feature_importance": {f: round(float(v), 4) for f, v in sorted(zip(FEATURES, model.feature_importances_), key=lambda p: -p[1])},
    }
    reports = ROOT / "ml/reports"
    reports.mkdir(parents=True, exist_ok=True)
    (reports / "metrics.json").write_text(json.dumps(metrics, indent=2))

    fig, ax = plt.subplots(figsize=(5, 4.2))
    ConfusionMatrixDisplay(cm, display_labels=LABELS).plot(ax=ax, cmap="Blues", colorbar=False, values_format="d")
    ax.set_title("Demand model: confusion matrix (test period)")
    fig.tight_layout(); fig.savefig(reports / "confusion_matrix.png", dpi=200); plt.close(fig)

    imp = metrics["feature_importance"]
    fig, ax = plt.subplots(figsize=(6, 3.6))
    ax.barh(list(imp)[::-1], list(imp.values())[::-1], color="#4f46e5")
    ax.set_xlabel("Mean decrease in impurity"); ax.set_title("Feature importance")
    fig.tight_layout(); fig.savefig(reports / "feature_importance.png", dpi=200); plt.close(fig)

    classes = [str(c) for c in model.classes_]
    trained_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    export = {
        "name": "parkease-demand-rf", "version": trained_at[:10].replace("-", "") + "-1", "trainedAt": trained_at,
        "features": FEATURES, "lotTypes": LOT_TYPES, "classes": classes,
        "thresholds": {"low": "<40% occupied", "medium": "40-75% occupied", "high": ">=75% occupied"},
        "trainingData": metrics["data"], "metrics": {"accuracy": metrics["test"]["accuracy"], "macroF1": metrics["test"]["macro_f1"],
                                                       "baselineAccuracy": metrics["baseline_most_frequent"]["accuracy"]},
        "trees": export_forest(model),
    }
    out = ROOT / "backend/src/ml/demand-model.json"
    out.write_text(json.dumps(export, separators=(",", ":")))
    print(f"Exported model to {out} ({out.stat().st_size / 1024:.0f} KB)")

    # Parity fixtures: 300 test rows with scikit-learn's own probabilities.
    sample = test_df.sample(300, random_state=args.seed)
    probs = model.predict_proba(featurize(sample))
    vectors = [{"input": {"lotType": r.lot_type, "capacity": float(r.capacity), "price": float(r.price), "date": r.date, "hour": int(r.hour)},
                "probabilities": dict(zip(classes, [round(float(p), 6) for p in pr])), "level": classes[int(np.argmax(pr))]}
               for r, pr in zip(sample.itertuples(), probs)]
    fixtures = ROOT / "backend/tests/fixtures"
    fixtures.mkdir(parents=True, exist_ok=True)
    (fixtures / "demand-vectors.json").write_text(json.dumps(vectors, indent=1))
    print(json.dumps({k: metrics[k] for k in ("test", "baseline_most_frequent")}, indent=2))


if __name__ == "__main__":
    main()
