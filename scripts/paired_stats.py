"""Small, dependency-free paired statistics used by the before/after study.

Only the standard library and numpy (already installed with the solver) are used, so the
evidence can be reproduced without adding packages. Each function is checked against
textbook values in tests/analysis/test_paired_stats.py.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Interval:
    estimate: float
    low: float
    high: float


def bootstrap(
    columns: Mapping[str, Sequence[float]],
    statistic: Callable[[Mapping[str, np.ndarray]], np.ndarray],
    resamples: int = 10_000,
    seed: int = 20261114,
    level: float = 0.95,
) -> Interval:
    """Paired percentile bootstrap: whole units (flights/scenarios) are resampled together.

    `statistic` receives each column as a 2-D array (resample x unit) and must return one
    value per resample; ratio statistics are therefore recomputed inside every resample.
    """
    data = {k: np.asarray(v, dtype=float) for k, v in columns.items()}
    n = len(next(iter(data.values())))
    if n == 0 or any(len(v) != n for v in data.values()):
        raise ValueError("columns must be non-empty and of equal length")
    estimate = float(statistic({k: v[np.newaxis, :] for k, v in data.items()})[0])
    rng = np.random.default_rng(seed)
    index = rng.integers(0, n, size=(resamples, n))
    values = np.asarray(statistic({k: v[index] for k, v in data.items()}), dtype=float)
    tail = (1 - level) / 2
    low, high = np.quantile(values, [tail, 1 - tail])
    return Interval(estimate, float(low), float(high))


def one_sided_upper(
    columns: Mapping[str, Sequence[float]],
    statistic: Callable[[Mapping[str, np.ndarray]], np.ndarray],
    resamples: int = 10_000,
    seed: int = 20261114,
    level: float = 0.95,
) -> float:
    """Upper one-sided bootstrap bound: the claim "value < x" is supported if bound < x."""
    data = {k: np.asarray(v, dtype=float) for k, v in columns.items()}
    n = len(next(iter(data.values())))
    rng = np.random.default_rng(seed)
    index = rng.integers(0, n, size=(resamples, n))
    values = np.asarray(statistic({k: v[index] for k, v in data.items()}), dtype=float)
    return float(np.quantile(values, level))


def _average_ranks(values: Sequence[float]) -> tuple[list[float], list[int]]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    ties = []
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        rank = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = rank
        ties.append(j - i + 1)
        i = j + 1
    return ranks, ties


@dataclass(frozen=True)
class Wilcoxon:
    n_nonzero: int
    w_plus: float
    z: float
    p_two_sided: float


def wilcoxon_signed_rank(differences: Sequence[float]) -> Wilcoxon:
    """Wilcoxon signed-rank test, normal approximation with tie and continuity correction.

    Zero differences are dropped (Wilcoxon's method). Suitable for n >= ~20; the study
    uses n >= 200.
    """
    d = [float(x) for x in differences if x != 0]
    n = len(d)
    if n == 0:
        return Wilcoxon(0, 0.0, 0.0, 1.0)
    ranks, ties = _average_ranks([abs(x) for x in d])
    w_plus = sum(r for r, x in zip(ranks, d, strict=True) if x > 0)
    mean = n * (n + 1) / 4
    var = n * (n + 1) * (2 * n + 1) / 24 - sum(t**3 - t for t in ties) / 48
    if var <= 0:
        return Wilcoxon(n, w_plus, 0.0, 1.0)
    diff = w_plus - mean
    z = (diff - math.copysign(0.5, diff)) / math.sqrt(var) if diff else 0.0
    return Wilcoxon(n, w_plus, z, min(1.0, math.erfc(abs(z) / math.sqrt(2))))


@dataclass(frozen=True)
class SignTest:
    better: int
    worse: int
    ties: int
    p_two_sided: float


def sign_test(differences: Sequence[float]) -> SignTest:
    """Exact two-sided binomial sign test; ties are excluded from the test, reported."""
    better = sum(1 for x in differences if x > 0)
    worse = sum(1 for x in differences if x < 0)
    ties = len(differences) - better - worse
    n = better + worse
    if n == 0:
        return SignTest(better, worse, ties, 1.0)
    k = min(better, worse)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / 2**n
    return SignTest(better, worse, ties, min(1.0, 2 * tail))


def holm(p_values: Sequence[float]) -> list[float]:
    """Holm-Bonferroni adjusted p-values (step-down, monotone, capped at 1)."""
    m = len(p_values)
    order = sorted(range(m), key=lambda i: p_values[i])
    adjusted = [0.0] * m
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * p_values[i]))
        adjusted[i] = running
    return adjusted


def false_positive_rate(
    differences: Sequence[float], repetitions: int = 200, seed: int = 7, alpha: float = 0.05
) -> float:
    """Type-I error check: randomly flip the sign of each paired difference (the null of
    "no effect") and report how often the Wilcoxon test still calls it significant."""
    rng = np.random.default_rng(seed)
    base = np.asarray(differences, dtype=float)
    hits = 0
    for _ in range(repetitions):
        flipped = base * rng.choice([-1.0, 1.0], size=len(base))
        hits += wilcoxon_signed_rank(flipped.tolist()).p_two_sided < alpha
    return hits / repetitions
