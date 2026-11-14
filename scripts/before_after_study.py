"""Before/after study: simple rules vs CargoPulse on held-out synthetic data.

Design, fixed before the run (see docs/evidence/before-after/README in the output):
* Paired: every flight / disruption is planned by both methods.
* Inference per flight or per disruption (never per AWB), so correlation inside a flight
  cannot inflate certainty.
* Protect overbooking is calibrated on a separate set of flights, using the simple rule
  only, to the observed reference offload rate (11.28%); the test flights are fresh seeds.
* Primary endpoints: Protect pooled offload rate; Recover ULDs given a flight.
  Secondary endpoints are Holm-adjusted.
* 95% paired bootstrap CIs (10,000 resamples), Wilcoxon signed-rank and exact sign tests,
  a sign-flip false-positive check and a determinism re-run.

Run:  python scripts/before_after_study.py --output docs/evidence/before-after
"""

from __future__ import annotations

import argparse
import csv
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import highspy
import numpy as np
from cargopulse_contracts import canonical_hash
from cargopulse_optimizer import run_baseline_earliest, run_baseline_priority, run_solver
from cargopulse_protect.proof import REFERENCE_OFFLOAD_RATE, calibrate, evaluate

from packages.domain_fixtures.random_disruption import GENERATOR_ID, make_random_snapshot
from scripts import study_report as R
from scripts.paired_stats import (
    bootstrap,
    false_positive_rate,
    holm,
    one_sided_upper,
    sign_test,
    wilcoxon_signed_rank,
)

AWBS_PER_FLIGHT = 150
TRIMMED_DEMAND = 1.08
RECOVER_SIZE = 140
RECOVER_AS_OF = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)


def _git_revision(root: Path) -> str:
    head = (root / ".git" / "HEAD").read_text().strip()
    if head.startswith("ref: "):
        ref = root / ".git" / head[5:]
        if ref.exists():
            return ref.read_text().strip()
        packed = root / ".git" / "packed-refs"
        for line in packed.read_text().splitlines() if packed.exists() else []:
            if line.endswith(head[5:]):
                return line.split()[0]
    return head


def _ci(interval, scale=1.0, digits=4):
    return {
        "estimate": round(interval.estimate * scale, digits),
        "ci95": [round(interval.low * scale, digits), round(interval.high * scale, digits)],
    }


def _tests(differences):
    w = wilcoxon_signed_rank(differences)
    s = sign_test(differences)
    return {
        "wilcoxon": {"n_nonzero": w.n_nonzero, "z": round(w.z, 3), "p": w.p_two_sided},
        "sign_test": {"better": s.better, "worse": s.worse, "ties": s.ties, "p": s.p_two_sided},
    }


