/**
 * NEON//ECOLOGY shared domain model.
 *
 * These types are the contract between the deterministic simulation engine,
 * the Express/DeepSeek advisor and the React/Three.js presentation layer.
 * The AI must never write to this model directly: it only returns a proposal
 * that the engine validates and executes.
 */

export type BuildingType =
  | "residential"
  | "shop"
  | "workplace"
  | "public"
  | "medical"
  | "utility";

export type BuildingRotation = 0 | 90 | 180 | 270;

export type WeatherCondition =
  | "clear"
  | "rain"
  | "acid_rain"
  | "smog"
  | "heatwave"
  | "storm";

export type SimSpeed = 1 | 2 | 4;

export type InteractionMode = "observe" | "intervene";

export type Selection =
  | { kind: "resident"; id: string }
  | { kind: "building"; id: string }
  | null;

export type ConsoleTab =
  | "overview"
  | "events"
  | "rules"
  | "residents"
  | "buildings"
  | "logs"
  | "saves"
  | "experiments";

/**
 * Actions that the local deliberation system can execute.
 * `move` is an internal engine phase, not a proposal action.
 */
export type ActionId =
  | "work"
  | "rest"
  | "eat"
  | "shop"
  | "go_home"
  | "wander"
  | "talk"
  | "befriend"
  | "seek_help"
  | "date"
  | "argue"
  | "reconcile"
  | "cooperate"
  | "conceal"
  | "betray"
  | "heal"
  | "study";

/** Actions an LLM advisor may propose. Kept deliberately small. */
export const AI_ACTIONS = [
  "work",
  "rest",
  "eat",
  "shop",
  "go_home",
  "wander",
  "talk",
  "befriend",
  "seek_help",
  "date",
  "argue",
  "reconcile",
  "cooperate",
  "conceal",
  "betray",
  "heal",
  "study",
] as const satisfies readonly ActionId[];

export type AiActionId = (typeof AI_ACTIONS)[number];

export type ActionSource = "local" | "ai" | "player" | "schedule";

export type ActionPhase = "deciding" | "moving" | "acting" | "blocked";

export type RelationshipType =
  | "stranger"
  | "acquaintance"
  | "friend"
  | "close_friend"
  | "partner"
  | "ex_partner"
  | "rival"
  | "enemy"
  | "family";

export interface Vec2 {
  x: number;
  z: number;
}

export interface SimClock {
  tick: number;
  /** 1-based simulation day. */
  day: number;
  /** Minutes since midnight, 0..1439. */
  minuteOfDay: number;
}

export interface Personality {
  /** 0..100 dimensions. */
  traits: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  };
  labels: string[];
  values: string[];
}

export interface Needs {
  /** 0 = fed, 100 = starving. */
  hunger: number;
  /** 0 = exhausted, 100 = fully rested. */
  energy: number;
  /** 0 = isolated, 100 = socially fulfilled. */
  social: number;
  /** 0 = terrified, 100 = secure. */
  safety: number;
}

export interface Goal {
  id: string;
  kind: "long" | "short";
  title: string;
  description: string;
  priority: number;
  progress: number;
  status: "active" | "completed" | "blocked" | "abandoned";
  createdDay: number;
  deadlineDay?: number;
  source: "personality" | "need" | "event" | "player" | "ai" | "relationship";
  relatedResidentId?: string;
  relatedBuildingId?: string;
}

export type MemoryKind =
  | "action"
  | "social"
  | "observation"
  | "trauma"
  | "promise"
  | "gift"
  | "conflict"
  | "romance"
  | "betrayal"
  | "told"
  | "life"
  | "player"
  | "system";

export type MemorySource = "experienced" | "told" | "inferred" | "player" | "ai";

export interface Memory {
  id: string;
  tick: number;
  day: number;
  minuteOfDay: number;
  kind: MemoryKind;
  text: string;
  subjectIds: string[];
  importance: number;
  valence: number;
  source: MemorySource;
  reliability: number;
  recalledAtTick: number;
}

export interface Impression {
  summary: string;
  perceivedTraits: string[];
  reliability: number;
  updatedDay: number;
}

export interface Relationship {
  residentId: string;
  familiarity: number;
  affinity: number;
  trust: number;
  intimacy: number;
  attraction: number;
  hostility: number;
  type: RelationshipType;
  sinceDay: number;
  lastInteractionDay: number;
  interactions: number;
  notes: string[];
}

export interface Secret {
  id: string;
  text: string;
  knownBy: string[];
  importance: number;
  subjectId?: string;
}

