"use client";
import { useEffect, useState } from "react";
import { CsvImport } from "./csv-import";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Model, Snapshot, Principal } from "@/lib/types";
import { plain } from "@/lib/plain";
import { useLocale } from "./locale";
import { DeskProvider, DeskHero, ScenarioList } from "./desk";
import { StartDemo } from "./start-demo";
import {
  Badge,
  ErrorNotice,
  Hash,
  JsonDetails,
  Loading,
  PageHeader,
  Section,
  useResource,
} from "./ui";
const STATES = [
  "ALL",
  "NEEDS_VERIFICATION",
  "READY",
  "SOLVING",
  "PLAN_READY",
  "NO_FEASIBLE_PLAN",
  "SOLVER_ERROR",
  "APPROVED",
  "REJECTED",
  "ESCALATED",
  "STALE",
];
export function Operations() {
  const { t } = useLocale();
  const router = useRouter();
  const [cursor, setCursor] = useState<string | null>(null);
  const records = useResource<Model<"ScenarioPage">>(
    `/events?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  const me = useResource<Principal>("/me");
  const [filter, setFilter] = useState("");
  const [state, setState] = useState("ALL");
  const [input, setInput] = useState("");
  const [source, setSource] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  useEffect(() => {
    const sourceId = new URLSearchParams(location.search).get("source");
    if (sourceId === null) return;
    // Arriving with a committed source means the manual flow is in progress.
    setManualOpen(true);
    if (/^[a-fA-F0-9-]{36}$/.test(sourceId)) setSource(sourceId);
  }, []);
  const [title, setTitle] = useState("");
  const [validated, setValidated] = useState<Model<"ImportRecord">>();
  const [receipt, setReceipt] = useState<Model<"SnapshotReceipt">>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState("");
  const steward = me.data?.roles.some((r) =>
    ["manager", "data_steward"].includes(r),
  );
  const controller = me.data?.roles.some((r) =>
    ["manager", "controller"].includes(r),
  );
  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }
  async function loadFixture() {
    await run("fixture", async () => {
      const data = await api<Snapshot>("/fixtures/recover");
      setInput(JSON.stringify(data, null, 2));
      setValidated(undefined);
      setReceipt(undefined);
    });
  }
  async function validate() {
    await run("validate", async () => {
      setReceipt(undefined);
      setValidated(undefined);
      const snapshot = JSON.parse(input) as Snapshot;
      const result = await api<Model<"ImportRecord">>("/imports/validate", {
        method: "POST",
        body: { snapshot } satisfies Model<"ImportRequest">,
      });
      setValidated(result);
    });
  }
  async function commit() {
    if (!validated) return;
    await run("commit", async () => {
      const result = await api<Model<"SnapshotReceipt">>(
        `/imports/${validated.id}/commit`,
        { method: "POST" },
      );
      setReceipt(result);
      setSource(result.snapshot_id);
      router.replace(`/operations?source=${result.snapshot_id}`, {
        scroll: false,
      });
    });
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    await run("create", async () => {
      const result = await api<Model<"ScenarioRecord">>("/scenarios", {
        method: "POST",
        body: {
          source_snapshot_id: source,
          title: title || null,
          allow_external_write: false,
        } satisfies Model<"CreateScenario">,
      });
      router.push(`/operations/${result.id}`);
    });
  }
  const items = records.data?.items.filter(
    (s) =>
      (state === "ALL" || s.state === state) &&
      `${s.snapshot.title} ${s.id} ${s.snapshot.event_id}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  return (
    <DeskProvider scenarios={records.data?.items} loading={records.loading}>
      <PageHeader
        title={t("Recovery desk", "復原作業台")}
        description={t(
          "When flights are cancelled, CargoPulse proposes where each container should go. A person decides.",
          "航班取消時，CargoPulse 會建議每個貨櫃的去向，並由人員作出決定。",
        )}
        action={
          <button onClick={records.reload} className="button">
            {t("Refresh queue", "重新整理佇列")}
          </button>
        }
      />
      <DeskHero />
      <StartDemo me={me.data} />
      <ErrorNotice error={records.error} />
      <Section
        className="rise rise-2"
        title={t("Scenarios", "情境")}
        aside={
          <span className="muted">
            {t("Newest 50 · times in UTC", "最新 50 筆 · 時間為 UTC")}
          </span>
        }
      >
        <div className="toolbar slim">
          <label>
            {t("Search loaded incidents", "搜尋已載入事件")}
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("Type part of a scenario name", "輸入情境名稱的一部分")}
            />
          </label>
          <label>
            {t("State", "狀態")}
            <select value={state} onChange={(e) => setState(e.target.value)}>
              {STATES.map((s) => (
                <option key={s} value={s} title={s}>
                  {plain(s, t)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {records.loading ? <Loading /> : <ScenarioList items={items ?? []} />}
      </Section>
      <div className="actions queue-pages">
        <button
          className="button"
          disabled={!cursor}
          onClick={() => setCursor(null)}
        >
          {t("First page", "第一頁")}
        </button>
        <button
          className="button"
          disabled={!records.data?.next_cursor}
          onClick={() => setCursor(records.data?.next_cursor || null)}
        >
          {t("Next page", "下一頁")} →
        </button>
      </div>
      <details
        className="manual"
        open={manualOpen}
        onToggle={(e) => setManualOpen(e.currentTarget.open)}
      >
        <summary>
          {t("Import your own data (manual steps)", "匯入自己的資料（手動步驟）")}
        </summary>
      <div className="two-col">
        <Section
          title={t("Step 1: check and save the data", "步驟 1：檢查並儲存資料")}
        >
          <p>
            {t(
              "Data stewards can load the service fixture or paste a bounded ScenarioSnapshot JSON. Validation does not commit input.",
              "資料管理員可載入服務提供的測試資料，或貼上大小受限的 ScenarioSnapshot JSON。驗證不會提交資料。",
            )}
          </p>
          {!steward ? (
            <div className="notice">
              {t(
                "Data steward or Manager role required to import. A controller can create a scenario from a committed source ID.",
                "匯入需要 Data steward 或 Manager 角色。Controller 可使用已提交的來源 ID 建立情境。",
              )}
            </div>
          ) : null}
          <button className="button" onClick={loadFixture} disabled={!!busy}>
            {t("Load synthetic fixture", "載入合成測試資料")}
          </button>
          <label>
            {t("Source snapshot JSON", "來源快照 JSON")}
            <textarea
              className="json-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setValidated(undefined);
                setReceipt(undefined);
              }}
              rows={9}
              maxLength={8000000}
              spellCheck={false}
            />
          </label>
          <div className="actions">
            <button
              className="button"
              onClick={validate}
              disabled={!steward || !input || !!busy}
            >
              {t("Validate input", "驗證輸入")}
            </button>
            <button
              className="button primary"
              onClick={commit}
              disabled={
                !steward || validated?.status !== "READY" || !!receipt || !!busy
              }
            >
              {t("Commit validated source", "提交已驗證來源")}
            </button>
          </div>
          <CsvImport
            enabled={!!steward && !busy}
            snapshotJson={input}
            onValidated={(result) => {
              setValidated(result);
              setReceipt(undefined);
            }}
          />
          {validated ? (
            <div className="import-result">
              <Badge value={validated.status} />
              <p>
                {t("Import reference", "匯入參考")}: <code>{validated.id}</code>
              </p>
              {validated.row_errors.map((r, i) => (
                <p key={i} className="danger-text">
                  {r}
                </p>
              ))}
              <JsonDetails
                value={validated.quality_issues}
                label={t("Validation findings", "驗證結果")}
              />
            </div>
          ) : null}
          {receipt ? (
            <div role="status" className="notice success">
              <strong>{t("Source committed", "來源已提交")}</strong>
              <p>
                {t(
                  "Use this source ID when creating a scenario.",
                  "建立情境時使用此來源 ID。",
                )}
              </p>
              <Hash value={receipt.snapshot_id} />
              <Hash value={receipt.snapshot_hash} />
            </div>
          ) : null}
        </Section>
        <Section
          title={t("Step 2: create the scenario", "步驟 2：建立情境")}
        >
          <p>
            {t(
              "A scenario locks the committed source and its published policy. It cannot enable external writes.",
              "情境會鎖定已提交的來源及其已發布政策。不會啟用外部寫入。",
            )}
          </p>
          <form onSubmit={create}>
            <label>
              {t("Committed source ID", "已提交來源 ID")}
              <input
                required
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="UUID"
                pattern="[a-fA-F0-9\-]{36}"
              />
            </label>
            <label>
              {t("Scenario title (optional)", "情境標題（選填）")}
              <input
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <button
              className="button primary"
              disabled={!controller || !source || !!busy}
            >
              {t("Create scenario", "建立情境")} →
            </button>
            {!controller ? (
              <p className="fine">
                {t(
                  "Controller or Manager role required.",
                  "需要 Controller 或 Manager 角色。",
                )}
              </p>
            ) : null}
          </form>
        </Section>
      </div>
      {busy ? (
        <p role="status">
          {t("Processing", "正在處理")} · {busy}
        </p>
      ) : null}
      <ErrorNotice error={error} />
      </details>
    </DeskProvider>
  );
}
