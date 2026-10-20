import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { APP_VERSION, SCHEMA_VERSION, SAVE_STORAGE_KEY } from "../../shared/constants";
import { formatClock } from "../../shared/format";
import { simulationStore, useSimulation } from "../../store/useSimulation";
import { useConfirm } from "../ConfirmDialog";
import { Tag } from "../ui";

export function SavesTab() {
  const { world, saveStatus, snapshots } = useSimulation();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function exportJson() {
    const raw = simulationStore.exportWorldJson();
    const blob = new Blob([raw], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `neon-ecology-${world.worldId}-D${world.clock.day}-t${world.clock.tick}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function loadLocal() {
    const ok = await confirm({
      title: "读取浏览器本地存档？",
      message: "当前世界会被本地存档替换；未保存到本地的进度会丢失。",
      details: (
        <p className="muted">
          读取后模拟会暂停，并保留当前快照列表不变。localStorage 键：<span className="mono">{SAVE_STORAGE_KEY}</span>
        </p>
      ),
      tone: "danger",
      confirmText: "读取本地存档",
    });
    if (!ok) return;
    simulationStore.loadLocal();
  }

  async function resetWorld() {
    const ok = await confirm({
      title: "重置世界？",
      message:
        "当前世界会被一个全新的随机世界替换：所有居民、建筑、关系、记忆、事件与历史都会重新生成。实验快照列表会保留。",
      details: (
        <ul className="confirm-list">
          <li>当前 D{world.clock.day} {formatClock(world.clock.minuteOfDay)} 的世界将被废弃</li>
          <li>快照（{snapshots.length} 个）不会被删除</li>
          <li>该操作不可撤销</li>
        </ul>
      ),
      tone: "danger",
      confirmText: "重置并生成新世界",
    });
    if (!ok) return;
    simulationStore.newWorld();
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportError(null);
    if (file.size > 12 * 1024 * 1024) {
      setImportError("文件超过 12MB，已拒绝导入。");
      return;
    }
    let raw: string;
    try {
      raw = await file.text();
    } catch {
      setImportError("无法读取文件内容。");
      return;
    }
    const ok = await confirm({
      title: `导入存档「${file.name}」？`,
      message: "当前世界会被导入的存档替换。请确认这是本应用导出的 JSON 存档；损坏或不兼容的存档会被安全拒绝。",
      tone: "danger",
      confirmText: "导入并接管世界",
    });
    if (!ok) return;
    setBusy(true);
    const imported = simulationStore.importWorldJson(raw);
    setBusy(false);
    if (!imported) setImportError("导入失败，具体原因见提示消息。");
  }

  return (
    <div className="saves-tab">
      <div className="saves-columns">
        <section className="save-actions-card">
          <header className="tab-toolbar">
            <div className="tab-toolbar-title">
              <h5>存档操作</h5>
              <Tag tone="cyan">schema v{SCHEMA_VERSION}</Tag>
              <Tag tone="neutral">app v{APP_VERSION}</Tag>
            </div>
          </header>
          <p className="tab-hint">自动存档每 6 个 tick 与每次造物主操作后触发。手动操作会立即写入当前世界。</p>
          <div className="save-action-grid">
            <button type="button" className="save-action" onClick={() => simulationStore.saveLocal()}>
              <span className="save-action-icon">⛁</span>
              <span className="save-action-title">保存到浏览器</span>
              <span className="save-action-desc">写入 localStorage，刷新页面后自动恢复。</span>
            </button>
            <button type="button" className="save-action" onClick={() => void loadLocal()}>
              <span className="save-action-icon">↺</span>
              <span className="save-action-title">读取本地存档</span>
              <span className="save-action-desc">用浏览器中的存档替换当前世界（需确认）。</span>
            </button>
            <button type="button" className="save-action" onClick={exportJson}>
              <span className="save-action-icon">⇩</span>
              <span className="save-action-title">导出 JSON</span>
              <span className="save-action-desc">下载完整世界存档文件，可备份或分享。</span>
            </button>
            <button
              type="button"
              className="save-action"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <span className="save-action-icon">⇧</span>
              <span className="save-action-title">导入 JSON</span>
              <span className="save-action-desc">选择本应用导出的存档文件并接管世界。</span>
            </button>
            <button type="button" className="save-action save-action-danger" onClick={() => void resetWorld()}>
              <span className="save-action-icon">⚠</span>
              <span className="save-action-title">重置世界</span>
              <span className="save-action-desc">生成全新随机世界，当前进度不可撤销（需确认）。</span>
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden-file-input"
            onChange={(event) => void handleFile(event)}
          />
          {importError ? <p className="form-error">{importError}</p> : null}
          {busy ? <p className="muted">正在导入存档…</p> : null}
        </section>

        <section className="save-info-card">
          <header className="tab-toolbar">
            <div className="tab-toolbar-title">
              <h5>当前世界</h5>
            </div>
          </header>
          <div className="save-info-list">
            <div className="ov-kv">
              <span>世界名</span>
              <span>{world.name}</span>
            </div>
            <div className="ov-kv">
              <span>世界 ID</span>
              <span className="mono">{world.worldId}</span>
            </div>
            <div className="ov-kv">
              <span>种子</span>
              <span className="mono">{world.seed}</span>
            </div>
            <div className="ov-kv">
              <span>时间</span>
              <span className="mono">
                D{world.clock.day} {formatClock(world.clock.minuteOfDay)} · tick {world.clock.tick}
              </span>
            </div>
            <div className="ov-kv">
              <span>人口 / 建筑 / 势力</span>
              <span className="mono">
                {world.metrics.population} / {world.buildings.length} / {world.factions.length}
              </span>
            </div>
            <div className="ov-kv">
              <span>规则版本</span>
              <span className="mono">v{world.ruleVersion}</span>
            </div>
            <div className="ov-kv">
              <span>创建时间</span>
              <span className="mono">{new Date(world.createdAtIso).toLocaleString("zh-CN")}</span>
            </div>
            <div className="ov-kv">
              <span>事件 / 历史点</span>
              <span className="mono">
                {world.events.length} / {world.history.length}
              </span>
            </div>
            <div className="ov-kv">
              <span>快照</span>
              <span className="mono">{snapshots.length} / 10</span>
            </div>
            <div className="ov-kv">
              <span>存档状态</span>
              <span className="ov-save-status">{saveStatus}</span>
            </div>
          </div>
          <p className="form-hint">
            导入时会校验 schema 版本、建筑边界、居民住所/工作地点与关系完整性；不合法的存档会被拒绝并保留当前世界。
          </p>
        </section>
      </div>
    </div>
  );
}