export interface PromiseRecord {
  id: string;
  withId: string;
  text: string;
  madeDay: number;
  dueDay: number;
  status: "pending" | "kept" | "broken";
  importance: number;
}

export interface LifeEvent {
  id: string;
  tick: number;
  day: number;
  title: string;
  description: string;
  kind:
    | "birth"
    | "work"
    | "romance"
    | "betrayal"
    | "help"
    | "conflict"
    | "illness"
    | "death"
    | "milestone"
    | "player";
}

export interface ActionHistoryEntry {
  tick: number;
  day: number;
  action: ActionId;
  label: string;
  reason: string;
  source: ActionSource;
  outcome: string;
  targetId?: string;
}

export interface CurrentAction {
  id: string;
  action: ActionId;
  label: string;
  phase: ActionPhase;
  source: ActionSource;
  reason: string;
  startedTick: number;
  endsTick: number;
  targetId?: string;
  targetKind?: "resident" | "building" | "location";
  /** Building the resident is moving to / acting in. */
  targetBuildingId?: string;
  targetResidentId?: string;
  /** Remaining waypoints. Empty when standing at destination. */
  path: Vec2[];
  pathIndex: number;
}

export interface AiHint {
  action: AiActionId;
  targetId?: string;
  targetKind?: "resident" | "building";
  reason: string;
  createdTick: number;
  expiresTick: number;
}

export interface ResidentAppearance {
  bodyColor: string;
  accentColor: string;
  skinColor: string;
  hairColor: string;
  heightScale: number;
  seed: number;
}

export interface Routine {
  wakeMinute: number;
  sleepMinute: number;
  workStartMinute: number;
  workEndMinute: number;
}

export interface Resident {
  id: string;
  name: string;
  age: number;
  pronouns: "她" | "他" | "TA";
  jobTitle: string;
  factionId: string;
  homeBuildingId: string;
  workBuildingId: string;
  workSkill: string;
  personality: Personality;
  backstory: string;
  skills: Record<string, number>;
  wealth: number;
  health: number;
  mood: number;
  stress: number;
  needs: Needs;
  reputation: number;
  position: Vec2;
  facing: number;
  insideBuildingId: string | null;
  currentAction: CurrentAction | null;
  aiHint: AiHint | null;
  relationships: Record<string, Relationship>;
  memories: {
    recent: Memory[];
    important: Memory[];
    longTerm: string[];
  };
  impressions: Record<string, Impression>;
  goals: Goal[];
  secrets: Secret[];
  promises: PromiseRecord[];
  history: ActionHistoryEntry[];
  lifeEvents: LifeEvent[];
  routine: Routine;
  appearance: ResidentAppearance;
  alive: boolean;
  diedDay?: number;
  deathCause?: string;
  paused: boolean;
  lastDecisionTick: number;
  createdAtTick: number;
}

export interface BuildingInventory {
  food: number;
  meds: number;
  energy: number;
  credits: number;
}

export interface RecentVisit {
  residentId: string;
  tick: number;
  day: number;
  kind: "enter" | "leave";
}

export interface Building {
  id: string;
  name: string;
  type: BuildingType;
  description: string;
  /** Top-left tile coordinate of the axis-aligned footprint. */
  x: number;
  z: number;
  w: number;
  d: number;
  rotation: BuildingRotation;
  capacity: number;
  ownerFactionId: string | null;
  ownerResidentId: string | null;
  /** 0..100. */
  condition: number;
  operational: boolean;
  open: boolean;
  inventory: BuildingInventory;
  recentVisits: RecentVisit[];
  neonColor: string;
  /** Parks / plazas are enterable but do not block the whole footprint. */
  openAir: boolean;
  emissions: number;
  lastServicedDay: number;
  income: number;
  expenses: number;
}

export interface FactionRelation {
  affinity: number;
  hostility: number;
  status: "neutral" | "cooperating" | "competing" | "hostile";
}

export interface Faction {
  id: string;
  name: string;
  kind: "corporation" | "community" | "underground";
  description: string;
  symbol: string;
  color: string;
  leaderId: string;
  memberIds: string[];
  funds: number;
  influence: number;
  resources: {
    food: number;
    energy: number;
    meds: number;
  };
  goals: string[];
  strategy: "expand" | "consolidate" | "undermine" | "mutual_aid";
  relations: Record<string, FactionRelation>;
  lastActionTick: number;
}

export type WeatherConditionId = WeatherCondition;

