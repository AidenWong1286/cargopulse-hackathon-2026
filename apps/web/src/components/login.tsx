"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSkippable } from "@/lib/fx";
import { playChime, playWhoosh } from "@/lib/sound";
import { hideSession, confirmDevelopmentSignIn, prepareOrganisationSignIn } from "@/lib/session-boundary";
import { LocaleSwitch, useLocale } from "./locale";
import { FxControls } from "@/components/fx/fx-controls";
import { ErrorNotice } from "./ui";
import { BrandMark } from "./kit/brand-mark";
import { markArrival } from "./chart/arrival";

/** The 3D glass globe loads after the page, so sign-in is usable at once. */
const Globe = dynamic(() => import("./fx/globe").then((m) => m.Globe), {
  ssr: false,
  loading: () => <div className="globe-placeholder" />,
});

/** The card fades before the workspace opens, so the light carries the eye across. */
const LEAVE_MS = 280;

/**
 * The headline, revealed letter by letter with a gold glint (the ShimmerTitle
 * effect from fx.css), keeping its two lines. The accessible name is plain text.
 */
function ShimmerLines({ text, delay = 0 }: { text: string; delay?: number }) {
  const lines = text.split("\n");
  const total = Array.from(text.replace(/\s+/g, "")).length;
  const step = Math.max(14, Math.min(40, 900 / Math.max(1, total)));
  let index = 0;
  return (
    <h1
      className="shimmer-title login-title"
      aria-label={lines.join(" ")}
      style={{ "--st-step": `${step}ms`, "--st-n": total, "--st-d": `${delay}ms` } as React.CSSProperties}
    >
      {lines.map((line, l) => (
        <span key={l}>
          <span aria-hidden="true" className="shimmer-letters login-title-line">
            {line.split(/(\s+)/).map((word, w) =>
              !word ? null : /^\s+$/.test(word) ? (
                <span key={w}> </span>
              ) : (
                <span key={w} className="shimmer-word">
                  {Array.from(word).map((ch, c) => (
                    <span key={c} className="shimmer-ch" style={{ "--i": index++ } as React.CSSProperties}>
                      {ch}
                    </span>
                  ))}
                </span>
              ),
            )}
          </span>
          {l < lines.length - 1 ? " " : null}
        </span>
      ))}
    </h1>
  );
}