def protect_study(flights: int, seed_base: int, log) -> dict:
    calibration_seeds = range(800001, 800201)
    test_seeds = range(seed_base, seed_base + flights)
    log(f"Protect: calibrating overbooking on {len(calibration_seeds)} separate flights…")
    demand, cal_off, cal_booked = calibrate(calibration_seeds, AWBS_PER_FLIGHT)
    log(f"  calibrated overbooking {demand - 1:.2%}; evaluating {flights} held-out flights…")
    rows = evaluate(test_seeds, AWBS_PER_FLIGHT, demand)
    log(f"  …and again with overbooking trimmed to {TRIMMED_DEMAND - 1:.0%}")
    trimmed = evaluate(test_seeds, AWBS_PER_FLIGHT, TRIMMED_DEMAND)
    repeat = evaluate(test_seeds[:20], AWBS_PER_FLIGHT, demand)

    c = {
        "booked": [r.booked for r in rows],
        "off_rule": [r.offloaded_fill for r in rows],
        "off_cp": [r.offloaded_opt for r in rows],
        "kg_rule": [r.chargeable_fill for r in rows],
        "kg_cp": [r.chargeable_opt for r in rows],
        "off_cp8": [r.offloaded_opt for r in trimmed],
        "kg_cp8": [r.chargeable_opt for r in trimmed],
        "booked8": [r.booked for r in trimmed],
    }

    def rate(key, den="booked"):
        return lambda d: d[key].sum(axis=1) / d[den].sum(axis=1)

    per_flight_diff = [
        (r.offloaded_fill - r.offloaded_opt) / r.booked * 100 for r in rows
    ]  # percentage points, positive = CargoPulse better
    kg_diff = [r.chargeable_opt - r.chargeable_fill for r in rows]
    kg8_diff = [t.chargeable_opt - r.chargeable_fill for r, t in zip(rows, trimmed, strict=True)]
    upper8 = one_sided_upper(c, rate("off_cp8", "booked8"))
    # Three plans per flight: the rule and CargoPulse at the calibrated level, CargoPulse trimmed.
    checks = (
        sum(r.check_fill for r in rows)
        + sum(r.check_opt for r in rows)
        + sum(t.check_opt for t in trimmed)
    )
    optimal = sum(r.opt_status == "OPTIMAL" for r in rows) + sum(
        t.opt_status == "OPTIMAL" for t in trimmed
    )
    return {
        "design": {
            "awbs_per_flight": AWBS_PER_FLIGHT,
            "calibration_seeds": [calibration_seeds.start, calibration_seeds.stop - 1],
            "test_seeds": [test_seeds.start, test_seeds.stop - 1],
            "flights": flights,
            "target_reference_offload_rate": float(REFERENCE_OFFLOAD_RATE),
            "calibrated_overbooking": round(demand - 1, 6),
            "calibration_set_rule_offload_rate": round(cal_off / cal_booked, 6),
            "trimmed_overbooking": round(TRIMMED_DEMAND - 1, 6),
        },
        "primary_offload_rate": {
            "before_rule_pct": _ci(bootstrap(c, rate("off_rule")), 100),
            "after_cargopulse_pct": _ci(bootstrap(c, rate("off_cp")), 100),
            "reduction_pp": _ci(
                bootstrap(c, lambda d: (d["off_rule"].sum(1) - d["off_cp"].sum(1)) / d["booked"].sum(1)),
                100,
            ),
            "relative_reduction_pct": _ci(
                bootstrap(c, lambda d: 1 - d["off_cp"].sum(1) / d["off_rule"].sum(1)), 100
            ),
            "per_flight_reduction_pp_mean": _ci(
                bootstrap({"x": per_flight_diff}, lambda d: d["x"].mean(axis=1))
            ),
            "per_flight_reduction_pp_median": round(float(np.median(per_flight_diff)), 4),
            **_tests(per_flight_diff),
            "false_positive_rate_under_sign_flip": false_positive_rate(per_flight_diff),
        },
        "secondary": {
            "billable_weight_change_pct": {
                **_ci(bootstrap(c, lambda d: d["kg_cp"].sum(1) / d["kg_rule"].sum(1) - 1), 100),
                **_tests(kg_diff),
            },
            "trimmed_overbooking": {
                "cargopulse_offload_rate_pct": _ci(bootstrap(c, rate("off_cp8", "booked8")), 100),
                "one_sided_95_upper_bound_pct": round(upper8 * 100, 4),
                "below_5pct_supported": upper8 < 0.05,
                "billable_vs_rule_at_calibrated_pct": {
                    **_ci(bootstrap(c, lambda d: d["kg_cp8"].sum(1) / d["kg_rule"].sum(1) - 1), 100),
                    **_tests(kg8_diff),
                },
            },
            "priority_or_express_offloaded": {
                "before_rule": sum(r.priority_offloaded_fill for r in rows),
                "after_cargopulse": sum(r.priority_offloaded_opt for r in rows),
            },
        },
        "integrity": {
            "plans_independently_checked": checks,
            "plans_total": 3 * flights,
            "cargopulse_proven_optimal": optimal,
            "cargopulse_runs": 2 * flights,
            "determinism_rerun_identical": repeat == rows[:20],
        },
        "_rows": [r.__dict__ for r in rows],
        "_trimmed": [r.__dict__ for r in trimmed],
    }


def _recover_one(seed: int) -> dict:
    snapshot = make_random_snapshot(seed, RECOVER_SIZE, as_of=RECOVER_AS_OF)
    ours = run_solver(snapshot, 30)
    rules = {"EARLIEST_FEASIBLE": run_baseline_earliest(snapshot), "PRIORITY_FIRST": run_baseline_priority(snapshot)}

    def key(plan):
        return (len(plan.unassigned), plan.solver.objective_value)

    best_name, best = min(rules.items(), key=lambda kv: key(kv[1]))
    return {
        "seed": seed,
        "snapshot_hash": canonical_hash(snapshot),
        "placed_cargopulse": len(ours.assignments),
        "placed_best_rule": len(best.assignments),
        "placed_earliest": len(rules["EARLIEST_FEASIBLE"].assignments),
        "placed_priority": len(rules["PRIORITY_FIRST"].assignments),
        "best_rule": best_name,
        "cost_cargopulse": float(ours.solver.objective_value),
        "cost_best_rule": float(best.solver.objective_value),
        "cargopulse_status": ours.solver.status.value,
        "cargopulse_gap": None if ours.solver.optimality_gap is None else float(ours.solver.optimality_gap),
        "all_validated": all(
            p.independent_validation.status == "PASS" for p in (ours, *rules.values())
        ),
        "cargopulse_not_worse": key(ours) <= key(best),
    }


