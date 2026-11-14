/**
 * Plain words for the codes the service returns. Screens show the phrase and keep
 * the original code in a `title` tooltip, so nothing is lost for an auditor.
 */
export type Translate = (english: string, traditionalChinese: string) => string;

const WORDS: Record<string, [string, string]> = {
  // Filter
  ALL: ["All states", "所有狀態"],

  // Scenario and plan states
  NEEDS_VERIFICATION: ["Needs checking", "需要核實"],
  READY: ["Ready", "已就緒"],
  SOLVING: ["Working out a plan", "正在計算方案"],
  PLAN_READY: ["Plan ready", "方案已就緒"],
  NO_FEASIBLE_PLAN: ["No workable plan", "沒有可行方案"],
  SOLVER_ERROR: ["Planning failed", "計算失敗"],
  IN_REVIEW: ["In review", "審核中"],
  PROPOSED: ["Awaiting decision", "等待決策"],
  APPROVED: ["Approved", "已核准"],
  REJECTED: ["Rejected", "已拒絕"],
  ESCALATED: ["Escalated", "已上報"],
  STALE: ["Data expired", "資料已過期"],
  CLOSED: ["Closed", "已結束"],
  SUPERSEDED: ["Replaced by a newer version", "已被新版本取代"],
  DRAFT: ["Draft", "草稿"],
  PUBLISHED: ["Published", "已發布"],
  REVIEW_REQUIRED: ["Needs a person", "需要人員處理"],

  // Jobs and imports
  QUEUED: ["Queued", "排隊中"],
  RUNNING: ["Running", "執行中"],
  COMPLETED: ["Finished", "已完成"],
  FAILED: ["Failed", "失敗"],
  CANCELLED: ["Cancelled", "已取消"],
  QUARANTINED: ["Held back for checking", "已隔離待查"],
  VALIDATION_FAILED: ["Data check failed", "資料檢查未通過"],

  // Gate results
  PASS: ["Passed", "通過"],
  PASSED: ["Passed", "通過"],
  FAIL: ["Failed", "未通過"],
  UNKNOWN: ["Unknown", "未知"],
  VERIFIED: ["Confirmed", "已確認"],

  // Solver outcomes
  OPTIMAL: ["Best possible plan found", "已找到最佳方案"],
  FEASIBLE: ["Workable plan found", "已找到可行方案"],
  INFEASIBLE: ["No plan satisfies every rule", "沒有方案能符合所有規則"],
  TIME_LIMIT_WITH_FEASIBLE: ["Good plan found within the time limit", "在時限內找到良好方案"],
  TIME_LIMIT_NO_FEASIBLE: ["No plan found within the time limit", "在時限內未找到方案"],
  TIME_LIMIT: ["Time limit reached", "已達時限"],
  ERROR: ["Error", "錯誤"],
  SOLVER_UNAVAILABLE: ["The planner is unavailable", "計算服務無法使用"],
  SOLVER_INTERRUPTED: ["Planning was interrupted", "計算已中斷"],

  // Reasons a plan cannot be approved
  STALE_SNAPSHOT: ["The scenario data has expired", "情境資料已過期"],
  SNAPSHOT_STALE: ["The scenario data has expired", "情境資料已過期"],
  STALE_SOURCE: ["The source data has expired", "來源資料已過期"],
  SOURCE_STALE: ["The source data has expired", "來源資料已過期"],
  STALE_PLAN: ["The plan is out of date", "方案已過時"],
  SNAPSHOT_NOT_CURRENT: ["A newer version of this scenario exists", "此情境已有較新版本"],
  CURRENT_VALIDATION_FAILED: ["The plan no longer passes today's checks", "方案未能通過目前的檢查"],
  EVIDENCE_REVALIDATION_FAILED: ["The supporting checks have expired", "佐證檢查已過期"],
  EVIDENCE_NOT_VALID: ["The supporting checks are no longer valid", "佐證檢查已失效"],
  INDEPENDENT_VALIDATION_FAILED: ["The independent check did not pass", "獨立驗證未通過"],
  PLAN_NOT_PROPOSED: ["The plan is not awaiting a decision", "方案並非等待決策狀態"],
  POLICY_NOT_PUBLISHED: ["The policy has not been published", "政策尚未發布"],
  FOUR_EYES_REQUIRED: ["A second person must approve", "需要第二位人員核准"],
  VERSION_CONFLICT: ["The record changed while you were looking at it", "紀錄在檢視期間已變更"],
  SCENARIO_NOT_READY: ["The scenario is not ready", "情境尚未就緒"],
  HASH_MISMATCH: ["The fingerprints do not match", "指紋不相符"],

  // Reasons a flight was ruled out
  CUSTOMS_NOT_VERIFIED: ["Customs clearance not confirmed", "清關未獲確認"],
  SECURITY_NOT_VERIFIED: ["Security screening not confirmed", "保安檢查未獲確認"],
  ULD_SERVICEABILITY_NOT_VERIFIED: ["Container condition not confirmed", "貨櫃狀況未獲確認"],
  LOAD_CONTROL_NOT_VERIFIED: ["Load control not confirmed", "載重控制未獲確認"],
  FLIGHT_CAPACITY_NOT_VERIFIED: ["Space on the flight not confirmed", "航班艙位未獲確認"],
  HANDLING_WINDOW_NOT_VERIFIED_OR_UNAVAILABLE: ["No confirmed ground-handling slot", "沒有已確認的地勤處理時段"],
  UNVERIFIED_GATE: ["A required check is not confirmed", "有必要檢查未獲確認"],
  UNVERIFIED_EVIDENCE: ["Supporting data not confirmed", "佐證資料未獲確認"],
  SHARED_RESOURCE_TRADEOFF: ["Space went to cargo that loses more by waiting", "艙位已分配給等待損失更大的貨物"],
  GLOBAL_RESOURCE_ALLOCATION: ["Space was shared out across all cargo", "艙位已在所有貨物之間分配"],
  NO_COMPLIANT_PATH: ["No flight left", "已無可用航班"],
  COMPLIANT_PATH: ["A flight is available", "有可用航班"],
  NO_VALID_ROUTE: ["No usable route", "沒有可用路線"],
  MISSED_HANDLING_OR_CUTOFF: ["Too late for the cutoff", "已錯過截止時間"],
  MISSING_CONNECTION: ["No connecting flight", "沒有接駁航班"],
  ROUTE_PERMISSION_MISSING: ["Not permitted on this route", "此路線未獲許可"],
  FLIGHT_NOT_AVAILABLE: ["Flight not available", "航班不可用"],
  FLIGHT_MASS_EXCEEDED: ["Too heavy for the flight", "超出航班載重"],
  FLIGHT_VOLUME_EXCEEDED: ["Too large for the flight", "超出航班容積"],
  FLIGHT_CAPACITY_INSUFFICIENT_OR_UNKNOWN: ["Not enough confirmed space on the flight", "航班沒有足夠的已確認艙位"],
  PAYLOAD_MASS_EXCEEDED: ["Too heavy for the aircraft", "超出飛機載重"],
  HOLD_VOLUME_EXCEEDED: ["The hold is full", "貨艙已滿"],
  POSITION_MASS_EXCEEDED: ["Too heavy for the loading position", "超出裝載位置載重"],
  POSITION_VOLUME_EXCEEDED: ["Too large for the loading position", "超出裝載位置容積"],
  POSITION_SLOTS_EXCEEDED: ["No loading position left", "已無裝載位置"],
  POSITION_CAPACITY_INSUFFICIENT_OR_UNKNOWN: ["Not enough confirmed loading positions", "沒有足夠的已確認裝載位置"],
  HANDLING_CAPACITY_EXCEEDED: ["Ground handling is full", "地勤處理量已滿"],
  ULD_CONTOUR_INCOMPATIBLE: ["Container shape does not fit the aircraft", "貨櫃外形與飛機不符"],
  ULD_CONTOUR_UNKNOWN: ["Container shape unknown", "貨櫃外形未知"],
  ULD_POSITION_ENVELOPE_INCOMPATIBLE: ["Container does not fit the loading position", "貨櫃與裝載位置不符"],
  DG_AIRCRAFT_INCOMPATIBLE: ["Dangerous goods not allowed on this aircraft", "此飛機不可運載危險品"],
  FREIGHTER_ONLY: ["Freighter aircraft only", "只限貨機"],
  FROZEN_PATH_REQUIRED: ["Must stay on its confirmed flight", "必須保留已確認航班"],
  PATH_LEG_LIMIT: ["Too many connections", "轉運次數過多"],
  WHOLE_ULD_ATOMIC: ["A container cannot be split", "貨櫃不可拆分"],
  GUARANTEED_SHIPMENT_OFFLOADED: ["A guaranteed shipment would be left behind", "有保證貨件會被卸下"],

  // Cargo types
  GENERAL: ["General cargo", "一般貨物"],
  PRIORITY: ["Priority", "優先貨物"],
  PHARMA: ["Medicines", "藥品"],
  PERISHABLE: ["Fresh goods", "鮮活貨物"],
  DG: ["Dangerous goods", "危險品"],
  NONE: ["None", "無"],
  DECLARED: ["Declared dangerous goods", "已申報危險品"],

  // Flights
  SCHEDULED: ["Scheduled", "按計劃"],

  // Data source
  TEAM_SYNTHETIC_UNVERIFIED: ["Made-up demo data", "虛構示範資料"],
  ORGANISER_SNAPSHOT: ["Organiser sample data", "主辦方樣本資料"],
  PUBLIC_VERIFIED: ["Public, checked data", "已核實公開資料"],
  LIVE_AUTHORISED: ["Live, authorised data", "已授權即時資料"],
  SYNTHETIC_ONLY: ["Demo data only", "只限示範資料"],

  // Policies
  EARLIEST_FEASIBLE: ["Earliest flight first", "最早航班優先"],
  PRIORITY_FIRST: ["Priority cargo first", "優先貨物先行"],
  GREEDY_REFERENCE: ["Simple-rule comparison", "簡單規則對照"],
  APPROVE_IN_APP: ["Approve in CargoPulse", "在 CargoPulse 內核准"],
};

