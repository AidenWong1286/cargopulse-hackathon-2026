import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import "@fontsource-variable/noto-sans-tc/wght.css";
import "@fontsource/noto-serif-tc/500.css";
import { LivingBackdrop } from "@/components/chart/living-backdrop";
import { LocaleProvider } from "@/components/locale";
import { FxProvider, type FxPrefs } from "@/lib/fx";
import { hanken, instrumentSerif } from "./fonts";
import "./globals.css";
import "./styles/layout-pass.css";
import "./styles/chart.css";
import "./styles/desk.css";
import "./styles/proof.css";
import "./styles/fx.css";
import "./styles/wow-login.css";
import "./styles/wow-solve.css";
import "./styles/wow-receipt.css";
import "./styles/wow-protect.css";
import "./styles/wow-tour.css";
export const metadata: Metadata = {
  title: {
    default: "CargoPulse | Recovery operations",
    template: "%s | CargoPulse",
  },
  description:
    "Synthetic air cargo recovery decision workspace. Not connected to airline systems.",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await headers();
  const jar = await cookies();
  const locale = jar.get("cp_locale")?.value === "zh-Hant" ? "zh-Hant" : "en";
  const fx: FxPrefs = {
    theme: jar.get("cp_theme")?.value === "night" ? "night" : "day",
    level: jar.get("cp_fx")?.value === "lite" ? "lite" : "full",
    sound: jar.get("cp_sound")?.value === "on",
  };
  return (
    <html
      lang={locale}
      className={`${hanken.variable} ${instrumentSerif.variable}`}
      data-theme={fx.theme}
      data-fx={fx.level}
      data-sound={fx.sound ? "on" : "off"}
    >
      <body>
        <FxProvider initial={fx}>
          <LivingBackdrop />
          <LocaleProvider initial={locale}>{children}</LocaleProvider>
        </FxProvider>
      </body>
    </html>
  );
}
