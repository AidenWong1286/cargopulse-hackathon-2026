"""Self-contained HTML report with inline SVG charts for the before/after study.

No external fonts, scripts or images: the file works offline and charts can be copied
into slides. Every chart has a text table beside it in summary.json and the CSV files.
"""

from __future__ import annotations

import html
import math

BEFORE = "#b07a12"  # simple rule
AFTER = "#00645a"  # CargoPulse
AFTER_ALT = "#2f8eab"  # CargoPulse at a second setting
INK = "#0e2b27"
DIM = "#5b6f6a"
GRID = "#dde5e0"
TARGET = "#b7791f"


def _esc(value) -> str:
    return html.escape(str(value))


def _nice_max(value: float) -> float:
    if value <= 0:
        return 1.0
    exponent = 10 ** math.floor(math.log10(value))
    for step in (1, 2, 2.5, 5, 10):
        if step * exponent >= value:
            return step * exponent
    return 10 * exponent


def bars_with_ci(title, items, unit, target=None, decimals=2, note=""):
    """items: [(label, estimate, low, high, colour)]"""
    width, left, right, row, top = 760, 230, 120, 54, 16
    height = top + row * len(items) + 40
    top_value = _nice_max(max([i[3] for i in items] + ([target] if target else [])) * 1.1)

    def x(v):
        return left + (v / top_value) * (width - left - right)

    parts = [f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="{_esc(title)}">']
    for k in range(6):
        v = top_value * k / 5
        parts.append(
            f'<line x1="{x(v):.1f}" x2="{x(v):.1f}" y1="{top}" y2="{height - 34}" stroke="{GRID}"/>'
            f'<text x="{x(v):.1f}" y="{height - 16}" text-anchor="middle" class="tick">'
            f"{v:.{0 if top_value >= 10 else 1}f}{unit}</text>"
        )
    for idx, (label, est, low, high, colour) in enumerate(items):
        y = top + idx * row + 10
        parts.append(
            f'<text x="{left - 12}" y="{y + 18}" text-anchor="end" class="label">{_esc(label)}</text>'
            f'<rect x="{left}" y="{y}" width="{max(2, x(est) - left):.1f}" height="26" rx="4" fill="{colour}"/>'
            f'<line x1="{x(low):.1f}" x2="{x(high):.1f}" y1="{y + 13}" y2="{y + 13}" stroke="{INK}" stroke-width="2"/>'
            f'<line x1="{x(low):.1f}" x2="{x(low):.1f}" y1="{y + 6}" y2="{y + 20}" stroke="{INK}" stroke-width="2"/>'
            f'<line x1="{x(high):.1f}" x2="{x(high):.1f}" y1="{y + 6}" y2="{y + 20}" stroke="{INK}" stroke-width="2"/>'
            f'<text x="{x(high) + 10:.1f}" y="{y + 18}" class="value">{est:.{decimals}f}{unit} '
            f'<tspan class="dim">({low:.{decimals}f}–{high:.{decimals}f})</tspan></text>'
        )
    if target is not None:
        parts.append(
            f'<line x1="{x(target):.1f}" x2="{x(target):.1f}" y1="{top - 6}" y2="{height - 34}" '
            f'stroke="{TARGET}" stroke-width="2" stroke-dasharray="5 4"/>'
            f'<text x="{x(target) + 6:.1f}" y="{top + 2}" class="tick">{target:g}{unit} target</text>'
        )
    parts.append("</svg>")
    return _figure(title, "".join(parts), note or "Bars: point estimate. Whiskers: 95% bootstrap confidence interval.")


def histogram(title, values, colour, unit, mean_ci=None, bin_width=None, note=""):
    width, left, right, top, bottom = 760, 60, 24, 18, 52
    height = 320
    lo, hi = min(values + [0.0]), max(values + [0.0])
    if bin_width is None:
        bin_width = _nice_max((hi - lo) / 30 or 1) / 2 or 1
    integer_axis = bin_width == 1 and all(float(v).is_integer() for v in values)
    # Whole-number data: each bin is centred on its value, so 0 and the mean line up.
    start = math.floor(lo) - 0.5 if integer_axis else math.floor(lo / bin_width) * bin_width
    count = max(1, math.ceil((hi - start) / bin_width + 1e-9))
    bins = [0] * count
    for v in values:
        bins[min(count - 1, int((v - start) // bin_width))] += 1
    step_count = max(1, math.ceil(_nice_max(max(bins) * 1.1) / 4))
    top_count = step_count * 4
    span = count * bin_width

    def x(v):
        return left + (v - start) / span * (width - left - right)

    def y(c):
        return height - bottom - c / top_count * (height - top - bottom)

    parts = [f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="{_esc(title)}">']
    for k in range(5):
        c = step_count * k
        parts.append(
            f'<line x1="{left}" x2="{width - right}" y1="{y(c):.1f}" y2="{y(c):.1f}" stroke="{GRID}"/>'
            f'<text x="{left - 8}" y="{y(c) + 4:.1f}" text-anchor="end" class="tick">{c:.0f}</text>'
        )
    for i, c in enumerate(bins):
        if c:
            x0 = x(start + i * bin_width)
            parts.append(
                f'<rect x="{x0 + 1:.1f}" y="{y(c):.1f}" width="{max(1, x(start + (i + 1) * bin_width) - x0 - 2):.1f}" '
                f'height="{y(0) - y(c):.1f}" fill="{colour}"><title>{c} units</title></rect>'
            )
    if mean_ci:
        est, low, high = mean_ci
        parts.append(
            f'<rect x="{x(low):.1f}" y="{top}" width="{max(2, x(high) - x(low)):.1f}" height="{y(0) - top:.1f}" fill="{INK}" opacity="0.12"/>'
            f'<line x1="{x(est):.1f}" x2="{x(est):.1f}" y1="{top}" y2="{y(0):.1f}" stroke="{INK}" stroke-width="2"/>'
            f'<text x="{x(est) + 6:.1f}" y="{top + 12}" class="tick">mean {est:.2f}{unit} (95% CI {low:.2f}–{high:.2f})</text>'
        )
    near_left = x(0) - left < 90
    parts.append(
        f'<line x1="{x(0):.1f}" x2="{x(0):.1f}" y1="{top}" y2="{y(0):.1f}" stroke="{TARGET}" stroke-width="2" stroke-dasharray="5 4"/>'
        f'<text x="{x(0) + (6 if near_left else -6):.1f}" y="{top + 30}" '
        f'text-anchor="{"start" if near_left else "end"}" class="tick">no change</text>'
    )
    tick_step = max(1, math.ceil(span / 8)) if integer_axis else span / 5
    v = start + 0.5 if integer_axis else start
    while v <= start + span + 1e-9:
        label = f"{v:.0f}" if integer_axis else f"{v:.1f}"
        parts.append(
            f'<text x="{x(v):.1f}" y="{height - bottom + 18}" text-anchor="middle" class="tick">{label}{unit}</text>'
        )
        v += tick_step
    parts.append(
        f'<text x="{(left + width - right) / 2}" y="{height - 12}" text-anchor="middle" class="axis">{_esc(note)}</text>'
        f'<text x="14" y="{(top + height - bottom) / 2}" transform="rotate(-90 14 {(top + height - bottom) / 2})" '
        f'text-anchor="middle" class="axis">Number of units</text></svg>'
    )
    return _figure(title, "".join(parts), "Right of the dashed line = CargoPulse better. Shaded band: 95% CI of the mean.")


def scatter(title, xs, ys, unit, x_label, y_label):
    width, height, left, right, top, bottom = 760, 460, 70, 24, 18, 56
    top_value = _nice_max(max(xs + ys) * 1.05)

    def px(v):
        return left + v / top_value * (width - left - right)

    def py(v):
        return height - bottom - v / top_value * (height - top - bottom)

    parts = [f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="{_esc(title)}">']
    for k in range(6):
        v = top_value * k / 5
        parts.append(
            f'<line x1="{px(v):.1f}" x2="{px(v):.1f}" y1="{top}" y2="{height - bottom}" stroke="{GRID}"/>'
            f'<line x1="{left}" x2="{width - right}" y1="{py(v):.1f}" y2="{py(v):.1f}" stroke="{GRID}"/>'
            f'<text x="{px(v):.1f}" y="{height - bottom + 18}" text-anchor="middle" class="tick">{v:.0f}{unit}</text>'
            f'<text x="{left - 8}" y="{py(v) + 4:.1f}" text-anchor="end" class="tick">{v:.0f}{unit}</text>'
        )
    parts.append(
        f'<line x1="{px(0)}" y1="{py(0)}" x2="{px(top_value)}" y2="{py(top_value)}" stroke="{TARGET}" stroke-width="2" stroke-dasharray="5 4"/>'
        f'<text x="{px(top_value) - 6:.1f}" y="{py(top_value) + 16:.1f}" text-anchor="end" class="tick">no change</text>'
    )
    for x0, y0 in zip(xs, ys, strict=True):
        parts.append(f'<circle cx="{px(x0):.1f}" cy="{py(y0):.1f}" r="3.2" fill="{AFTER}" fill-opacity="0.45"/>')
    parts.append(
        f'<text x="{(left + width - right) / 2}" y="{height - 12}" text-anchor="middle" class="axis">{_esc(x_label)}</text>'
        f'<text x="16" y="{(top + height - bottom) / 2}" transform="rotate(-90 16 {(top + height - bottom) / 2})" '
        f'text-anchor="middle" class="axis">{_esc(y_label)}</text></svg>'
    )
    below = sum(1 for a, b in zip(xs, ys, strict=True) if b < a)
    same = sum(1 for a, b in zip(xs, ys, strict=True) if b == a)
    return _figure(
        title,
        "".join(parts),
        f"One dot per unit. {below} of {len(xs)} below the line (CargoPulse better), {same} on it, "
        f"{len(xs) - below - same} above.",
    )


def _figure(title, svg, caption):
    return f'<figure><h3>{_esc(title)}</h3>{svg}<figcaption>{_esc(caption)}</figcaption></figure>'


def table(headers, rows):
    head = "".join(f"<th>{_esc(h)}</th>" for h in headers)
    body = "".join("<tr>" + "".join(f"<td>{_esc(c)}</td>" for c in r) + "</tr>" for r in rows)
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def page(title, sections, meta):
    style = f"""
    :root {{ color-scheme: light; }}
    body {{ margin: 0; background: #f6f8f5; color: {INK};
      font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans TC", sans-serif; }}
    main {{ max-width: 980px; margin: 0 auto; padding: 32px 20px 64px; }}
    h1 {{ font-size: 32px; font-weight: 600; margin: 0 0 8px; }}
    h2 {{ font-size: 22px; margin: 40px 0 12px; }}
    h3 {{ font-size: 16px; margin: 0 0 8px; }}
    p {{ max-width: 76ch; }}
    .meta, figcaption, .dim {{ color: {DIM}; font-size: 13px; }}
    figure {{ margin: 20px 0; padding: 20px; background: #fff; border: 1px solid {GRID}; border-radius: 14px; }}
    svg {{ width: 100%; height: auto; display: block; }}
    svg .tick {{ fill: {DIM}; font-size: 12px; }} svg .label {{ fill: {INK}; font-size: 14px; }}
    svg .value {{ fill: {INK}; font-size: 13px; font-weight: 600; }} svg .dim {{ fill: {DIM}; font-weight: 400; }}
    svg .axis {{ fill: {INK}; font-size: 13px; }}
    table {{ width: 100%; border-collapse: collapse; background: #fff; border: 1px solid {GRID}; border-radius: 10px; overflow: hidden; }}
    th, td {{ text-align: left; padding: 9px 12px; border-bottom: 1px solid {GRID}; font-size: 14px; vertical-align: top; }}
    th {{ background: #e9efeb; font-weight: 600; }}
    .callout {{ padding: 16px 18px; background: #fff; border-left: 4px solid {AFTER}; border-radius: 8px; margin: 16px 0; }}
    .limits {{ padding: 16px 18px; background: #faf1de; border-radius: 8px; }}
    .legend span {{ display: inline-flex; align-items: center; gap: 6px; margin-right: 18px; font-size: 14px; }}
    .legend i {{ width: 14px; height: 14px; border-radius: 3px; display: inline-block; }}
    @media (max-width: 600px) {{ main {{ padding: 20px 16px 48px; }} h1 {{ font-size: 26px; }} }}
    """
    meta_line = " · ".join(f"{_esc(k)}: {_esc(v)}" for k, v in meta.items())
    return (
        f"<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        f"<meta name='viewport' content='width=device-width, initial-scale=1'>"
        f"<title>{_esc(title)}</title><style>{style}</style></head><body><main>"
        f"<h1>{_esc(title)}</h1><p class='meta'>{meta_line}</p>"
        f"<p class='legend'><span><i style='background:{BEFORE}'></i>Before: simple rule</span>"
        f"<span><i style='background:{AFTER}'></i>After: CargoPulse</span>"
        f"<span><i style='background:{AFTER_ALT}'></i>CargoPulse, overbooking trimmed to 8%</span></p>"
        + "".join(sections)
        + "</main></body></html>"
    )
