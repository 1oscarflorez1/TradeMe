"""Calibración de probabilidades por régimen (M7, Slice A).

Ajusta un calibrador que mapea la confianza cruda del modelo a una probabilidad
*calibrada* que refleja la frecuencia real de acierto. Por régimen se entrenan dos
métodos —isotónica (PAVA) y Platt (sigmoide)— y se elige el de menor Brier score.

Todo se implementa a mano en numpy (sin scikit-learn) para mantener paridad exacta con
el applier de Node: el artefacto exporta parámetros simples (knots o w/c) y ambos
lenguajes aplican la misma fórmula. Ver apps/api/src/calibration/apply.ts.
"""

from __future__ import annotations

import math
import time
from collections import defaultdict
from typing import Any

import numpy as np
import numpy.typing as npt

FloatArr = npt.NDArray[np.float64]

MIN_SAMPLES = 20  # por debajo, se usa el calibrador identidad (no distorsionar con poco dato)


def brier(prob: FloatArr, y: FloatArr) -> float:
    """Brier score: error cuadrático medio entre probabilidad y resultado (0/1)."""
    if len(prob) == 0:
        return 0.0
    return float(np.mean((prob - y) ** 2))


def _pava(values: FloatArr, weights: FloatArr) -> FloatArr:
    """Pool Adjacent Violators: ajuste isotónico (no decreciente) por mínimos cuadrados."""
    v_stack: list[float] = []
    w_stack: list[float] = []
    n_stack: list[int] = []
    for v, wt in zip(values.tolist(), weights.tolist(), strict=False):
        cv, cw, cn = float(v), float(wt), 1
        while v_stack and v_stack[-1] > cv:
            pv = v_stack.pop()
            pw = w_stack.pop()
            pn = n_stack.pop()
            cv = (pv * pw + cv * cw) / (pw + cw)
            cw = pw + cw
            cn = pn + cn
        v_stack.append(cv)
        w_stack.append(cw)
        n_stack.append(cn)
    out: list[float] = []
    for v, cn in zip(v_stack, n_stack, strict=False):
        out.extend([v] * cn)
    return np.asarray(out, dtype=np.float64)


def fit_isotonic(p: FloatArr, y: FloatArr) -> dict[str, Any]:
    """Regresión isotónica: devuelve knots (x, y) monótonos para interpolación lineal."""
    order = np.argsort(p, kind="mergesort")
    ps = p[order]
    ys = y[order]
    g = _pava(ys, np.ones_like(ys))
    xs: list[float] = []
    yy: list[float] = []
    i = 0
    n = len(ps)
    while i < n:
        j = i
        while j < n and ps[j] == ps[i]:
            j += 1
        xs.append(float(ps[i]))
        yy.append(float(np.mean(g[i:j])))
        i = j
    return {"method": "isotonic", "x": xs, "y": yy}


def _apply_isotonic(cal: dict[str, Any], p: float) -> float:
    xs: list[float] = cal["x"]
    ys: list[float] = cal["y"]
    if not xs:
        return p
    if p <= xs[0]:
        return ys[0]
    if p >= xs[-1]:
        return ys[-1]
    for i in range(len(xs) - 1):
        if xs[i] <= p <= xs[i + 1]:
            x0, x1, y0, y1 = xs[i], xs[i + 1], ys[i], ys[i + 1]
            if x1 == x0:
                return y0
            return y0 + (y1 - y0) * (p - x0) / (x1 - x0)
    return ys[-1]