def recover_study(scenarios: int, seed_base: int, log) -> dict:
    seeds = range(seed_base, seed_base + scenarios)
    rows = []
    started = time.monotonic()
    for i, seed in enumerate(seeds, 1):
        rows.append(_recover_one(seed))
        if i % 20 == 0:
            log(f"  Recover {i}/{scenarios} ({time.monotonic() - started:.0f}s)")
    repeat = [_recover_one(s) for s in list(seeds)[:5]]
    same = all(
        (a["placed_cargopulse"], a["cost_cargopulse"]) == (b["placed_cargopulse"], b["cost_cargopulse"])
        for a, b in zip(repeat, rows[:5], strict=True)
    )
    c = {k: [r[k] for r in rows] for k in ("placed_cargopulse", "placed_best_rule", "cost_cargopulse", "cost_best_rule")}
    placed_diff = [r["placed_cargopulse"] - r["placed_best_rule"] for r in rows]
    cost_diff = [r["cost_best_rule"] - r["cost_cargopulse"] for r in rows]
    return {
        "design": {
            "ulds_per_disruption": RECOVER_SIZE,
            "test_seeds": [seeds.start, seeds.stop - 1],
            "scenarios": scenarios,
            "generator": GENERATOR_ID,
            "before": "better of earliest-feasible and priority-first per disruption (conservative)",
        },
        "primary_ulds_placed": {
            "before_mean": _ci(bootstrap(c, lambda d: d["placed_best_rule"].mean(axis=1))),
            "after_mean": _ci(bootstrap(c, lambda d: d["placed_cargopulse"].mean(axis=1))),
            "difference_mean": _ci(bootstrap({"x": placed_diff}, lambda d: d["x"].mean(axis=1))),
            **_tests(placed_diff),
            "false_positive_rate_under_sign_flip": false_positive_rate(placed_diff),
        },
        "secondary": {
            "total_delay_cost_change_pct": {
                **_ci(
                    bootstrap(c, lambda d: d["cost_cargopulse"].sum(1) / d["cost_best_rule"].sum(1) - 1),
                    100,
                ),
                **_tests(cost_diff),
            }
        },
        "integrity": {
            "scenarios_all_plans_validated": sum(r["all_validated"] for r in rows),
            "cargopulse_proven_optimal": sum(
                r["cargopulse_status"] == "OPTIMAL" and r["cargopulse_gap"] == 0 for r in rows
            ),
            "cargopulse_never_worse_lexicographic": sum(r["cargopulse_not_worse"] for r in rows),
            "determinism_rerun_identical": same,
        },
        "_rows": rows,
    }


def write_outputs(out: Path, summary: dict, protect: dict, recover: dict | None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rows = protect.pop("_rows")
    trimmed = protect.pop("_trimmed")
    with (out / "protect_flights.csv").open("w", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                *rows[0].keys(),
                "trimmed_offloaded_opt",
                "trimmed_chargeable_opt",
                "trimmed_check_opt",
            ],
        )
        w.writeheader()
        for r, t in zip(rows, trimmed, strict=True):
            w.writerow(
                {**r, "trimmed_offloaded_opt": t["offloaded_opt"],
                 "trimmed_chargeable_opt": t["chargeable_opt"], "trimmed_check_opt": t["check_opt"]}
            )
    recover_rows = recover.pop("_rows") if recover else []
    if recover_rows:
        with (out / "recover_scenarios.csv").open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(recover_rows[0]))
            w.writeheader()
            w.writerows(recover_rows)
    secondary = [
        ("Protect: billable weight", protect["secondary"]["billable_weight_change_pct"]["wilcoxon"]["p"]),
        (
            "Protect: billable weight at 8% overbooking",
            protect["secondary"]["trimmed_overbooking"]["billable_vs_rule_at_calibrated_pct"]["wilcoxon"]["p"],
        ),
    ]
    if recover:
        secondary.append(
            ("Recover: total delay cost", recover["secondary"]["total_delay_cost_change_pct"]["wilcoxon"]["p"])
        )
    adjusted = holm([p for _, p in secondary])
    summary["holm_adjusted_secondary_p"] = {n: a for (n, _), a in zip(secondary, adjusted, strict=True)}
    summary["protect"] = protect
    summary["recover"] = recover
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (out / "report.html").write_text(_report(summary, rows, trimmed, recover_rows), encoding="utf-8")


