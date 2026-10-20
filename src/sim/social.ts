import {
  MAX_RELATION_NOTES,
} from "../shared/constants";
import type {
  Relationship,
  RelationshipType,
  Resident,
  WorldState,
} from "../shared/types";
import type { Rng } from "./rng";
import { clamp, recordMemory, updateImpression } from "./events";

export interface RelationshipDelta {
  familiarity?: number;
  affinity?: number;
  trust?: number;
  intimacy?: number;
  attraction?: number;
  hostility?: number;
  note?: string;
}

export function ensureRelationship(
  world: WorldState,
  owner: Resident,
  targetId: string,
): Relationship {
  const existing = owner.relationships[targetId];
  if (existing) return existing;
  const relationship: Relationship = {
    residentId: targetId,
    familiarity: 0,
    affinity: 0,
    trust: 0,
    intimacy: 0,
    attraction: 0,
    hostility: 0,
    type: "stranger",
    sinceDay: world.clock.day,
    lastInteractionDay: world.clock.day,
    interactions: 0,
    notes: [],
  };
  owner.relationships[targetId] = relationship;
  return relationship;
}

export function getRelationship(
  owner: Resident,
  targetId: string,
): Relationship | undefined {
  return owner.relationships[targetId];
}

export function adjustRelationship(
  world: WorldState,
  owner: Resident,
  targetId: string,
  delta: RelationshipDelta,
  perceivedTraits: string[] = [],
): { relationship: Relationship; previousType: RelationshipType; typeChanged: boolean } {
  const relationship = ensureRelationship(world, owner, targetId);
  const previousType = relationship.type;
  relationship.familiarity = clamp(relationship.familiarity + (delta.familiarity ?? 0), 0, 100);
  relationship.affinity = clamp(relationship.affinity + (delta.affinity ?? 0), -100, 100);
  relationship.trust = clamp(relationship.trust + (delta.trust ?? 0), -100, 100);
  relationship.intimacy = clamp(relationship.intimacy + (delta.intimacy ?? 0), 0, 100);
  relationship.attraction = clamp(relationship.attraction + (delta.attraction ?? 0), -100, 100);
  relationship.hostility = clamp(relationship.hostility + (delta.hostility ?? 0), 0, 100);
  relationship.interactions += 1;
  relationship.lastInteractionDay = world.clock.day;
  if (delta.note) {
    relationship.notes.unshift(delta.note.slice(0, 100));
    relationship.notes = relationship.notes.slice(0, MAX_RELATION_NOTES);
  }
  relationship.type = deriveRelationshipType(relationship);
  const typeChanged = relationship.type !== previousType;
  if (typeChanged) relationship.sinceDay = world.clock.day;

  const target = world.residents.find((resident) => resident.id === targetId);
  if (target) {
    const traitsToImpress = perceivedTraits.length
      ? perceivedTraits
      : target.personality.labels.slice(0, 3);
    updateImpression(
      owner,
      targetId,
      `${target.name}：${relationship.type}。${relationship.notes[0] ?? relationshipImpressionTail(relationship)}`,
      traitsToImpress,
      world,
      clamp(0.35 + relationship.familiarity / 160, 0.2, 0.95),
    );
  }
  return { relationship, previousType, typeChanged };
}

export function deriveRelationshipType(relationship: Relationship): RelationshipType {
  if (relationship.type === "family") return "family";
  if (relationship.type === "partner") {
    if (relationship.trust < -10 || relationship.hostility >= 55 || relationship.affinity < -25) {
      return "ex_partner";
    }
    return "partner";
  }
  if (relationship.hostility >= 65 || relationship.trust <= -55) return "enemy";
  if (relationship.hostility >= 25) return "rival";
  if (
    relationship.familiarity >= 52 &&
    relationship.affinity >= 48 &&
    relationship.trust >= 48 &&
    relationship.intimacy >= 52
  ) {
    return "close_friend";
  }
  if (
    relationship.familiarity >= 26 &&
    relationship.affinity >= 18 &&
    relationship.trust >= 16
  ) {
    return "friend";
  }
  if (relationship.familiarity >= 8) return "acquaintance";
  if (relationship.type === "ex_partner") return "ex_partner";
  return "stranger";
}

function relationshipImpressionTail(relationship: Relationship): string {
  if (relationship.trust < -20) return "不太值得信任。";
  if (relationship.affinity > 40) return "和TA相处让人放松。";
  if (relationship.hostility > 20) return "最近气氛有些紧张。";
  return "还需要更多相处才能判断。";
}

/** Personality-based baseline compatibility, 0..100. Deterministic. */
export function compatibilityScore(a: Resident, b: Resident): number {
  const traitsA = a.personality.traits;
  const traitsB = b.personality.traits;
  const extraversionGap = Math.abs(traitsA.extraversion - traitsB.extraversion);
  const agreeablenessGap = Math.abs(traitsA.agreeableness - traitsB.agreeableness);
  const conscientiousnessGap = Math.abs(traitsA.conscientiousness - traitsB.conscientiousness);
  const opennessGap = Math.abs(traitsA.openness - traitsB.openness);
  const valueOverlap = a.personality.values.filter((value) =>
    b.personality.values.includes(value),
  ).length;
  return clamp(
    Math.round(
      62 -
        extraversionGap * 0.18 -
        agreeablenessGap * 0.14 -
        conscientiousnessGap * 0.1 -
        opennessGap * 0.06 +
        valueOverlap * 4,
    ),
    5,
    96,
  );
}

/**
 * A conversation is not a copy-paste of a database fact: the listener receives
 * a rephrased, lower-reliability memory. Important secrets are never copied by
 * ordinary gossip.
 */
export function exchangeMemory(
  world: WorldState,
  speaker: Resident,
  listener: Resident,
  rng: Rng,
): void {
  const pool = [...speaker.memories.recent, ...speaker.memories.important].filter(
    (memory) =>
      memory.importance <= 7 &&
      memory.source !== "ai" &&
      !speaker.secrets.some((secret) => secret.text === memory.text),
  );
  if (pool.length === 0 || !rng.chance(0.55)) return;
  const memory = rng.pick(pool);
  recordMemory(world, listener, {
    text: `从${speaker.name}那里听说：${memory.text}`,
    kind: "told",
    importance: Math.min(5, Math.max(2, memory.importance - 1)),
    subjectIds: [speaker.id, ...memory.subjectIds],
    valence: memory.valence,
    source: "told",
    reliability: clamp(memory.reliability * 0.68, 0.25, 0.8),
  });
  listener.impressions[speaker.id] = {
    summary: `从${speaker.name}那里听到了一些关于城市的事。`,
    perceivedTraits: speaker.personality.labels.slice(0, 3),
    reliability: 0.55,
    updatedDay: world.clock.day,
  };
}

export function describeRelation(relationship: Relationship): string {
  const labels: Record<RelationshipType, string> = {
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
  return labels[relationship.type];
}

export function relationshipStrength(relationship: Relationship): number {
  return relationship.affinity * 0.4 + relationship.trust * 0.35 + relationship.intimacy * 0.2 - relationship.hostility * 0.5;
}
