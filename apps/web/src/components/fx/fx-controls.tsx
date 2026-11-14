"use client";
import { Gauge, Moon, Sun, Volume2, VolumeX, Zap } from "lucide-react";
import { useFx } from "@/lib/fx";
import { playChime } from "@/lib/sound";
import { useLocale } from "@/components/locale";

/** Day/night, sound and effect-level toggles for the top bar and the sign-in page. */
export function FxControls() {
  const { t } = useLocale();
  const { theme, setTheme, sound, setSound, level, setLevel, motion } = useFx();
  const night = theme === "night";
  return (
    <div className="fx-controls" role="group" aria-label={t("Display", "顯示")}>
      <button
        type="button"
        className="fx-toggle"
        aria-pressed={night}
        title={night ? t("Switch to day", "切換至日間") : t("Switch to night", "切換至夜間")}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setTheme(night ? "day" : "night", { x: box.left + box.width / 2, y: box.top + box.height / 2 });
        }}
      >
        {night ? <Moon size={17} strokeWidth={1.6} aria-hidden="true" /> : <Sun size={17} strokeWidth={1.6} aria-hidden="true" />}
        <span className="sr-only">{t("Night theme", "夜間主題")}</span>
      </button>
      <button
        type="button"
        className="fx-toggle"
        aria-pressed={sound}
        title={sound ? t("Sound on", "聲音已開啟") : t("Sound off", "聲音已關閉")}
        onClick={() => {
          setSound(!sound);
          if (!sound) {
            document.documentElement.dataset.sound = "on";
            playChime();
          }
        }}
      >
        {sound ? <Volume2 size={17} strokeWidth={1.6} aria-hidden="true" /> : <VolumeX size={17} strokeWidth={1.6} aria-hidden="true" />}
        <span className="sr-only">{t("Interface sounds", "介面聲音")}</span>
      </button>
      <button
        type="button"
        className="fx-toggle"
        aria-pressed={level === "lite"}
        disabled={motion === "calm"}
        title={
          motion === "calm"
            ? t("Your system asks for reduced motion", "系統已要求減少動態效果")
            : level === "full"
              ? t("Full effects. Click for performance mode", "完整效果。按此切換至效能模式")
              : t("Performance mode. Click for full effects", "效能模式。按此切換至完整效果")
        }
        onClick={() => setLevel(level === "full" ? "lite" : "full")}
      >
        {level === "full" ? <Zap size={17} strokeWidth={1.6} aria-hidden="true" /> : <Gauge size={17} strokeWidth={1.6} aria-hidden="true" />}
        <span className="sr-only">{t("Performance mode", "效能模式")}</span>
      </button>
    </div>
  );
}