def _fmt_p(p: float) -> str:
    return "< 0.0001" if p < 1e-4 else f"{p:.4f}"


def _report(s, rows, trimmed, recover_rows) -> str:
    p = s["protect"]
    po = p["primary_offload_rate"]
    tr = p["secondary"]["trimmed_overbooking"]
    kg = p["secondary"]["billable_weight_change_pct"]
    d = p["design"]
    sections = [
        "<div class='callout'><strong>Result.</strong> "
        f"On {d['flights']} held-out flights, the simple rule offloaded {po['before_rule_pct']['estimate']:.2f}% of booked AWBs "
        f"(95% CI {po['before_rule_pct']['ci95'][0]:.2f}–{po['before_rule_pct']['ci95'][1]:.2f}%) and CargoPulse "
        f"{po['after_cargopulse_pct']['estimate']:.2f}% ({po['after_cargopulse_pct']['ci95'][0]:.2f}–{po['after_cargopulse_pct']['ci95'][1]:.2f}%): "
        f"a reduction of {po['reduction_pp']['estimate']:.2f} percentage points ({po['relative_reduction_pct']['estimate']:.1f}% fewer offloads), "
        f"Wilcoxon p {_fmt_p(po['wilcoxon']['p'])}, while carrying {kg['estimate']:+.2f}% billable weight. "
        f"With overbooking trimmed to {d['trimmed_overbooking']:.0%}, CargoPulse offloaded {tr['cargopulse_offload_rate_pct']['estimate']:.2f}% "
        f"(one-sided 95% upper bound {tr['one_sided_95_upper_bound_pct']:.2f}%: "
        + ("below 5% is statistically supported" if tr["below_5pct_supported"] else "below 5% is NOT statistically supported")
        + ").</div>",
        "<h2>Protect: offload rate before and after</h2>",
        R.bars_with_ci(
            "Pooled offload rate (share of booked AWBs)",
            [
                ("Simple rule (before)", po["before_rule_pct"]["estimate"], *po["before_rule_pct"]["ci95"], R.BEFORE),
                ("CargoPulse, same bookings", po["after_cargopulse_pct"]["estimate"], *po["after_cargopulse_pct"]["ci95"], R.AFTER),
                (
                    f"CargoPulse, overbooking {d['trimmed_overbooking']:.0%}",
                    tr["cargopulse_offload_rate_pct"]["estimate"],
                    *tr["cargopulse_offload_rate_pct"]["ci95"],
                    R.AFTER_ALT,
                ),
            ],
            "%",
            target=5,
        ),
        R.histogram(
            "Change per flight: simple rule minus CargoPulse",
            [(r["offloaded_fill"] - r["offloaded_opt"]) / r["booked"] * 100 for r in rows],
            R.AFTER,
            " pp",
            mean_ci=(
                po["per_flight_reduction_pp_mean"]["estimate"],
                *po["per_flight_reduction_pp_mean"]["ci95"],
            ),
            note="Offload-rate reduction on each flight (percentage points)",
        ),
        R.scatter(
            "Each flight, before vs after",
            [r["offloaded_fill"] / r["booked"] * 100 for r in rows],
            [r["offloaded_opt"] / r["booked"] * 100 for r in rows],
            "%",
            "Simple rule offload rate (before)",
            "CargoPulse offload rate (after)",
        ),
    ]
    if s["recover"]:
        rc = s["recover"]
        pr = rc["primary_ulds_placed"]
        cost = rc["secondary"]["total_delay_cost_change_pct"]
        sections += [
            "<h2>Recover: containers re-protected before and after</h2>",
            "<div class='callout'>"
            f"On {rc['design']['scenarios']} held-out random disruptions of {rc['design']['ulds_per_disruption']} ULDs, "
            f"the better simple rule found a flight for {pr['before_mean']['estimate']:.1f} ULDs on average and CargoPulse for "
            f"{pr['after_mean']['estimate']:.1f} (+{pr['difference_mean']['estimate']:.2f}, 95% CI "
            f"{pr['difference_mean']['ci95'][0]:.2f}–{pr['difference_mean']['ci95'][1]:.2f}; Wilcoxon p {_fmt_p(pr['wilcoxon']['p'])}). "
            f"Total delay cost changed by {cost['estimate']:+.1f}% (95% CI {cost['ci95'][0]:.1f}–{cost['ci95'][1]:.1f}%).</div>",
            R.bars_with_ci(
                "ULDs given a compliant flight, mean per disruption",
                [
                    ("Better simple rule (before)", pr["before_mean"]["estimate"], *pr["before_mean"]["ci95"], R.BEFORE),
                    ("CargoPulse (after)", pr["after_mean"]["estimate"], *pr["after_mean"]["ci95"], R.AFTER),
                ],
                "",
                decimals=1,
            ),
            R.histogram(
                "Extra ULDs placed per disruption: CargoPulse minus the better rule",
                [r["placed_cargopulse"] - r["placed_best_rule"] for r in recover_rows],
                R.AFTER,
                "",
                mean_ci=(pr["difference_mean"]["estimate"], *pr["difference_mean"]["ci95"]),
                bin_width=1,
                note="Additional ULDs given a flight in each disruption",
            ),
        ]
    integ = p["integrity"]
    rows_table = [
        ["Protect primary: offload rate reduction", f"{po['reduction_pp']['estimate']:.2f} pp",
         f"{po['reduction_pp']['ci95'][0]:.2f} to {po['reduction_pp']['ci95'][1]:.2f}",
         _fmt_p(po["wilcoxon"]["p"]), _fmt_p(po["sign_test"]["p"]),
         f"{po['sign_test']['better']} better / {po['sign_test']['ties']} same / {po['sign_test']['worse']} worse"],
        ["Protect: billable weight", f"{kg['estimate']:+.2f}%", f"{kg['ci95'][0]:+.2f} to {kg['ci95'][1]:+.2f}",
         _fmt_p(s["holm_adjusted_secondary_p"]["Protect: billable weight"]) + " (Holm)", _fmt_p(kg["sign_test"]["p"]),
         f"{kg['sign_test']['better']} / {kg['sign_test']['ties']} / {kg['sign_test']['worse']}"],
    ]
    if s["recover"]:
        rows_table.append(
            ["Recover primary: extra ULDs placed", f"{pr['difference_mean']['estimate']:+.2f}",
             f"{pr['difference_mean']['ci95'][0]:+.2f} to {pr['difference_mean']['ci95'][1]:+.2f}",
             _fmt_p(pr["wilcoxon"]["p"]), _fmt_p(pr["sign_test"]["p"]),
             f"{pr['sign_test']['better']} / {pr['sign_test']['ties']} / {pr['sign_test']['worse']}"]
        )
        rows_table.append(
            ["Recover: total delay cost", f"{cost['estimate']:+.1f}%", f"{cost['ci95'][0]:+.1f} to {cost['ci95'][1]:+.1f}",
             _fmt_p(s["holm_adjusted_secondary_p"]["Recover: total delay cost"]) + " (Holm)", _fmt_p(cost["sign_test"]["p"]),
             f"{cost['sign_test']['better']} / {cost['sign_test']['ties']} / {cost['sign_test']['worse']}"]
        )
    sections += [
        "<h2>Statistical summary</h2>",
        R.table(["Endpoint", "Effect", "95% CI", "Wilcoxon p", "Sign test p", "Units better / same / worse"], rows_table),
        "<h2>Integrity checks</h2>",
        R.table(
            ["Check", "Result"],
            [
                ["Protect plans passing the independent load check", f"{integ['plans_independently_checked']} / {integ['plans_total']}"],
                ["Protect CargoPulse runs proven optimal", f"{integ['cargopulse_proven_optimal']} / {integ['cargopulse_runs']}"],
                ["Protect determinism re-run (20 flights)", "identical" if integ["determinism_rerun_identical"] else "DIFFERENT"],
                ["Protect sign-flip false-positive rate (should be ≈ 5%)", f"{po['false_positive_rate_under_sign_flip']:.1%}"],
            ]
            + (
                [
                    ["Recover disruptions with every plan validated", f"{s['recover']['integrity']['scenarios_all_plans_validated']} / {s['recover']['design']['scenarios']}"],
                    ["Recover CargoPulse proven optimal (gap 0)", f"{s['recover']['integrity']['cargopulse_proven_optimal']} / {s['recover']['design']['scenarios']}"],
                    ["Recover CargoPulse never worse than the better rule", f"{s['recover']['integrity']['cargopulse_never_worse_lexicographic']} / {s['recover']['design']['scenarios']}"],
                    ["Recover determinism re-run (5 disruptions)", "identical" if s["recover"]["integrity"]["determinism_rerun_identical"] else "DIFFERENT"],
                    [
                        "Recover sign-flip false-positive rate (should be ≈ 5%; whole-number data has many ties)",
                        f"{s['recover']['primary_ulds_placed']['false_positive_rate_under_sign_flip']:.1%}",
                    ],
                ]
                if s["recover"]
                else []
            ),
        ),
        "<h2>Method</h2><p>Every flight and disruption is planned by both methods (a paired design), and all "
        "inference is per flight or per disruption, never per AWB, because AWBs on one flight are not independent. "
        "Protect's overbooking was calibrated on 200 separate flights, using the simple rule only, to the 11.28% "
        "reference offload rate; the test flights and disruptions use fresh seeds that were not used during development. "
        "Confidence intervals are 95% paired percentile bootstraps (10,000 resamples) with ratio statistics recomputed "
        "in every resample. Significance uses the Wilcoxon signed-rank test (normal approximation, tie and continuity "
        "corrected) and an exact sign test; secondary endpoints are Holm-adjusted. The below-5% claim requires the "
        "one-sided 95% upper bound to be below 5%.</p>",
        "<div class='limits'><strong>Limits.</strong> All data is synthetic, from seeded generators. Protect checks total "
        "weight and volume only, not hold positions, balance or dangerous-goods separation, and the model has no booking "
        "no-shows, so the trimmed-overbooking result illustrates the method rather than a booking policy. Recover counts "
        "proposed compliant assignments, not actual deliveries. These results show the method works under stated "
        "assumptions; they are not Cathay operational results.</div>",
    ]
    meta = {
        "Generated": s["generated_at"],
        "Code (base commit)": s["git_revision"][:12],
        "Solver": s["solver"],
        "Runtime": f"{s['runtime_seconds']:.0f} s",
    }
    return R.page("CargoPulse before/after study", sections, meta)


