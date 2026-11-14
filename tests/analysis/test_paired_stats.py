"""The before/after statistics are checked against hand-computed textbook values."""

import math

import numpy as np
import pytest

from scripts.paired_stats import (
    bootstrap,
    false_positive_rate,
    holm,
    one_sided_upper,
    sign_test,
    wilcoxon_signed_rank,
)


def test_wilcoxon_all_positive_matches_hand_computation():
    # d = 1..10: W+ = 55, mean 27.5, var 10*11*21/24 = 96.25,
    # z = (55 - 27.5 - 0.5) / sqrt(96.25) = 2.7521, p = erfc(z / sqrt 2) = 0.005922
    result = wilcoxon_signed_rank(list(range(1, 11)))
    assert result.n_nonzero == 10 and result.w_plus == 55
    assert result.z == pytest.approx(2.7521, abs=1e-4)
    assert result.p_two_sided == pytest.approx(0.005922, abs=1e-5)


def test_wilcoxon_ties_and_zeros():
    # Zeros dropped; |d| = 1,1,2,2,3 -> ranks 1.5,1.5,3.5,3.5,5; W+ = 1.5 + 3.5 + 5 = 10
    # var = 5*6*11/24 - (6 + 6)/48 = 13.75 - 0.25 = 13.5
    result = wilcoxon_signed_rank([0, 1, -1, 2, -2, 3, 0])
    assert result.n_nonzero == 5 and result.w_plus == 10
    assert result.z == pytest.approx((10 - 7.5 - 0.5) / math.sqrt(13.5))


def test_wilcoxon_no_effect_gives_p_one():
    assert wilcoxon_signed_rank([0, 0, 0]).p_two_sided == 1.0
    assert wilcoxon_signed_rank([1, -1]).p_two_sided == 1.0


def test_sign_test_matches_binomial():
    # 9 better, 1 worse: p = 2 * (C(10,0) + C(10,1)) / 2^10 = 22 / 1024
    result = sign_test([1] * 9 + [-1] + [0, 0])
    assert (result.better, result.worse, result.ties) == (9, 1, 2)
    assert result.p_two_sided == pytest.approx(22 / 1024)
    assert sign_test([1, -1]).p_two_sided == 1.0


def test_holm_adjustment():
    assert holm([0.01, 0.04, 0.03]) == pytest.approx([0.03, 0.06, 0.06])
    assert holm([0.5, 0.9]) == pytest.approx([1.0, 1.0])  # 2 x 0.5 capped at 1, monotone


def test_bootstrap_mean_ci_has_close_to_nominal_coverage():
    rng = np.random.default_rng(1)
    covered = 0
    for rep in range(200):
        sample = rng.normal(0.0, 1.0, 60)
        ci = bootstrap({"x": sample}, lambda c: c["x"].mean(axis=1), resamples=2000, seed=rep)
        covered += ci.low <= 0.0 <= ci.high
    assert 0.88 <= covered / 200 <= 0.99


def test_bootstrap_ratio_is_recomputed_per_resample():
    num, den = [1, 2, 3, 4], [10, 10, 10, 10]
    ci = bootstrap(
        {"n": num, "d": den}, lambda c: c["n"].sum(axis=1) / c["d"].sum(axis=1), resamples=500
    )
    assert ci.estimate == pytest.approx(0.25)
    assert ci.low < 0.25 < ci.high
    assert one_sided_upper(
        {"n": num, "d": den}, lambda c: c["n"].sum(axis=1) / c["d"].sum(axis=1), resamples=500
    ) <= ci.high + 1e-12


def test_no_effect_data_is_rarely_called_significant():
    rng = np.random.default_rng(3)
    differences = rng.normal(0, 1, 300).tolist()
    assert false_positive_rate(differences, repetitions=200) <= 0.10