const ACRONYMS = new Set(["ULD", "AWB", "CSV", "JSON", "API", "UTC", "HKT", "SSO", "OIDC", "ID", "PDF", "DG", "MFA"]);

/** "FOO_BAR" → "Foo bar". Text that is not a code is returned as written. */
function sentence(code: string): string {
  const spaced = code.replaceAll("_", " ").trim();
  if (!/^[A-Z0-9 ]+$/.test(spaced)) return spaced;
  return spaced
    .split(" ")
    .map((word, index) =>
      ACRONYMS.has(word) || word.length === 1
        ? word
        : index === 0
          ? word[0] + word.slice(1).toLowerCase()
          : word.toLowerCase(),
    )
    .join(" ");
}

/** The plain-language phrase for a service code, in the reader's language. */
export function plain(code: string | null | undefined, t: Translate): string {
  if (!code) return "—";
  const words = WORDS[code];
  return words ? t(words[0], words[1]) : sentence(code);
}

/** Rounds a decimal string for display: "2.000000" → "2". Missing values show as "—". */
export function num(value: string | number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return String(Number(n.toFixed(digits)));
}

/** True when the only thing stopping an approval is that the data has expired. */
export function onlyExpired(blockers: readonly string[] | null | undefined): boolean {
  if (!blockers?.length) return false;
  return (
    blockers.some((b) => /STALE|NOT_CURRENT/.test(b)) &&
    blockers.every((b) => /STALE|CURRENT_VALIDATION_FAILED|NOT_CURRENT/.test(b))
  );
}