export interface Weather {
  condition: WeatherCondition;
  intensity: number;
  untilTick: number;
}

export interface WorldRules {
  wageMultiplier: number;
  priceMultiplier: number;
  foodConsumption: number;
  resourceRegen: number;
  pollutionDecay: number;
  taxRate: number;
  welfare: number;
  safetyBudget: number;
  lifespanModifier: number;
  socialVolatility: number;
  factionsActive: boolean;
  unrestSensitivity: number;
  aiAdvisorFrequencyTicks: number;
}

export interface WorldMetrics {
  stability: number;
  pollution: number;
  trust: number;
  inequality: number;
  resourceSupply: number;
  averageMood: number;
  averageWealth: number;
  population: number;
}

export interface CityReserves {
  credits: number;
  food: number;
  energy: number;
  meds: number;
}

export type GameEventType =
  | "system"
  | "info"
  | "social"
  | "economy"
  | "warn"
  | "danger"
  | "ai"
  | "player"
  | "faction"
  | "lifecycle";

export type GameEventSource = "system" | "local" | "ai" | "player" | "event" | "faction" | "world";

export interface GameEvent {
  id: string;
  tick: number;
  day: number;
  minuteOfDay: number;
  type: GameEventType;
  title: string;
  description: string;
  actorId?: string;
  targetIds?: string[];
  source: GameEventSource;
  importance: number;
  tag: string;
}

export interface WorldHistoryPoint {
  tick: number;
  day: number;
  minuteOfDay: number;
  metrics: WorldMetrics;
  reserves: CityReserves;
  population: number;
}

export interface WorldClockState {
  tick: number;
  day: number;
  minuteOfDay: number;
}

export interface WorldState {
  schemaVersion: number;
  worldId: string;
  name: string;
  seed: number;
  ruleVersion: number;
  rngState: number;
  clock: SimClock;
  weather: Weather;
  rules: WorldRules;
  reserves: CityReserves;
  metrics: WorldMetrics;
  buildings: Building[];
  residents: Resident[];
  factions: Faction[];
  events: GameEvent[];
  history: WorldHistoryPoint[];
  initialResidentIds: string[];
  createdAtIso: string;
  lastAiEventTick: number;
}

export interface SaveFile {
  schemaVersion: number;
  appVersion: string;
  savedAt: string;
  world: WorldState;
  label?: string;
}

export interface SnapshotRecord {
  id: string;
  name: string;
  savedAt: string;
  day: number;
  tick: number;
  ruleVersion: number;
  world: WorldState;
  note?: string;
  branchOf?: string;
}

export interface SnapshotSummary {
  id: string;
  name: string;
  savedAt: string;
  day: number;
  tick: number;
  population: number;
  metrics: WorldMetrics;
  ruleVersion: number;
  branchOf?: string;
}

export interface WorldComparison {
  a: SnapshotSummary;
  b: SnapshotSummary;
  metricDelta: {
    stability: number;
    pollution: number;
    trust: number;
    inequality: number;
    resourceSupply: number;
    averageMood: number;
    averageWealth: number;
    population: number;
  };
  biggestWealthShifts: Array<{ name: string; a: number; b: number; delta: number }>;
  relationshipChanges: Array<{ pair: string; a: string; b: string }>;
  eventCount: { a: number; b: number };
  conditions: {
    rulesA: WorldRules;
    rulesB: WorldRules;
    weatherA: WeatherCondition;
    weatherB: WeatherCondition;
    ruleVersionA: number;
    ruleVersionB: number;
  };
}

export interface AiRuntimeInfo {
  serviceAvailable: boolean;
  enabled: boolean;
  model: string | null;
  calls: number;
  failures: number;
  rejected: number;
  pending: boolean;
  lastError: string | null;
  lastLatencyMs: number | null;
  lastCallTick: number | null;
  hourlyLimit: number | null;
}

export interface ToastMessage {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
}

export interface PlacementDraft {
  type: BuildingType | null;
}

export interface CreateResidentInput {
  name: string;
  age: number;
  pronouns?: "她" | "他" | "TA";
  jobTitle: string;
  factionId: string;
  homeBuildingId: string;
  workBuildingId: string;
  workSkill?: string;
  wealth?: number;
  personalityLabels?: string[];
  longTermGoal?: string;
}

export interface PlaceBuildingInput {
  name?: string;
  type: BuildingType;
  x: number;
  z: number;
  w: number;
  d: number;
  capacity?: number;
  ownerFactionId?: string;
  neonColor?: string;
}
