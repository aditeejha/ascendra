"""Train the ASCENDRA junction forecaster on real camera counts.

Dataset: "Traffic Prediction Dataset" (Kaggle, hasibullahaman/traffic-prediction-dataset), file TrafficTwoMonth.csv:
vehicle counts per 15 minutes (cars, bikes, buses, trucks) with a traffic-situation label (low, normal, high, heavy).

Models (XGBoost):
  count +15 / +30 min      regression on the total vehicle count
  situation now / +15 / +30 min   4-class classification

Output: server/models/junction-forecaster.json (trees evaluated natively by the Node server)
        ml/reports/junction_model_metrics.json
"""

import io
import json
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, mean_absolute_error, mean_squared_error, r2_score
from sklearn.utils.class_weight import compute_sample_weight

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "ml" / "data" / "kaggle-traffic" / "TrafficTwoMonth.csv"
MODEL_OUT = ROOT / "server" / "models" / "junction-forecaster.json"
REPORT_OUT = ROOT / "ml" / "reports" / "junction_model_metrics.json"
DATASET_URL = "https://www.kaggle.com/datasets/hasibullahaman/traffic-prediction-dataset"
DOWNLOAD_URL = "https://www.kaggle.com/api/v1/datasets/download/hasibullahaman/traffic-prediction-dataset"

CLASSES = ["low", "normal", "high", "heavy"]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
FEATURES = [
    "car",
    "bike",
    "heavy",
    "total",
    "total_lag1",
    "total_lag2",
    "total_lag3",
    "total_lag4",
    "total_mean4",
    "total_std4",
    "diff1",
    "heavy_share",
    "bike_share",
    "tod_sin",
    "tod_cos",
    "dow",
    "weekend",
]
STEPS_PER_DAY = 96


def class_weights(labels):
    return np.sqrt(compute_sample_weight("balanced", labels))


