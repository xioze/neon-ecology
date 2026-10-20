import {
  SAVE_STORAGE_KEY,
  SNAPSHOT_STORAGE_KEY,
  TICK_MS,
  BUILDING_TYPE_META,
} from "../shared/constants";
import { AI_ACTIONS } from "../shared/types";
import type {
  AiRuntimeInfo,
  ConsoleTab,
  CreateResidentInput,
  InteractionMode,
  PlacementDraft,
  Selection,
  SimSpeed,
  SnapshotRecord,
  SnapshotSummary,
  ToastMessage,
  WorldComparison,
  WorldState,
} from "../shared/types";
import type { AiProposal, AiProposalResponse } from "../shared/ai";
import type { EventInjectionId } from "../shared/constants";
import { aiProposalSchema } from "../shared/ai";
import { createInitialWorld } from "../sim/data";
import { tickWorld, type TickReport } from "../sim/engine";
import { executeCommand, type CommandResult, type WorldCommand } from "../sim/commands";
import { addEvent } from "../sim/events";
import { buildAiDecisionRequest, applyAiProposal } from "../sim/aiContext";
import {
  cloneWorld,
  compareSnapshots,
  createSaveFile,
  createSnapshotRecord,
  parseWorldJson,
  serializeWorld,
  snapshotSummary,
} from "../sim/save";
import { makeSeed } from "../sim/rng";

export interface SimulationUiState {
  revision: number;
  world: WorldState;
  paused: boolean;
  speed: SimSpeed;
  mode: InteractionMode;
  selected: Selection;
  hovered: Selection;
  inspectorOpen: boolean;
  consoleOpen: boolean;
  consoleTab: ConsoleTab;
  placement: PlacementDraft;
  ai: AiRuntimeInfo;
  toast: ToastMessage | null;
  saveStatus: string;
  snapshots: SnapshotSummary[];
  lastTickReport: TickReport | null;
  lastAiMessage: string | null;
}

type Listener = () => void;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface ServerStatus {
  mode?: string;
  model?: string;
  ai?: {
    enabled?: boolean;
    hourlyLimit?: number;
    lastError?: string | null;
  };
}

const DEFAULT_AI: AiRuntimeInfo = {
  serviceAvailable: false,
  enabled: true,
  model: null,
  calls: 0,
  failures: 0,
  rejected: 0,
  pending: false,
  lastError: null,
  lastLatencyMs: null,
  lastCallTick: null,
  hourlyLimit: null,
};

export class SimulationStore {
  private storage: StorageLike | null;
  private world: WorldState;
  private listeners = new Set<Listener>();
  private ui: SimulationUiState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private toastId = 0;
  private snapshotRecords: SnapshotRecord[] = [];
  private lastAutoAiTick = -999;
  private tickInFlight = false;
  private aiRequestInFlight = false;
  private lastTickAt = 0;

