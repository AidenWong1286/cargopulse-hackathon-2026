"use client";
/**
 * Presentation mode: an auto-playing tour of the REAL demo story. It presses the
 * real buttons (start a demo scenario, solve it, open the proposal, the console
 * and Protect), waits for the real results, and frames each answer with a slow
 * camera move, a spotlight and a caption. It never records a decision.
 * Start with ?present=1 or the Present button; Esc stops, Space pauses, → skips.
 */
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, SkipForward, X } from "lucide-react";
import { useLocale } from "@/components/locale";
import { useFx } from "@/lib/fx";
import { playChime, playWhoosh } from "@/lib/sound";

type Pair = [string, string];
type Ctx = {
  router: ReturnType<typeof useRouter>;
  path: () => string;
  signal: { stopped: boolean };
};
type Step = {
  title: Pair;
  text: Pair;
  /** Gets the page ready (navigate, press a real button, wait for a real result). */
  prepare?: (ctx: Ctx) => Promise<boolean | void>;
  /** The element to frame. */
  target?: () => Element | null;
  zoom?: number;
  hold?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(probe: () => T | null | undefined | false, ctx: Ctx, timeout = 90_000): Promise<T | null> {
  const start = Date.now();
  while (!ctx.signal.stopped && Date.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await sleep(250);
  }
  return null;
}

function byText(selector: string, pattern: RegExp): HTMLElement | null {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    if (pattern.test((element.innerText || element.textContent || "").trim()) && element.offsetParent !== null) return element;
  }
  return null;
}

function heading(pattern: RegExp) {
  return byText("main h1, main h2, main h3", pattern);
}

async function goTo(ctx: Ctx, href: string, ready: () => Element | null) {
  if (ctx.path() !== href) ctx.router.push(href);
  return waitFor(ready, ctx, 60_000);
}

