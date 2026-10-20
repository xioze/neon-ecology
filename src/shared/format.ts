import type {
  Building,
  GameEvent,
  Needs,
  Resident,
  WorldState,
} from "./types";
import { BUILDING_TYPE_META, RELATIONSHIP_LABELS, WEATHER_META } from "./constants";

export function formatClock(minuteOfDay: number): string {
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
}

export function formatDayTime(world: Pick<WorldState, "clock">): string {
  return `D${String(world.clock.day).padStart(2, "0")} · ${formatClock(world.clock.minuteOfDay)}`;
}

export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 10000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function moodLabel(mood: number): string {
  if (mood >= 82) return "神采奕奕";
  if (mood >= 66) return "松弛";
  if (mood >= 50) return "平静";
  if (mood >= 34) return "低落";
  if (mood >= 18) return "消沉";
  return "濒临崩溃";
}

export function healthLabel(health: number): string {
  if (health >= 85) return "健康";
  if (health >= 65) return "尚可";
  if (health >= 42) return "虚弱";
  if (health >= 20) return "病重";
  return "危殆";
}

export function stressLabel(stress: number): string {
  if (stress >= 80) return "濒临断裂";
  if (stress >= 60) return "高压";
  if (stress >= 40) return "紧绷";
  if (stress >= 20) return "轻微";
  return "放松";
}

export function needLabel(key: keyof Needs): string {
  return { hunger: "饥饿", energy: "精力", social: "社交", safety: "安全感" }[key];
}

/** For hunger, higher is worse; for the others higher is better. */
export function needSeverity(key: keyof Needs, value: number): "good" | "warn" | "bad" {
  if (key === "hunger") {
    if (value < 35) return "good";
    if (value < 70) return "warn";
    return "bad";
  }
  if (value > 65) return "good";
  if (value > 30) return "warn";
  return "bad";
}

export function relationshipLabel(type: string): string {
  return RELATIONSHIP_LABELS[type as keyof typeof RELATIONSHIP_LABELS] ?? "未知关系";
}

export function buildingTypeLabel(type: Building["type"]): string {
  return BUILDING_TYPE_META[type].label;
}

export function weatherLabel(world: Pick<WorldState, "weather">): string {
  return WEATHER_META[world.weather.condition].label;
}

export function residentLocation(
  world: Pick<WorldState, "buildings">,
  resident: Pick<Resident, "insideBuildingId" | "position">,
): string {
  if (resident.insideBuildingId) {
    return (
      world.buildings.find((building) => building.id === resident.insideBuildingId)?.name ??
      "建筑内"
    );
  }
  return `街区 (${Math.round(resident.position.x)}, ${Math.round(resident.position.z)})`;
}

export function eventTone(type: GameEvent["type"]): string {
  switch (type) {
    case "danger":
      return "danger";
    case "warn":
      return "warn";
    case "ai":
      return "ai";
    case "player":
      return "player";
    case "faction":
      return "faction";
    case "social":
      return "social";
    case "economy":
      return "economy";
    case "lifecycle":
      return "lifecycle";
    case "system":
      return "system";
    default:
      return "info";
  }
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
