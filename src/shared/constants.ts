import type {
  ActionId,
  AiActionId,
  BuildingType,
  RelationshipType,
  WeatherCondition,
  WorldRules,
} from "./types";
import { AI_ACTIONS } from "./types";

export const APP_VERSION = "2.0.0";
export const SCHEMA_VERSION = 2;
export const RULE_VERSION = 1;

export const TICK_MINUTES = 30;
export const TICKS_PER_DAY = 48;
export const MAP_WIDTH = 32;
export const MAP_DEPTH = 28;
export const TILE_SIZE = 2;
export const DAY_START_MINUTE = 8 * 60;

export const ROAD_COLUMNS = [
  [7, 8],
  [19, 20],
] as const;
export const ROAD_ROWS = [
  [6, 7],
  [14, 15],
  [22, 23],
] as const;

export const SAVE_STORAGE_KEY = "neon-ecology-save-v2";
export const SNAPSHOT_STORAGE_KEY = "neon-ecology-snapshots-v2";
export const PREFERENCES_KEY = "neon-ecology-prefs-v2";

export const ACTION_META: Record<
  ActionId,
  { label: string; description: string; social: boolean; indoor: boolean; duration: number }
> = {
  work: { label: "工作", description: "在工作场所完成任务并赚取信用点", social: false, indoor: true, duration: 3 },
  rest: { label: "休息", description: "恢复精力、缓解压力", social: false, indoor: true, duration: 3 },
  eat: { label: "进食", description: "补充食物，降低饥饿", social: false, indoor: true, duration: 1 },
  shop: { label: "购物", description: "在商店购买食物和药品", social: false, indoor: true, duration: 2 },
  go_home: { label: "回家", description: "返回住所休息或处理私事", social: false, indoor: true, duration: 2 },
  wander: { label: "闲逛", description: "在城市公共空间散步、观察", social: false, indoor: false, duration: 2 },
  talk: { label: "交谈", description: "与熟人交换近况、建立熟悉度", social: true, indoor: false, duration: 1 },
  befriend: { label: "结交", description: "主动拉近与某人的关系", social: true, indoor: false, duration: 2 },
  seek_help: { label: "求助", description: "向信任的人请求物资或帮助", social: true, indoor: false, duration: 1 },
  date: { label: "约会", description: "与互相吸引的人共度时间", social: true, indoor: false, duration: 3 },
  argue: { label: "争执", description: "表达不满，关系可能恶化", social: true, indoor: false, duration: 1 },
  reconcile: { label: "和解", description: "尝试修复破裂的关系", social: true, indoor: false, duration: 2 },
  cooperate: { label: "合作", description: "与目标共同完成一件对双方有利的事", social: true, indoor: false, duration: 2 },
  conceal: { label: "隐瞒", description: "隐藏秘密或真实意图", social: true, indoor: false, duration: 1 },
  betray: { label: "背叛", description: "为了利益出卖信任，造成严重关系后果", social: true, indoor: false, duration: 1 },
  heal: { label: "就医", description: "在医疗设施接受治疗", social: false, indoor: true, duration: 2 },
  study: { label: "学习", description: "提升技能与长期目标进度", social: false, indoor: true, duration: 3 },
};

export const AI_ACTION_SET: ReadonlySet<string> = new Set(AI_ACTIONS);

export const AI_ACTION_LABELS = Object.fromEntries(
  AI_ACTIONS.map((action) => [action, ACTION_META[action].label]),
) as Record<AiActionId, string>;

export const BUILDING_TYPE_META: Record<
  BuildingType,
  { label: string; short: string; color: string; icon: string; indoorAction: ActionId }
> = {
  residential: { label: "住宅", short: "HOME", color: "#5af2d0", icon: "⌂", indoorAction: "rest" },
  shop: { label: "商店", short: "SHOP", color: "#ffcf6a", icon: "▤", indoorAction: "shop" },
  workplace: { label: "工作场所", short: "WORK", color: "#5aa7ff", icon: "⌬", indoorAction: "work" },
  public: { label: "公共空间", short: "PUBLIC", color: "#c792ff", icon: "✶", indoorAction: "wander" },
  medical: { label: "医疗设施", short: "MED", color: "#ff6e9f", icon: "✚", indoorAction: "heal" },
  utility: { label: "基础设施", short: "UTIL", color: "#9fb4c8", icon: "ϟ", indoorAction: "rest" },
};

export const RESOURCE_LABELS = {
  credits: "信用点",
  food: "食物",
  energy: "能源",
  meds: "医疗物资",
} as const;

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  stranger: "陌生人",
  acquaintance: "点头之交",
  friend: "朋友",
  close_friend: "挚友",
  partner: "伴侣",
  ex_partner: "前任",
  rival: "竞争对手",
  enemy: "敌人",
  family: "家人",
};

export const WEATHER_META: Record<
  WeatherCondition,
  { label: string; icon: string; color: string; description: string }
