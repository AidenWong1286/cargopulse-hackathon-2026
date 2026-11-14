/**
 * Recovery desk building blocks. `DeskProvider` shares the focus scenario and
 * the decision delay; `DeskHero` and `ScenarioList` read them, so the chart,
 * the departure board and the list always move together.
 */
export { DeskProvider, useDesk } from "./context";
export { DeskHero } from "./hero";
export { ScenarioList } from "./scenario-list";