def fit_platt(p: FloatArr, y: FloatArr, iters: int = 100) -> dict[str, Any]:
    """Escalado de Platt: prob = sigmoid(w·p + c). Newton con suavizado de targets."""
    n_pos = float(np.sum(y))
    n_neg = float(len(y) - n_pos)
    hi = (n_pos + 1.0) / (n_pos + 2.0)
    lo = 1.0 / (n_neg + 2.0)
    t = np.where(y > 0.5, hi, lo).astype(np.float64)
    w = 0.0
    c = 0.0
    for _ in range(iters):
        z = w * p + c
        pr = 1.0 / (1.0 + np.exp(-z))
        grad_w = float(np.sum((pr - t) * p))
        grad_c = float(np.sum(pr - t))
        s = pr * (1.0 - pr)
        h_ww = float(np.sum(s * p * p)) + 1e-12
        h_wc = float(np.sum(s * p))
        h_cc = float(np.sum(s)) + 1e-12
        det = h_ww * h_cc - h_wc * h_wc
        if abs(det) < 1e-12:
            break
        dw = (h_cc * grad_w - h_wc * grad_c) / det
        dc = (h_ww * grad_c - h_wc * grad_w) / det
        w -= dw
        c -= dc
        if abs(dw) + abs(dc) < 1e-9:
            break
    return {"method": "platt", "w": float(w), "c": float(c)}


def apply_calibrator(cal: dict[str, Any], p: float) -> float:
    """Aplica un calibrador de régimen a una confianza cruda p. Mirror de Node."""
    method = cal.get("method", "identity")
    if method == "isotonic":
        return _apply_isotonic(cal, p)
    if method == "platt":
        return 1.0 / (1.0 + math.exp(-(float(cal["w"]) * p + float(cal["c"]))))
    return p


def reliability_bins(prob: FloatArr, y: FloatArr, n_bins: int = 10) -> list[dict[str, Any]]:
    """Puntos del diagrama de fiabilidad: prob media prevista vs frecuencia real por bin."""
    bins: list[dict[str, Any]] = []
    for b in range(n_bins):
        lo = b / n_bins
        hi = (b + 1) / n_bins
        mask = (prob >= lo) & (prob <= hi) if b == n_bins - 1 else (prob >= lo) & (prob < hi)
        cnt = int(np.sum(mask))
        if cnt == 0:
            continue
        bins.append(
            {
                "p_pred": float(np.mean(prob[mask])),
                "p_true": float(np.mean(y[mask])),
                "n": cnt,
            }
        )
    return bins


def fit_regime(p: FloatArr, y: FloatArr) -> dict[str, Any]:
    """Entrena calibrador de un régimen: elige isotónica o Platt por menor Brier."""
    if len(p) < MIN_SAMPLES:
        cal: dict[str, Any] = {"method": "identity"}
        cal_probs = p
    else:
        iso = fit_isotonic(p, y)
        iso_pred = np.asarray([_apply_isotonic(iso, float(pi)) for pi in p], dtype=np.float64)
        pl = fit_platt(p, y)
        pl_pred = 1.0 / (1.0 + np.exp(-(pl["w"] * p + pl["c"])))
        b_iso = brier(iso_pred, y)
        b_pl = brier(pl_pred, y)
        if b_iso <= b_pl:
            cal = iso
            cal_probs = iso_pred
        else:
            cal = pl
            cal_probs = pl_pred
    cal["n"] = int(len(p))
    cal["brier"] = brier(cal_probs, y)
    cal["reliability"] = reliability_bins(cal_probs, y)
    return cal


def fit_calibrators(
    samples: list[tuple[str, float, float]], version: str | None = None
) -> dict[str, Any]:
    """Entrena un calibrador por régimen a partir de (regime, confianza, resultado 0/1)."""
    groups: dict[str, tuple[list[float], list[float]]] = defaultdict(lambda: ([], []))
    for regime, conf, win in samples:
        groups[regime][0].append(float(conf))
        groups[regime][1].append(float(win))
    regimes: dict[str, Any] = {}
    for reg, (ps, ys) in groups.items():
        regimes[reg] = fit_regime(
            np.asarray(ps, dtype=np.float64), np.asarray(ys, dtype=np.float64)
        )
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return {
        "version": version or f"cal-{now}",
        "created_at": now,
        "regimes": regimes,
    }