def _numeric(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if v in ("True", "False"):
            out[k] = v == "True"
        else:
            try:
                out[k] = int(v)
            except ValueError:
                try:
                    out[k] = float(v)
                except ValueError:
                    out[k] = v
    return out


def render_saved(out: Path) -> None:
    """Re-render the report from summary.json and the CSV files, without re-running."""
    summary = json.loads((out / "summary.json").read_text())
    with (out / "protect_flights.csv").open() as f:
        rows = [_numeric(r) for r in csv.DictReader(f)]
    recover_rows = []
    if (out / "recover_scenarios.csv").exists():
        with (out / "recover_scenarios.csv").open() as f:
            recover_rows = [_numeric(r) for r in csv.DictReader(f)]
    trimmed = [
        {"offloaded_opt": r["trimmed_offloaded_opt"], "chargeable_opt": r["trimmed_chargeable_opt"]}
        for r in rows
    ]
    (out / "report.html").write_text(_report(summary, rows, trimmed, recover_rows), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--protect-flights", type=int, default=1000)
    parser.add_argument("--recover-scenarios", type=int, default=200)
    parser.add_argument("--protect-seed-base", type=int, default=900001)
    parser.add_argument("--recover-seed-base", type=int, default=910001)
    parser.add_argument(
        "--render-only", action="store_true", help="Rebuild report.html from saved results"
    )
    args = parser.parse_args()
    if args.render_only:
        render_saved(args.output)
        return
    started = time.monotonic()

    def log(message):
        print(f"[{time.monotonic() - started:6.0f}s] {message}", flush=True)

    protect = protect_study(args.protect_flights, args.protect_seed_base, log)
    recover = None
    if args.recover_scenarios:
        log(f"Recover: {args.recover_scenarios} random disruptions of {RECOVER_SIZE} ULDs…")
        recover = recover_study(args.recover_scenarios, args.recover_seed_base, log)
    root = Path(__file__).resolve().parents[1]
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_revision": _git_revision(root),
        "solver": f"HiGHS {highspy.Highs().version()}",
        "python": platform.python_version(),
        "runtime_seconds": round(time.monotonic() - started, 1),
        "statistics": "paired percentile bootstrap (10,000), Wilcoxon signed-rank, exact sign test, Holm",
    }
    write_outputs(args.output, summary, protect, recover)
    log(f"Wrote {args.output}/summary.json, report.html and CSV files")


if __name__ == "__main__":
    main()