  constructor(storage?: StorageLike | null) {
    this.storage =
      storage !== undefined
        ? storage
        : typeof window !== "undefined" && window.localStorage
          ? window.localStorage
          : null;
    const restored = this.readAutosave();
    this.world = restored ?? createInitialWorld({ seed: makeSeed() });
    this.snapshotRecords = this.readSnapshots();
    this.ui = {
      revision: 0,
      world: this.world,
      paused: false,
      speed: 1,
      mode: "observe",
      selected: null,
      hovered: null,
      inspectorOpen: false,
      consoleOpen: true,
      consoleTab: "overview",
      placement: { type: null },
      ai: {
        ...DEFAULT_AI,
        enabled: this.readAiEnabledPreference(),
      },
      toast: null,
      saveStatus: restored
        ? `已恢复本地存档 · D${this.world.clock.day}`
        : "世界已生成，自动存档就绪",
      snapshots: this.snapshotRecords.map(snapshotSummary),
      lastTickReport: null,
      lastAiMessage: null,
    };
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SimulationUiState => this.ui;

  getWorld = (): WorldState => this.world;

  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.ui.paused) this.scheduleTimer();
    void this.refreshAiStatus();
    this.statusTimer = setInterval(() => {
      void this.refreshAiStatus();
    }, 45_000);
  }

  stop(): void {
    this.started = false;
    this.clearTimer();
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private scheduleTimer(): void {
    this.clearTimer();
    if (!this.started || this.ui.paused) return;
    const interval = TICK_MS[this.ui.speed] ?? TICK_MS[1];
    this.timer = setInterval(() => {
      this.runTick({ allowAi: true });
    }, interval);
  }

  setPaused(paused: boolean): void {
    if (this.ui.paused === paused) return;
    this.update((current) => ({
      ui: { ...current, paused },
    }));
    if (paused) this.clearTimer();
    else this.scheduleTimer();
  }

  togglePause(): void {
    this.setPaused(!this.ui.paused);
  }

  setSpeed(speed: SimSpeed): void {
    if (![1, 2, 4].includes(speed)) return;
    this.update((current) => ({ ui: { ...current, speed } }));
    if (!this.ui.paused) this.scheduleTimer();
  }

  stepOnce(): void {
    if (this.ui.paused) {
      this.runTick({ allowAi: false });
      return;
    }
    this.setPaused(true);
    this.runTick({ allowAi: false });
  }

  private runTick(options: { allowAi: boolean }): void {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      const report = tickWorld(this.world);
      if (this.world.clock.tick % 6 === 0) this.persistQuiet();
      this.update((current) => ({
        ui: {
          ...current,
          revision: current.revision + 1,
          world: this.world,
          lastTickReport: report,
          saveStatus:
            this.world.clock.tick % 6 === 0
              ? `自动存档 · D${this.world.clock.day} ${formatClock(this.world.clock.minuteOfDay)}`
              : current.saveStatus,
        },
      }));
      this.validateSelection();
      if (options.allowAi && this.started) this.maybeAutoAi();
    } finally {
      this.tickInFlight = false;
    }
  }

  setMode(mode: InteractionMode): void {
    this.update((current) => ({
      ui: {
        ...current,
        mode,
        consoleOpen: true,
        toast: null,
      },
    }));
    if (mode === "intervene") {
      this.notify("已进入干预模式：造物主操作会直接写入模拟状态。", "info");
    } else {
      this.notify("已回到观察模式：只能查看，不能修改世界。", "info");
    }
  }

  select(selection: Selection): void {
    this.update((current) => ({
      ui: {
        ...current,
        selected: selection,
        inspectorOpen: selection !== null,
      },
    }));
  }

  setHovered(selection: Selection): void {
    const current = this.ui.hovered;
    const same =
      current === selection ||
      (current &&
        selection &&
        current.kind === selection.kind &&
        current.id === selection.id);
    if (same) return;
    this.update((state) => ({ ui: { ...state, hovered: selection } }));
  }

  closeInspector(): void {
    this.update((current) => ({
      ui: { ...current, selected: null, inspectorOpen: false },
    }));
  }

  setConsoleOpen(open: boolean): void {
    this.update((current) => ({ ui: { ...current, consoleOpen: open } }));
  }

  toggleConsole(): void {
    this.setConsoleOpen(!this.ui.consoleOpen);
  }

  setConsoleTab(tab: ConsoleTab): void {
    this.update((current) => ({ ui: { ...current, consoleTab: tab, consoleOpen: true } }));
  }

  setPlacementType(type: PlacementDraft["type"]): void {
    if (type && this.ui.mode !== "intervene") {
      this.notify("请先切换到干预模式，才能放置建筑。", "error");
      return;
    }
    this.update((current) => ({
      ui: { ...current, placement: { type }, consoleOpen: true },
    }));
  }

  placeBuildingAt(tileX: number, tileZ: number): CommandResult {
    const type = this.ui.placement.type;
    if (!type) return { ok: false, message: "请先选择要放置的建筑类型。" };
    if (this.ui.mode !== "intervene") {
      return { ok: false, message: "观察模式下不能放置建筑。" };
    }
    const dimensions: Record<typeof type, [number, number]> = {
      residential: [4, 3],
      shop: [3, 3],
      workplace: [4, 4],
      public: [4, 3],
      medical: [3, 3],
      utility: [3, 3],
    };
    const [w, d] = dimensions[type];
    const spec = {
      type,
      name: `${BUILDING_TYPE_META[type].label} #${this.world.buildings.length + 1}`,
      x: Math.round(tileX - Math.floor(w / 2)),
      z: Math.round(tileZ - Math.floor(d / 2)),
      w,
      d,
      capacity: type === "residential" ? 14 : 20,
      ownerFactionId: this.world.factions[0]?.id ?? "free",
      neonColor: BUILDING_TYPE_META[type].color,
    };
    const result = this.runCommand({ type: "place_building", spec });
    if (result.ok) this.setPlacementType(null);
    return result;
  }

  runCommand(command: WorldCommand): CommandResult {
    if (this.ui.mode !== "intervene") {
      const result = { ok: false, message: "观察模式下不能修改世界，请切换到干预模式。" };
      this.notify(result.message, "error");
      return result;
    }
    let result: CommandResult;
    try {
      result = executeCommand(this.world, command);
    } catch (error) {
      result = {
        ok: false,
        message: `操作失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (result.ok) {
      this.persistQuiet();
      this.update((current) => ({
        ui: {
          ...current,
          revision: current.revision + 1,
          world: this.world,
          saveStatus: `已应用造物主操作 · D${this.world.clock.day}`,
        },
      }));
      this.validateSelection();
      this.notify(result.message, "success");
    } else {
      this.notify(result.message, "error");
    }
    return result;
  }

  private validateSelection(): void {
    const selected = this.ui.selected;
    if (!selected) return;
    const exists =
      selected.kind === "resident"
        ? this.world.residents.some((resident) => resident.id === selected.id)
        : this.world.buildings.some((building) => building.id === selected.id);
    if (!exists) {
      this.update((current) => ({
        ui: { ...current, selected: null, inspectorOpen: false },
      }));
    }
  }

  newWorld(options?: { seed?: number; name?: string }): void {
    this.world = createInitialWorld({
      seed: options?.seed,
      name: options?.name,
    });
    this.lastAutoAiTick = this.world.clock.tick - 8;
    this.clearTimer();
    this.update((current) => ({
      ui: {
        ...current,
        revision: current.revision + 1,
        world: this.world,
        paused: false,
        selected: null,
        hovered: null,
        inspectorOpen: false,
        placement: { type: null },
        lastTickReport: null,
      },
    }));
    this.persistQuiet();
    if (!this.ui.paused) this.scheduleTimer();
    this.notify("新世界已生成，模拟重新开始。", "success");
  }

  createResident(spec: CreateResidentInput): CommandResult {
    return this.runCommand({ type: "create_resident", spec });
  }

  editResident(
    residentId: string,
    patch: Extract<WorldCommand, { type: "edit_resident" }>["patch"],
  ): CommandResult {
    return this.runCommand({ type: "edit_resident", residentId, patch });
  }

  injectEvent(eventId: EventInjectionId): CommandResult {
    return this.runCommand({ type: "inject_event", eventId });
  }

  saveLocal(): boolean {
    if (!this.storage) {
      this.notify("当前环境不支持 localStorage。请使用导出存档。", "error");
      return false;
    }
    try {
      const save = createSaveFile(this.world);
      this.storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(save));
      this.update((current) => ({
        ui: {
          ...current,
          saveStatus: `已保存到浏览器 · D${this.world.clock.day} ${formatClock(this.world.clock.minuteOfDay)}`,
        },
      }));
      this.notify("世界快照已保存到浏览器本地。", "success");
      return true;
    } catch (error) {
      this.notify(`保存失败：${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
  }

  loadLocal(): boolean {
    if (!this.storage) {
      this.notify("当前环境不支持 localStorage。", "error");
      return false;
    }
    try {
      const raw = this.storage.getItem(SAVE_STORAGE_KEY);
      if (!raw) {
        this.notify("没有找到本地存档。", "error");
        return false;
      }
      const parsed = parseWorldJson(raw);
      if (!parsed.ok) {
        this.notify(parsed.error, "error");
        return false;
      }
      this.applyLoadedWorld(parsed.save.world);
      this.notify(`已读取本地存档 · 第 ${this.world.clock.day} 天。`, "success");
      return true;
    } catch (error) {
      this.notify(`读取失败：${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
  }

  exportWorldJson(): string {
    return serializeWorld(this.world);
  }

  importWorldJson(raw: string): boolean {
    const parsed = parseWorldJson(raw);
    if (!parsed.ok) {
      this.notify(parsed.error, "error");
      return false;
    }
    this.applyLoadedWorld(parsed.save.world);
    this.notify("存档已导入并接管当前世界。", "success");
    return true;
  }

  private applyLoadedWorld(world: WorldState): void {
    this.world = cloneWorld(world);
    this.clearTimer();
    this.update((current) => ({
      ui: {
        ...current,
        revision: current.revision + 1,
        world: this.world,
        paused: true,
        selected: null,
        hovered: null,
        inspectorOpen: false,
        placement: { type: null },
        lastTickReport: null,
        saveStatus: `已载入世界 · D${this.world.clock.day}`,
      },
    }));
    this.persistQuiet();
  }

  captureSnapshot(name?: string, note?: string): SnapshotSummary | null {
    if (this.snapshotRecords.length >= 10) {
      this.notify("快照数量已达上限（10），请先删除一个旧快照。", "error");
      return null;
    }
    const label =
      name?.trim() ||
      `第 ${this.world.clock.day} 天 ${formatClock(this.world.clock.minuteOfDay)} 快照`;
    const snapshot = createSnapshotRecord(
      this.world,
      label,
      note ?? `规则版本 v${this.world.ruleVersion}，天气 ${this.world.weather.condition}`,
    );
    this.snapshotRecords.push(snapshot);
    this.persistSnapshots();
    this.update((current) => ({
      ui: {
        ...current,
        snapshots: this.snapshotRecords.map(snapshotSummary),
      },
    }));
    this.notify(`快照“${label}”已保存。`, "success");
    return snapshotSummary(snapshot);
  }

  restoreSnapshot(snapshotId: string): boolean {
    const snapshot = this.snapshotRecords.find((record) => record.id === snapshotId);
    if (!snapshot) {
      this.notify("快照不存在。", "error");
      return false;
    }
    this.applyLoadedWorld(snapshot.world);
    this.notify(`已恢复快照“${snapshot.name}”。`, "success");
    return true;
  }

  branchSnapshot(snapshotId: string): boolean {
    const snapshot = this.snapshotRecords.find((record) => record.id === snapshotId);
    if (!snapshot) {
      this.notify("快照不存在。", "error");
      return false;
    }
    const branch = cloneWorld(snapshot.world);
    branch.worldId = `world-branch-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
    branch.name = `${snapshot.world.name} · 分支`;
    branch.createdAtIso = new Date().toISOString();
    branch.events.unshift({
      ...blankEvent(branch),
      type: "system",
      title: `从快照“${snapshot.name}”建立分支世界`,
      description: "分支将保留居民记忆、关系、随机数状态和规则配置，可以与原世界独立演化。",
      source: "system",
      importance: 3,
      tag: "PARALLEL",
    });
    const branchSnapshot = createSnapshotRecord(
      branch,
      `${snapshot.name} · 分支起点`,
      "分支实验起点",
      snapshot.id,
    );
    this.snapshotRecords.push(branchSnapshot);
    this.world = branch;
    this.clearTimer();
    this.persistSnapshots();
    this.update((current) => ({
      ui: {
        ...current,
        revision: current.revision + 1,
        world: this.world,
        paused: true,
        selected: null,
        inspectorOpen: false,
        placement: { type: null },
        snapshots: this.snapshotRecords.map(snapshotSummary),
        saveStatus: `分支世界已创建 · D${branch.clock.day}`,
      },
    }));
    this.persistQuiet();
    this.notify("分支世界已创建，当前世界已切换。", "success");
    return true;
  }

  deleteSnapshot(snapshotId: string): boolean {
    const before = this.snapshotRecords.length;
    this.snapshotRecords = this.snapshotRecords.filter((record) => record.id !== snapshotId);
    if (this.snapshotRecords.length === before) return false;
    this.persistSnapshots();
    this.update((current) => ({
      ui: { ...current, snapshots: this.snapshotRecords.map(snapshotSummary) },
    }));
    this.notify("快照已删除。", "success");
    return true;
  }

  compareSnapshots(aId: string, bId: string): WorldComparison | null {
    const a = this.snapshotRecords.find((record) => record.id === aId);
    const b = this.snapshotRecords.find((record) => record.id === bId);
    if (!a || !b) {
      this.notify("比较失败：快照不存在。", "error");
      return null;
    }
    return compareSnapshots(a, b);
  }

  compareSnapshotWithCurrent(snapshotId: string): WorldComparison | null {
    const a = this.snapshotRecords.find((record) => record.id === snapshotId);
    if (!a) {
      this.notify("比较失败：快照不存在。", "error");
      return null;
    }
    const b = createSnapshotRecord(this.world, "当前世界", undefined, a.id);
    return compareSnapshots(a, b);
  }

  getSnapshotRecords(): SnapshotSummary[] {
    return this.snapshotRecords.map(snapshotSummary);
  }

  setAiEnabled(enabled: boolean): void {
    this.update((current) => ({
      ui: { ...current, ai: { ...current.ai, enabled } },
    }));
    try {
      this.storage?.setItem("neon-ecology-ai-enabled-v2", enabled ? "1" : "0");
    } catch {
      // Preference persistence is optional.
    }
    this.notify(enabled ? "AI 顾问已启用。" : "AI 顾问已停用，居民将继续本地决策。", "info");
  }

  async refreshAiStatus(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch("/api/status", { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`status ${response.status}`);
      const status = (await response.json()) as ServerStatus;
      const available = status.mode === "online-ready";
      this.update((current) => ({
        ui: {
          ...current,
          ai: {
            ...current.ai,
            serviceAvailable: available,
            enabled: current.ai.enabled && status.ai?.enabled !== false,
            model: status.model ?? current.ai.model,
            hourlyLimit: status.ai?.hourlyLimit ?? current.ai.hourlyLimit,
            lastError: available ? null : current.ai.lastError,
          },
        },
      }));
    } catch {
      this.update((current) => ({
        ui: {
          ...current,
          ai: {
            ...current.ai,
            serviceAvailable: false,
          },
        },
      }));
    }
  }

  async requestAiForSelected(): Promise<boolean> {
    const selected = this.ui.selected;
    if (!selected || selected.kind !== "resident") {
      this.notify("请先在 3D 城市中选择一名居民。", "error");
      return false;
    }
    return this.requestAiDecision(selected.id, false);
  }

  private maybeAutoAi(): void {
    if (!this.ui.ai.enabled || !this.ui.ai.serviceAvailable || this.aiRequestInFlight) return;
    const interval = Math.max(12, this.world.rules.aiAdvisorFrequencyTicks);
    if (this.world.clock.tick - this.lastAutoAiTick < interval) return;
    const alive = this.world.residents.filter((resident) => resident.alive && !resident.paused);
    if (alive.length === 0) return;
    const significant = [...alive]
      .sort((a, b) => significance(b) - significance(a))
      .slice(0, 5);
    const candidate = significant[Math.floor(this.world.clock.tick / interval) % significant.length];
    if (!candidate) return;
    this.lastAutoAiTick = this.world.clock.tick;
    void this.requestAiDecision(candidate.id, true);
  }

  private async requestAiDecision(residentId: string, automatic: boolean): Promise<boolean> {
    if (this.aiRequestInFlight) {
      if (!automatic) this.notify("已有一个 AI 请求正在进行，请稍候。", "error");
      return false;
    }
    if (!this.ui.ai.enabled) {
      if (!automatic) this.notify("AI 顾问当前已停用。", "error");
      return false;
    }
    const request = buildAiDecisionRequest(this.world, residentId);
    if (!request) {
      if (!automatic) this.notify("无法为这名居民构建 AI 上下文（可能已死亡）。", "error");
      return false;
    }
    this.aiRequestInFlight = true;
    this.update((current) => ({
      ui: { ...current, ai: { ...current.ai, pending: true } },
    }));
    const startedAt = performance.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch("/api/ai/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(request),
      });
      clearTimeout(timeout);
      const body = (await response.json()) as AiProposalResponse;
      if (!response.ok || !body.ok) {
        const message = !body.ok ? body.error : `AI 服务返回 ${response.status}`;
        const code = !body.ok ? body.code : "AI_UPSTREAM_ERROR";
        this.recordAiFailure(message, code, automatic);
        return false;
      }
      const parsedProposal = aiProposalSchema.safeParse(body.proposal);
      if (!parsedProposal.success) {
        this.recordAiFailure("AI 返回的提案结构不合法，已拒绝。", "AI_INVALID_PROPOSAL", automatic);
        return false;
      }
      const proposal = parsedProposal.data as AiProposal;
      const applied = applyAiProposal(this.world, request, proposal, {
        model: body.meta?.model,
        latencyMs: body.meta?.latencyMs,
      });
      const latency = Math.max(0, Math.round(performance.now() - startedAt));
      if (!applied.ok) {
        this.update((current) => ({
          ui: {
            ...current,
            revision: current.revision + 1,
            world: this.world,
            ai: {
              ...current.ai,
              rejected: current.ai.rejected + 1,
              lastError: applied.message,
              lastLatencyMs: latency,
            },
            lastAiMessage: `AI 提案被拒绝：${applied.message}`,
          },
        }));
        if (!automatic) this.notify(`AI 提案被引擎拒绝：${applied.message}`, "error");
        return false;
      }
      this.persistQuiet();
      this.update((current) => ({
        ui: {
          ...current,
          revision: current.revision + 1,
          world: this.world,
          ai: {
            ...current.ai,
            calls: current.ai.calls + 1,
            lastLatencyMs: latency,
            lastCallTick: this.world.clock.tick,
            lastError: null,
          },
          lastAiMessage: `${this.world.residents.find((resident) => resident.id === residentId)?.name ?? "居民"}：${proposal.reason}`,
        },
      }));
      if (!automatic) {
        this.notify("AI 建议已被引擎校验并登记，居民将在下一次决策中自行评估。", "success");
      }
      return true;
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "AI 请求超时，本回合使用本地决策。"
          : `AI 服务不可用：${error instanceof Error ? error.message : String(error)}`;
      this.recordAiFailure(message, "AI_OFFLINE", automatic);
      return false;
    } finally {
      this.aiRequestInFlight = false;
      this.update((current) => ({
        ui: { ...current, ai: { ...current.ai, pending: false } },
      }));
    }
  }

  private recordAiFailure(message: string, code: string, automatic: boolean): void {
    addEvent(this.world, {
      type: "warn",
      title: automatic ? "AI 顾问请求失败，已回退本地决策" : "AI 顾问请求失败",
      description: `${message}（${code}）。模拟不会因此停止或损坏。`,
      source: "ai",
      importance: 2,
      tag: "AI FALLBACK",
    });
    this.update((current) => ({
      ui: {
        ...current,
        revision: current.revision + 1,
        world: this.world,
        ai: {
          ...current.ai,
          failures: current.ai.failures + 1,
          lastError: message,
        },
        lastAiMessage: message,
      },
    }));
    if (!automatic) this.notify(message, "error");
  }

  private update(mutator: (current: SimulationUiState) => { ui: SimulationUiState }): void {
    const result = mutator(this.ui);
    this.ui = {
      ...result.ui,
      world: this.world,
    };
    for (const listener of this.listeners) listener();
  }

  private notify(text: string, kind: ToastMessage["kind"]): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    const toast: ToastMessage = { id: ++this.toastId, text, kind };
    this.update((current) => ({ ui: { ...current, toast } }));
    this.toastTimer = setTimeout(() => {
      this.update((current) => ({ ui: { ...current, toast: null } }));
    }, 3200);
  }

  dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.update((current) => ({ ui: { ...current, toast: null } }));
  }

  private persistQuiet(): void {
    if (!this.storage) return;
    try {
      const save = createSaveFile(this.world);
      this.storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(save));
    } catch {
      // Autosave failure must never interrupt simulation.
    }
  }

  private readAutosave(): WorldState | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(SAVE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = parseWorldJson(raw);
      if (!parsed.ok) return null;
      return parsed.save.world;
    } catch {
      return null;
    }
  }

  private readSnapshots(): SnapshotRecord[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(SNAPSHOT_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (entry): entry is SnapshotRecord =>
            !!entry &&
            typeof entry === "object" &&
            typeof (entry as SnapshotRecord).id === "string" &&
            !!(entry as SnapshotRecord).world,
        )
        .slice(0, 10);
    } catch {
      return [];
    }
  }

  private persistSnapshots(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(this.snapshotRecords));
    } catch (error) {
      this.notify(
        `快照保存失败：${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  private readAiEnabledPreference(): boolean {
    if (!this.storage) return true;
    try {
      return this.storage.getItem("neon-ecology-ai-enabled-v2") !== "0";
    } catch {
      return true;
    }
  }
}

function formatClock(minuteOfDay: number): string {
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
}

function significance(resident: WorldState["residents"][number]): number {
  const conflict = Object.values(resident.relationships).reduce(
    (sum, relation) => sum + relation.hostility + Math.max(0, -relation.affinity),
    0,
  );
  return resident.stress * 1.2 + conflict * 0.7 + resident.needs.hunger * 0.2;
}

function blankEvent(world: WorldState) {
  return {
    id: `branch-${Date.now().toString(36)}`,
    tick: world.clock.tick,
    day: world.clock.day,
    minuteOfDay: world.clock.minuteOfDay,
    type: "system" as const,
    title: "",
    description: "",
    source: "system" as const,
    importance: 1,
    tag: "SYSTEM",
  };
}

export const simulationStore = new SimulationStore();

export { AI_ACTIONS };