const STEPS: Step[] = [
  {
    title: ["A disruption at Hong Kong", "香港樞紐受阻"],
    text: [
      "Flights are cancelled. Every route on this chart, every count on the board, comes from the scenario's own data.",
      "航班取消。圖上每條航線、看板上每個數字，都來自情境本身的資料。",
    ],
    prepare: (ctx) => goTo(ctx, "/operations", () => document.querySelector(".desk-hero")).then(Boolean),
    target: () => document.querySelector(".desk-hero"),
    zoom: 1.04,
    hold: 6500,
  },
  {
    title: ["Start a fresh disruption", "建立新的受阻情境"],
    text: [
      "One click draws a new made-up disruption: different flights, cancellations and cargo every time.",
      "按一下即可產生新的模擬受阻情境：每次的航班、取消及貨物都不同。",
    ],
    prepare: async (ctx) => {
      const button = await waitFor(() => byText("main button", /^Start demo scenario|^開始示範情境/), ctx, 20_000);
      if (!button || (button as HTMLButtonElement).disabled) return false;
      button.scrollIntoView({ block: "center", behavior: "smooth" });
      await sleep(1600);
      button.click();
      return Boolean(await waitFor(() => /^\/operations\/[0-9a-f-]{36}/.test(ctx.path()), ctx, 90_000));
    },
    target: () => byText("main button", /Solve & compare|求解並比較/)?.closest("aside, section, .panel") ?? document.querySelector("main"),
    zoom: 1.02,
    hold: 4500,
  },
  {
    title: ["CargoPulse solves it", "CargoPulse 求解"],
    text: [
      "The optimiser places every container it can, then a separate validator re-checks the plan against every rule.",
      "最佳化器盡量為每個貨櫃安排航班，再由獨立驗證器按所有規則重新檢查。",
    ],
    prepare: async (ctx) => {
      const solve = await waitFor(() => byText("main button", /Solve & compare|求解並比較/), ctx, 20_000);
      if (!solve || (solve as HTMLButtonElement).disabled) return false;
      solve.click();
      return Boolean(
        await waitFor(() => byText("main a, main button", /Review proposal|檢視建議/), ctx, 120_000),
      );
    },
    target: () =>
      document.querySelector(".solve-swarm, .swarm-stage, .swarm-card") ??
      byText("main a, main button", /Review proposal|檢視建議/)?.closest("aside, section, .panel") ??
      null,
    zoom: 1.03,
    hold: 7000,
  },
  {
    title: ["The answer first", "答案先行"],
    text: [
      "How many containers get a flight, against the better of two simple rules, independently checked.",
      "有多少貨櫃獲安排航班，與兩個簡單規則中較佳者比較，並經獨立核實。",
    ],
    prepare: async (ctx) => {
      const review = byText("main a, main button", /Review proposal|檢視建議/);
      review?.click();
      return Boolean(await waitFor(() => /^\/plans\/[0-9a-f-]{36}$/.test(ctx.path()) && heading(/Recovery proposal|復原建議/), ctx, 60_000));
    },
    target: () => document.querySelector(".verdict") ?? document.querySelector("main .panel"),
    zoom: 1.05,
    hold: 7000,
  },
  {
    title: ["Each container, its flight, and why", "每個貨櫃、其航班及原因"],
    text: [
      "The console lists the riskiest changes first, with the reasons and the cost of waiting.",
      "控制台先列出風險最高的變更，並附原因及等待的代價。",
    ],
    prepare: async (ctx) => {
      const open = byText("main a, main button", /dispatcher console|recovery console|調度控制台|復原控制台/);
      open?.click();
      return Boolean(await waitFor(() => /\/console$/.test(ctx.path()) && document.querySelector(".console"), ctx, 60_000));
    },
    target: () => document.querySelector(".console-grid") ?? document.querySelector(".console"),
    zoom: 1.03,
    hold: 7500,
  },
  {
    title: ["Before cutoff: fewer shipments left behind", "截止前：減少滯留貨物"],
    text: [
      "On one overbooked flight, CargoPulse chooses which bookings fly, within weight and volume together.",
      "在一班超額預訂的航班上，CargoPulse 同時按重量及體積，決定哪些貨物登機。",
    ],
    prepare: async (ctx) => {
      await goTo(ctx, "/protect", () => byText("main button", /Plan this flight|規劃此航班/));
      const plan = byText("main button", /Plan this flight|規劃此航班/);
      plan?.click();
      await sleep(2500);
      return true;
    },
    target: () => document.querySelector(".cargo-hold, .hold-stage, .protect-hero") ?? document.querySelector("main .kpis, main .tiles, main .panel"),
    zoom: 1.03,
    hold: 8000,
  },
  {
    title: ["CargoPulse recommends. A person decides.", "CargoPulse 提出建議，由人員作出決定。"],
    text: [
      "Every number you saw was computed live from synthetic data. Nothing is sent to an airline.",
      "您看到的每個數字都由模擬資料即時計算。不會向航空公司傳送任何資料。",
    ],
    hold: 6000,
  },
];