> = {
  clear: { label: "晴朗", icon: "◌", color: "#5af2d0", description: "霓虹灯在干净空气中显得格外锐利。" },
  rain: { label: "降雨", icon: "☂", color: "#7fb6ff", description: "街道湿滑，居民更倾向留在室内。" },
  acid_rain: { label: "酸雨", icon: "☣", color: "#b6ff5a", description: "酸性降水腐蚀设备，健康风险上升。" },
  smog: { label: "雾霾", icon: "≋", color: "#c79b5a", description: "能见度降低，呼吸系统承受压力。" },
  heatwave: { label: "热浪", icon: "☀", color: "#ff9f5a", description: "高温让能源需求与压力一起上升。" },
  storm: { label: "电磁风暴", icon: "ϟ", color: "#ff5ac8", description: "电网不稳定，户外行动风险增加。" },
};

export const GOAL_TEMPLATES = {
  corp: ["进入新纪元科技决策层", "攒够搬进企业穹顶的信用点"],
  free: ["让自由港拥有稳定的食物供应", "帮助三位邻居摆脱债务"],
  void: ["查清企业黑箱数据的真相", "建立一条不受监控的信息通道"],
} as const;

export const EVENT_INJECTIONS = [
  { id: "blackout", label: "停电", description: "电网崩溃，能源紧张，居民安全感下降。", tone: "warn" },
  { id: "pollution_spike", label: "污染泄漏", description: "企业区排放失控，污染飙升。", tone: "danger" },
  { id: "layoff", label: "裁员", description: "企业裁员，居民收入与信任受损。", tone: "warn" },
  { id: "food_shortage", label: "粮食短缺", description: "供应链中断，公共食物储备锐减。", tone: "danger" },
  { id: "disease", label: "疾病爆发", description: "一种呼吸道疾病扩散，健康与医疗物资受到冲击。", tone: "danger" },
  { id: "reform", label: "政策改革", description: "福利与治安预算调整，世界规则发生变化。", tone: "info" },
  { id: "accident", label: "事故", description: "基础设施事故损坏建筑并造成伤亡风险。", tone: "danger" },
  { id: "festival", label: "街区庆典", description: "居民暂时放下分歧，信任与情绪回升。", tone: "info" },
  { id: "rumor", label: "谣言风暴", description: "未经证实的消息在城市蔓延，信任与关系承压。", tone: "warn" },
  { id: "funding", label: "外部援助", description: "一笔匿名资金流入社区互助网络。", tone: "info" },
] as const;

export type EventInjectionId = (typeof EVENT_INJECTIONS)[number]["id"];

export const RULES_BOUNDS: Record<
  keyof WorldRules,
  { min: number; max: number; step: number; label: string; unit?: string }
> = {
  wageMultiplier: { min: 0.4, max: 2.5, step: 0.05, label: "工资倍率", unit: "×" },
  priceMultiplier: { min: 0.4, max: 2.5, step: 0.05, label: "物价倍率", unit: "×" },
  foodConsumption: { min: 0.4, max: 2.5, step: 0.05, label: "食物消耗", unit: "×" },
  resourceRegen: { min: 0, max: 3, step: 0.05, label: "资源再生", unit: "×" },
  pollutionDecay: { min: 0, max: 2, step: 0.05, label: "污染自然衰减", unit: "×" },
  taxRate: { min: 0, max: 0.5, step: 0.01, label: "税率", unit: "%" },
  welfare: { min: 0, max: 100, step: 1, label: "福利预算" },
  safetyBudget: { min: 0, max: 100, step: 1, label: "治安预算" },
  lifespanModifier: { min: 0.6, max: 1.4, step: 0.05, label: "寿命修正", unit: "×" },
  socialVolatility: { min: 0.2, max: 2.5, step: 0.05, label: "社交波动", unit: "×" },
  factionsActive: { min: 0, max: 1, step: 1, label: "势力模拟" },
  unrestSensitivity: { min: 0, max: 3, step: 0.05, label: "动荡敏感度", unit: "×" },
  aiAdvisorFrequencyTicks: { min: 12, max: 144, step: 12, label: "AI 决策间隔", unit: " tick" },
};

export const DEFAULT_RULES: WorldRules = {
  wageMultiplier: 1,
  priceMultiplier: 1,
  foodConsumption: 1,
  resourceRegen: 1,
  pollutionDecay: 1,
  taxRate: 0.08,
  welfare: 35,
  safetyBudget: 42,
  lifespanModifier: 1,
  socialVolatility: 1,
  factionsActive: true,
  unrestSensitivity: 1,
  aiAdvisorFrequencyTicks: 48,
};

export const TICK_MS: Record<1 | 2 | 4, number> = { 1: 1200, 2: 650, 4: 330 };

export const MAX_RECENT_MEMORIES = 40;
export const MAX_IMPORTANT_MEMORIES = 32;
export const MAX_EVENTS = 260;
export const MAX_HISTORY = 240;
export const MAX_ACTION_HISTORY = 80;
export const MAX_RELATION_NOTES = 8;
export const MAX_LONG_TERM_SUMMARIES = 16;

export const DEFAULT_CAMERA = {
  position: [38, 32, 42] as [number, number, number],
  target: [0, 0, 2] as [number, number, number],
};