def download() -> None:
    print(f"Downloading the Kaggle dataset from {DATASET_URL} ...")
    request = urllib.request.Request(DOWNLOAD_URL, headers={"User-Agent": "ASCENDRA/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
    DATA.parent.mkdir(parents=True, exist_ok=True)
    for member in archive.namelist():
        if member.endswith(".csv") and "/" not in member:
            (DATA.parent / member).write_bytes(archive.read(member))


def load() -> pd.DataFrame:
    if not DATA.exists():
        download()
    raw = pd.read_csv(DATA)
    t = pd.to_datetime(raw["Time"], format="%I:%M:%S %p")
    minutes = t.dt.hour * 60 + t.dt.minute
    d = pd.DataFrame(
        {
            "step": np.arange(len(raw)),
            "car": raw["CarCount"],
            "bike": raw["BikeCount"],
            "heavy": raw["BusCount"] + raw["TruckCount"],
            "total": raw["Total"],
            "minute": minutes,
            "dow": raw["Day of the week"].map(DAYS.index),
            "situation": raw["Traffic Situation"].str.lower().map(CLASSES.index),
        }
    )
    d["day"] = d["step"] // STEPS_PER_DAY
    for k in range(1, 5):
        d[f"total_lag{k}"] = d["total"].shift(k)
    window = d["total"].rolling(4)
    d["total_mean4"] = window.mean()
    d["total_std4"] = window.std()
    d["diff1"] = d["total"] - d["total_lag1"]
    d["heavy_share"] = d["heavy"] / d["total"]
    d["bike_share"] = d["bike"] / d["total"]
    angle = d["minute"] / 1440 * 2 * np.pi
    d["tod_sin"] = np.sin(angle)
    d["tod_cos"] = np.cos(angle)
    d["weekend"] = d["dow"].isin([5, 6]).astype(int)
    for h in (1, 2):
        d[f"total_h{h}"] = d["total"].shift(-h)
        d[f"situation_h{h}"] = d["situation"].shift(-h)
    d["total_yday_h1"] = d["total"].shift(STEPS_PER_DAY - 1)
    d["total_yday_h2"] = d["total"].shift(STEPS_PER_DAY - 2)
    d["situation_yday_h1"] = d["situation"].shift(STEPS_PER_DAY - 1)
    d["situation_yday_h2"] = d["situation"].shift(STEPS_PER_DAY - 2)
    return d


def tree_arrays(booster: xgb.Booster):
    model = json.loads(booster.save_raw(raw_format="json").decode("utf-8"))
    gb = model["learner"]["gradient_booster"]["model"]
    trees = []
    for tree in gb["trees"]:
        trees.append(
            {
                "left": tree["left_children"],
                "right": tree["right_children"],
                "feature": tree["split_indices"],
                "threshold": [float("%.9g" % v) for v in tree["split_conditions"]],
                "defaultLeft": [int(v) for v in tree["default_left"]],
            }
        )
    return trees, [int(v) for v in gb.get("tree_info", [0] * len(trees))]


def leaf_sums(trees, tree_class, rows, num_class):
    out = np.zeros((len(rows), num_class))
    for i, row in enumerate(rows.astype(np.float32)):
        for tree, cls in zip(trees, tree_class):
            node = 0
            while tree["left"][node] != -1:
                value = row[tree["feature"][node]]
                if np.isnan(value):
                    node = tree["left"][node] if tree["defaultLeft"][node] else tree["right"][node]
                else:
                    node = tree["left"][node] if value < np.float32(tree["threshold"][node]) else tree["right"][node]
            out[i, cls] += tree["threshold"][node]
    return out


def export(booster: xgb.Booster, sample: np.ndarray, num_class: int):
    trees, tree_class = tree_arrays(booster)
    sums = leaf_sums(trees, tree_class, sample, num_class)
    margin = booster.predict(xgb.DMatrix(sample, feature_names=FEATURES), output_margin=True).reshape(len(sample), num_class)
    base = (margin - sums).mean(axis=0)
    parity = float(np.max(np.abs(sums + base - margin) / (1 + np.abs(margin))))
    if parity > 1e-5:
        raise SystemExit(f"Exported trees disagree with XGBoost (max diff {parity})")
    checks = [{"x": [float(v) for v in row], "margin": [float(m) for m in mrow]} for row, mrow in zip(sample[:8], margin[:8])]
    return {"baseScore": [float(b) for b in base], "numClass": num_class, "trees": trees, "treeClass": tree_class, "checks": checks}, parity


def main():
    d = load()
    usable = d.dropna(subset=FEATURES + ["total_h2", "situation_h2"]).copy()
    days = usable["day"]
    train = usable[days < 44]
    val = usable[(days >= 44) & (days < 53)]
    test = usable[days >= 53]
    print(f"rows: train {len(train)} (days 1-44), validation {len(val)} (days 45-53), test {len(test)} (days 54-62)")

    common = dict(max_depth=4, learning_rate=0.05, subsample=0.9, colsample_bytree=0.9, min_child_weight=3, reg_lambda=1.0, tree_method="hist", n_jobs=-1, random_state=7)
    exported = {"count": {}, "situation": {}}
    metrics = {"trainRows": len(train), "valRows": len(val), "testRows": len(test)}
    report = {}
    sample = test[FEATURES].to_numpy(dtype=np.float64)[:400]

    for h in (1, 2):
        minutes = str(15 * h)
        reg = xgb.XGBRegressor(n_estimators=1500, objective="reg:squarederror", eval_metric="mae", early_stopping_rounds=60, **common)
        reg.fit(train[FEATURES], train[f"total_h{h}"], eval_set=[(val[FEATURES], val[f"total_h{h}"])], verbose=False)
        booster = reg.get_booster()[: reg.best_iteration + 1]
        y = test[f"total_h{h}"].to_numpy()
        pred = booster.predict(xgb.DMatrix(test[FEATURES]))
        persist = test["total"].to_numpy()
        yday = test[f"total_yday_h{h}"].to_numpy()
        ok = ~np.isnan(yday)
        metrics[f"countMae{minutes}"] = round(float(mean_absolute_error(y, pred)), 2)
        metrics[f"countRmse{minutes}"] = round(float(np.sqrt(mean_squared_error(y, pred))), 2)
        metrics[f"countR2_{minutes}"] = round(float(r2_score(y, pred)), 3)
        metrics[f"countMaePersistence{minutes}"] = round(float(mean_absolute_error(y, persist)), 2)
        metrics[f"countMaeYesterday{minutes}"] = round(float(mean_absolute_error(y[ok], yday[ok])), 2)
        metrics[f"countTrees{minutes}"] = booster.num_boosted_rounds()
        model, parity = export(booster, sample, 1)
        exported["count"][minutes] = model
        metrics[f"countParity{minutes}"] = float(f"{parity:.2e}")
        print(
            f"count +{minutes} min: MAE {metrics[f'countMae{minutes}']} vehicles (persistence {metrics[f'countMaePersistence{minutes}']}, "
            f"same time yesterday {metrics[f'countMaeYesterday{minutes}']}), R2 {metrics[f'countR2_{minutes}']}, trees {metrics[f'countTrees{minutes}']}"
        )

    for h in (0, 1, 2):
        minutes = str(15 * h)
        target = "situation" if h == 0 else f"situation_h{h}"
        clf = xgb.XGBClassifier(n_estimators=1500, objective="multi:softprob", num_class=4, eval_metric="mlogloss", early_stopping_rounds=60, **common)
        y_train = train[target].astype(int)
        y_val = val[target].astype(int)
        clf.fit(
            train[FEATURES],
            y_train,
            sample_weight=class_weights(y_train),
            eval_set=[(val[FEATURES], y_val)],
            sample_weight_eval_set=[class_weights(y_val)],
            verbose=False,
        )
        booster = clf.get_booster()[: clf.best_iteration + 1]
        y = test[target].astype(int).to_numpy()
        prob = booster.predict(xgb.DMatrix(test[FEATURES]))
        pred = prob.argmax(axis=1)
        metrics[f"situationAcc{minutes}"] = round(float(accuracy_score(y, pred)), 4)
        metrics[f"situationF1_{minutes}"] = round(float(f1_score(y, pred, average="macro")), 4)
        heavy = y == 3
        metrics[f"heavyRecall{minutes}"] = round(float((pred[heavy] == 3).mean()), 4) if heavy.any() else None
        if h:
            persist = test["situation"].astype(int).to_numpy()
            yday = test[f"situation_yday_h{h}"].to_numpy()
            ok = ~np.isnan(yday)
            metrics[f"situationAccPersistence{minutes}"] = round(float(accuracy_score(y, persist)), 4)
            metrics[f"situationF1Persistence{minutes}"] = round(float(f1_score(y, persist, average="macro")), 4)
            metrics[f"situationAccYesterday{minutes}"] = round(float(accuracy_score(y[ok], yday[ok].astype(int))), 4)
        metrics[f"situationTrees{minutes}"] = booster.num_boosted_rounds()
        model, parity = export(booster, sample, 4)
        exported["situation"][minutes] = model
        metrics[f"situationParity{minutes}"] = float(f"{parity:.2e}")
        report[f"confusion{minutes}"] = {"labels": CLASSES, "matrix": confusion_matrix(y, pred, labels=[0, 1, 2, 3]).tolist()}
        gain = booster.get_score(importance_type="gain")
        report[f"importance{minutes}"] = [
            {"feature": f, "gain": round(g, 3)}
            for f, g in sorted(((FEATURES[int(k[1:])] if k.startswith("f") and k[1:].isdigit() else k, v) for k, v in gain.items()), key=lambda kv: -kv[1])[:10]
        ]
        extra = f", persistence {metrics[f'situationAccPersistence{minutes}']}" if h else ""
        print(
            f"situation {'now' if h == 0 else f'+{minutes} min'}: accuracy {metrics[f'situationAcc{minutes}']} (macro F1 {metrics[f'situationF1_{minutes}']}{extra}), "
            f"heavy recall {metrics[f'heavyRecall{minutes}']}, trees {metrics[f'situationTrees{minutes}']}"
        )

    payload = {
        "name": "XGBoost junction forecaster",
        "dataset": {
            "name": "Traffic Prediction Dataset (Kaggle)",
            "url": DATASET_URL,
            "file": DATA.name,
            "rows": int(len(d)),
            "days": int(d["day"].max() + 1),
            "intervalMin": 15,
            "classes": ["cars", "bikes", "buses + trucks"],
        },
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "features": FEATURES,
        "classes": CLASSES,
        "models": exported,
        "metrics": metrics,
    }
    MODEL_OUT.write_text(json.dumps(payload, separators=(",", ":")))
    REPORT_OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT_OUT.write_text(json.dumps({"metrics": metrics, **report}, indent=2))
    print(f"Saved {MODEL_OUT.relative_to(ROOT)} ({MODEL_OUT.stat().st_size / 1e3:.0f} kB) and {REPORT_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