export function PresentTour() {
  const { t } = useLocale();
  const { motion } = useFx();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);
  const [frame, setFrame] = useState<DOMRect | null>(null);
  const [notice, setNotice] = useState<Pair | null>(null);
  const signal = useRef({ stopped: false });
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const skipRef = useRef(false);

  const stop = useCallback(() => {
    signal.current.stopped = true;
    setRunning(false);
    setPaused(false);
    setFrame(null);
    document.documentElement.removeAttribute("data-presenting");
    const main = document.querySelector<HTMLElement>("#main");
    if (main) {
      main.style.transform = "";
      main.style.transformOrigin = "";
    }
  }, []);

  const start = useCallback(() => {
    signal.current = { stopped: false };
    setIndex(0);
    setNotice(null);
    setRunning(true);
    document.documentElement.setAttribute("data-presenting", "");
  }, []);

  // ?present=1 starts the tour.
  useEffect(() => {
    if (search.get("present") === "1" && !running) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "p" && event.altKey) {
        event.preventDefault();
        if (running) stop();
        else start();
      }
      if (!running) return;
      if (event.key === "Escape") stop();
      if (event.key === " " && !(event.target as HTMLElement)?.closest?.("input, textarea, select, button")) {
        event.preventDefault();
        setPaused((p) => !p);
      }
      if (event.key === "ArrowRight") skipRef.current = true;
    };
    window.addEventListener("keydown", onKey);
    const onToggle = () => (running ? stop() : start());
    window.addEventListener("cp:present", onToggle);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("cp:present", onToggle);
    };
  }, [running, start, stop]);

  // The director: runs the steps one after another.
  useEffect(() => {
    if (!running) return;
    const ctx: Ctx = { router, path: () => pathRef.current, signal: signal.current };
    let cancelled = false;
    const camera = (target: Element | null, zoom: number) => {
      const main = document.querySelector<HTMLElement>("#main");
      if (!main) return;
      if (!target || motion === "calm") {
        main.style.transform = "";
        setFrame(target ? target.getBoundingClientRect() : null);
        return;
      }
      target.scrollIntoView({ block: "center", behavior: motion === "lite" ? "auto" : "smooth" });
      window.setTimeout(() => {
        const box = target.getBoundingClientRect();
        const host = main.getBoundingClientRect();
        main.style.transformOrigin = `${box.left - host.left + box.width / 2}px ${box.top - host.top + box.height / 2}px`;
        main.style.transform = `scale(${zoom})`;
        window.setTimeout(() => setFrame(target.getBoundingClientRect()), 1300);
      }, 700);
    };
    (async () => {
      for (let i = 0; i < STEPS.length; i++) {
        if (cancelled || signal.current.stopped) return;
        const step = STEPS[i];
        setIndex(i);
        setFrame(null);
        const main = document.querySelector<HTMLElement>("#main");
        if (main) main.style.transform = "";
        playWhoosh();
        if (step.prepare) {
          const ok = await step.prepare(ctx);
          if (ok === false) {
            setNotice([
              "This step needs the Manager role and a working service. The tour stopped here.",
              "此步驟需要經理角色及正常運作的服務。導覽已在此停止。",
            ]);
            await sleep(5000);
            stop();
            return;
          }
        }
        if (cancelled || signal.current.stopped) return;
        await sleep(600);
        camera(step.target?.() ?? null, step.zoom ?? 1);
        const until = Date.now() + (step.hold ?? 6000);
        skipRef.current = false;
        while (Date.now() < until || pausedRef.current) {
          if (cancelled || signal.current.stopped || skipRef.current) break;
          await sleep(150);
        }
      }
      playChime();
      await sleep(400);
      stop();
    })();
    return () => {
      cancelled = true;
    };
  }, [running, router, motion, stop]);

  useEffect(() => () => stop(), [stop]);

  if (!running) return null;
  const step = STEPS[index];
  return (
    <div className="tour" role="dialog" aria-modal="false" aria-label={t("Presentation mode", "簡報模式")}>
      <div
        className="tour-spot"
        aria-hidden="true"
        style={
          frame
            ? { left: frame.left - 14, top: frame.top - 14, width: frame.width + 28, height: frame.height + 28, opacity: 1 }
            : { opacity: 0 }
        }
      />
      <div className="tour-card glass" key={index}>
        <div className="tour-progress" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span key={i} data-state={i < index ? "done" : i === index ? "now" : "next"} />
          ))}
        </div>
        <p className="tour-count">
          {index + 1} / {STEPS.length}
        </p>
        <h2 className="tour-title">{t(step.title[0], step.title[1])}</h2>
        <p className="tour-text">{notice ? t(notice[0], notice[1]) : t(step.text[0], step.text[1])}</p>
        <div className="tour-actions">
          <button type="button" className="fx-toggle" onClick={() => setPaused((p) => !p)} title={paused ? t("Resume", "繼續") : t("Pause", "暫停")}>
            {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            <span className="sr-only">{paused ? t("Resume", "繼續") : t("Pause", "暫停")}</span>
          </button>
          <button type="button" className="fx-toggle" onClick={() => (skipRef.current = true)} title={t("Next", "下一步")}>
            <SkipForward size={16} aria-hidden="true" />
            <span className="sr-only">{t("Next", "下一步")}</span>
          </button>
          <button type="button" className="fx-toggle" onClick={stop} title={t("Stop presentation (Esc)", "停止簡報（Esc）")}>
            <X size={16} aria-hidden="true" />
            <span className="sr-only">{t("Stop presentation", "停止簡報")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Top-bar button that starts or stops presentation mode. */
export function PresentButton() {
  const { t } = useLocale();
  return (
    <button
      type="button"
      className="present-button"
      onClick={() => window.dispatchEvent(new Event("cp:present"))}
      title={t("Presentation mode: an auto-playing tour of the real demo (Alt+P)", "簡報模式：自動播放真實示範導覽（Alt+P）")}
    >
      <Play size={14} strokeWidth={2} aria-hidden="true" />
      {t("Present", "簡報")}
    </button>
  );
}
