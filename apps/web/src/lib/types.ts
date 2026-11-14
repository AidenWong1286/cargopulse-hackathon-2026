import type { components } from "../../../../packages/contracts/generated/api";
export type Model<K extends keyof components["schemas"]> =
  components["schemas"][K];
export type Principal = Model<"Principal">;
export type Scenario = Model<"ScenarioRecord">;
export type Plan = Model<"PlanRecord">;
export type Snapshot = Model<"ScenarioSnapshot">;
export type Job = Model<"JobRecord">;
export type RecoverProof = Model<"RecoverProof">;
export type ProtectBatch = Model<"ProtectBatch">;
export type ProtectCalibration = Model<"ProtectCalibration">;
