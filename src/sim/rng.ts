/**
 * Explicit-state PRNG. The state lives in WorldState.rngState so that saves,
 * snapshots and branch experiments reproduce the exact same random stream.
 */
export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    this.state = (t ^ (t >>> 14)) >>> 0;
    return this.state / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick called with an empty array");
    return items[Math.floor(this.next() * items.length)]!;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }

  weighted<T>(entries: Array<{ value: T; weight: number }>): T {
    const total = entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
    if (total <= 0) return this.pick(entries).value;
    let roll = this.next() * total;
    for (const entry of entries) {
      roll -= Math.max(0, entry.weight);
      if (roll <= 0) return entry.value;
    }
    return entries[entries.length - 1]!.value;
  }
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function makeSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}
