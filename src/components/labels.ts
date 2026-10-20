/**
 * UI-only label dictionaries. Domain labels that already live in
 * src/shared/constants.ts are re-used from there; this file only adds the
 * presentational wording that the simulation core does not need.
 */
import { BUILDING_TYPE_META } from "../shared/constants";
import type {
  ActionPhase,
  ActionSource,
  Building,
  BuildingType,
  GameEventType,
  Goal,
  Memory,
  MemoryKind,
  Resident,
  WeatherCondition,
} from "../shared/types";
import type { Tone } from "./ui";

export const ACTION_SOURCE_LABELS: Record<ActionSource, string> = {
  local: "本地决策",
  ai: "AI 建议",
  player: "造物主",
  schedule: "日程",
};

export const ACTION_PHASE_LABELS: Record<ActionPhase, string> = {
  deciding: "决策中",
  moving: "移动中",
  acting: "执行中",
  blocked: "受阻",
};

export const GOAL_KIND_LABELS: Record<Goal["kind"], string> = {
  long: "长期",
  short: "短期",
};

export const GOAL_STATUS_LABELS: Record<Goal["status"], string> = {
  active: "进行中",
  completed: "已完成",
  blocked: "受阻",
  abandoned: "已放弃",
};

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  action: "行动",
  social: "社交",
  observation: "观察",
  trauma: "创伤",
  promise: "承诺",
  gift: "馈赠",
  conflict: "冲突",
  romance: "情感",
  betrayal: "背叛",
  told: "听说",
  life: "人生",
  player: "造物主",
  system: "系统",
};

export const MEMORY_SOURCE_LABELS: Record<Memory["source"], string> = {
  experienced: "亲历",
  told: "听说",
  inferred: "推断",
  player: "造物主",
  ai: "AI",
};

export const EVENT_TYPE_LABELS: Record<GameEventType, string> = {
  system: "系统",
  info: "信息",
  social: "社交",
  economy: "经济",
  warn: "警告",
  danger: "危险",
  ai: "AI",
  player: "造物主",
  faction: "势力",
  lifecycle: "生命周期",
};

export const EVENT_SOURCE_LABELS: Record<string, string> = {
  system: "系统",
  local: "本地",
  ai: "AI",
  player: "造物主",
  event: "世界事件",
  faction: "势力",
  world: "世界",
};

export function eventTypeTone(type: GameEventType): Tone {
  switch (type) {
    case "danger":
      return "bad";
    case "warn":
      return "warn";
    case "ai":
      return "magenta";
    case "player":
      return "gold";
    case "faction":
      return "purple";
    case "social":
      return "cyan";
    case "economy":
      return "blue";
    case "lifecycle":
      return "good";
    default:
      return "neutral";
  }
}

export const FACTION_KIND_LABELS: Record<string, string> = {
  corporation: "企业",
  community: "社区",
  underground: "地下网络",
};

export const FACTION_STRATEGY_LABELS: Record<string, string> = {
  expand: "扩张",
  consolidate: "巩固",
  undermine: "渗透",
  mutual_aid: "互助",
};

export const LIFE_EVENT_KIND_LABELS: Record<string, string> = {
  birth: "出生",
  work: "工作",
  romance: "情感",
  betrayal: "背叛",
  help: "援助",
  conflict: "冲突",
  illness: "疾病",
  death: "死亡",
  milestone: "里程碑",
  player: "造物主",
};

export const GENDER_LABELS: Record<Resident["pronouns"], string> = {
  她: "女性",
  他: "男性",
  TA: "未标注",
};

export const PRONOUN_OPTIONS: Array<{ value: Resident["pronouns"]; label: string }> = [
  { value: "她", label: "她" },
  { value: "他", label: "他" },
  { value: "TA", label: "TA" },
];

export function ageGroupLabel(age: number): string {
  if (!Number.isFinite(age)) return "未知";
  if (age < 18) return "少年";
  if (age < 30) return "青年";
  if (age < 45) return "壮年";
  if (age < 60) return "中年";
  return "老年";
}

export function buildingTypeLabel(type: BuildingType): string {
  return BUILDING_TYPE_META[type].label;
}

export function buildingName(buildings: Building[], id: string | null | undefined): string {
  if (!id) return "—";
  return buildings.find((building) => building.id === id)?.name ?? id;
}

export function residentName(residents: Resident[], id: string | null | undefined): string {
  if (!id) return "—";
  return residents.find((resident) => resident.id === id)?.name ?? id;
}

export function weatherName(condition: WeatherCondition): string {
  return {
    clear: "晴朗",
    rain: "降雨",
    acid_rain: "酸雨",
    smog: "雾霾",
    heatwave: "热浪",
    storm: "电磁风暴",
  }[condition];
}

export const CONSOLE_TAB_LABELS = {
  overview: "总览",
  events: "事件注入",
  rules: "世界规则",
  residents: "居民编辑",
  buildings: "建筑编辑",
  logs: "日志",
  saves: "存档",
  experiments: "实验",
} as const;

export const LOG_FILTERS = [
  { id: "all", label: "全部" },
  { id: "social", label: "社交" },
  { id: "economy", label: "经济" },
  { id: "faction", label: "势力" },
  { id: "ai", label: "AI" },
  { id: "danger", label: "危险" },
  { id: "player", label: "造物主" },
  { id: "system", label: "系统" },
] as const;

export type LogFilterId = (typeof LOG_FILTERS)[number]["id"];