export function Login({ development }: { development: boolean }) {
  const { t } = useLocale();
  const [identity, setIdentity] = useState("manager");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [diving, setDiving] = useState(false);
  const introSkipped = useSkippable(true);
  async function signin(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    // The globe turns to Hong Kong and dives in while the request runs; it never delays it.
    setDiving(true);
    playWhoosh();
    hideSession("signin");
    try {
      if (new URLSearchParams(location.search).has("switch")) {
        try { await api("/auth/logout", { method: "POST" }); }
        catch (error) {
          if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) throw error;
        }
      }
      await api("/auth/development", {
        method: "POST",
        body: { identity_id: identity },
      });
      await confirmDevelopmentSignIn();
      const next = new URLSearchParams(location.search).get("next");
      setLeaving(true);
      playChime();
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        await new Promise((resolve) => window.setTimeout(resolve, LEAVE_MS));
      // The workspace picks the light up where this page leaves it.
      markArrival();
      window.location.replace(
        next &&
          /^\/(operations|policies|audit|evidence|plans)([/?]|$)/.test(next)
          ? next
          : "/operations",
      );
    } catch (e) {
      setError(e);
      setBusy(false);
      setDiving(false);
    }
  }
  async function organisationSignin(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (busy) return;
    setError(undefined);
    setBusy(true);
    try {
      await prepareOrganisationSignIn();
      window.location.assign("/api/v1/auth/login");
    } catch (error) {
      setError(error);
      setBusy(false);
    }
  }
  const sso = (
    <a
      className={development ? "button wide login-sso" : "button primary wide login-enter"}
      href="/api/v1/auth/login"
      onClick={organisationSignin}
      aria-disabled={busy}
    >
      {t("Continue with organisation SSO", "使用機構 SSO 繼續")}
      <ArrowUpRight size={16} strokeWidth={1.75} aria-hidden="true" />
    </a>
  );
  return (
    <main
      className="login"
      data-leaving={leaving || undefined}
      data-diving={diving || undefined}
      data-intro={introSkipped ? "skip" : "play"}
    >
      <div className="login-globe" aria-hidden="true">
        <Globe dive={diving} skipIntro={introSkipped} />
        <div className="login-flare">
          <span className="login-flare-rays" />
        </div>
      </div>
      <div className="login-story">
        <p className="brand">
          <BrandMark size={34} />
          CargoPulse
        </p>
        <div className="login-hero">
          <ShimmerLines
            delay={550}
            text={t("A clear path.\nAn accountable decision.", "明確路徑。\n可追溯決策。")}
          />
          <p>
            {t(
              "Review feasible cargo recovery proposals, inspect the evidence and record a human decision.",
              "檢視可行的貨運復原建議、核對證據，並記錄由人員作出的決策。",
            )}
          </p>
          <div className="login-boundary">
            <span>SYNTHETIC / NOT CONNECTED</span>
            <p>
              {t(
                "No airline connection. No physical dispatch or external write-back.",
                "未連接航空公司系統。不會執行實體調度或外部寫入。",
              )}
            </p>
          </div>
        </div>
      </div>
      <section className="login-form">
        <span className="login-card-edge" aria-hidden="true" />
        <div className="login-tools">
          <FxControls />
          <LocaleSwitch />
        </div>
        <h2>{t("Sign in to CargoPulse", "登入 CargoPulse")}</h2>
        {development ? (
          <>
            <p>
              {t(
                "Pick a role to explore the workspace with synthetic data.",
                "選擇角色，以合成資料體驗工作區。",
              )}
            </p>
            <form onSubmit={signin} className="dev-login">
              <span className="badge">{t("Development only", "僅供開發")}</span>
              <h3>{t("Synthetic evaluation identity", "合成資料評估身分")}</h3>
              <label>
                {t("Evaluation role", "評估角色")}
                <select
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                >
                  <option value="controller">Controller</option>
                  <option value="steward">Data steward</option>
                  <option value="manager">Manager · author</option>
                  <option value="manager-reviewer">
                    Manager · independent reviewer
                  </option>
                  <option value="auditor">Auditor</option>
                  <option value="controller-b">
                    Controller B · second tenant
                  </option>
                </select>
              </label>
              <button className="button primary wide login-enter" disabled={busy}>
                {busy
                  ? t("Verifying…", "正在驗證……")
                  : t("Enter evaluation workspace", "進入評估工作區")}
                {busy ? null : <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />}
              </button>
              <p>
                {t(
                  "Fixed local identities; this does not verify a production SSO login. Switch to Data steward for imports and Controller for solving.",
                  "固定本機身分；這並非正式 SSO 登入驗證。匯入資料時選擇 Data steward，求解時選擇 Controller。",
                )}
              </p>
            </form>
            <ErrorNotice error={error} />
            <p className="login-or">
              <span>{t("or", "或")}</span>
            </p>
            {sso}
            <p className="fine">
              {t(
                "Use your provisioned organisation account. Your tenant and permissions are verified by the service.",
                "請使用已配置的機構帳戶。服務將驗證您的租戶及權限。",
              )}
            </p>
          </>
        ) : (
          <>
            <p>
              {t(
                "Use your provisioned organisation account. Your tenant and permissions are verified by the service.",
                "請使用已配置的機構帳戶。服務將驗證您的租戶及權限。",
              )}
            </p>
            {sso}
            <ErrorNotice error={error} />
          </>
        )}
        <p className="fine login-assurance">
          <ShieldCheck size={16} strokeWidth={1.5} aria-hidden="true" />
          {t(
            "Access is tenant scoped. In-app approval never authorises airline operations.",
            "存取按租戶範圍限制。應用程式內的核准不會授權航空公司作業。",
          )}
        </p>
        <p className="fine legal-links">
          <Link href="/privacy">{t("Privacy & data handling", "私隱及資料處理")}</Link>
          <span aria-hidden="true"> · </span>
          <Link href="/terms">{t("Terms of evaluation", "評估使用條款")}</Link>
        </p>
      </section>
      <p className="login-chart-note">
        {t(
          "Globe centred on Hong Kong (HKG). Decorative: no routes or flights are shown before sign-in. Drag to turn it.",
          "地球以香港（HKG）為中心，僅作裝飾：登入前不顯示任何航線或航班。可拖動旋轉。",
        )}
      </p>
    </main>
  );
}
