import { useState } from "react";
import { RULES_BOUNDS } from "../../shared/constants";
import { formatClock, formatMoney } from "../../shared/format";
import type { WorldComparison, WorldMetrics, WorldRules } from "../../shared/types";
import { simulationStore, useSimulation } from "../../store/useSimulation";
import { useConfirm } from "../ConfirmDialog";
import { weatherName } from "../labels";
import { cx, EmptyHint, TextField, formatSigned } from "../ui";

const COMPARE_METRICS: Array<{ key: keyof WorldMetrics; label: string; higherIsBetter: boolean }> = [
  { key: "stability", label: "稳定度", higherIsBetter: true },
  { key: "pollution", label: "污染", higherIsBetter: false },
  { key: "trust", label: "信任", higherIsBetter: true },
  { key: "inequality", label: "贫富差距", higherIsBetter: false },
  { key: "resourceSupply", label: "资源供应", higherIsBetter: true },
  { key: "averageMood", label: "平均情绪", higherIsBetter: true },
  { key: "averageWealth", label: "平均财富", higherIsBetter: true },
  { key: "population", label: "人口", higherIsBetter: true },
];

function deltaClass(delta: number, higherIsBetter: boolean): string {
  if (Math.abs(delta) < 1e-9) return "delta-flat";
  return delta > 0 === higherIsBetter ? "delta-good" : "delta-bad";
}

function ruleDiff(rulesA: WorldRules, rulesB: WorldRules): Array<{ label: string; a: string; b: string }> {
  const diffs: Array<{ label: string; a: string; b: string }> = [];
  for (const key of Object.keys(rulesA) as Array<keyof WorldRules>) {
    const valueA = rulesA[key];
    const valueB = rulesB[key];
    if (valueA === valueB) continue;
    const label = RULES_BOUNDS[key]?.label ?? key;
    diffs.push({ label, a: String(valueA), b: String(valueB) });
  }
  return diffs;
}

export function ExperimentsTab() {
  const { snapshots, world } = useSimulation();
  const confirm = useConfirm();
  const [snapshotName, setSnapshotName] = useState("");
  const [compareA, setCompareA] = useState(snapshots[0]?.id ?? "");
  const [compareB, setCompareB] = useState("current");
  const [comparison, setComparison] = useState<WorldComparison | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  const targetA = compareA || snapshots[0]?.id || "";

  function capture() {
    simulationStore.captureSnapshot(snapshotName.trim() || undefined);
    setSnapshotName("");
  }

  async function restore(snapshotId: string, name: string) {
    const ok = await confirm({
      title: `恢复快照「${name}」？`,
      message: "当前世界会被该快照中的世界替换（未保存的进度会丢失），模拟会自动暂停。",
      tone: "danger",
      confirmText: "恢复快照",
    });
    if (!ok) return;
    simulationStore.restoreSnapshot(snapshotId);
    setComparison(null);
  }

  async function branch(snapshotId: string, name: string) {
    const ok = await confirm({
      title: `从「${name}」建立分支世界？`,
      message:
        "当前世界会被该快照的分支替换（当前未保存的进度会丢失），分支会作为新快照加入列表，并与原快照独立演化。",
      tone: "danger",
      confirmText: "建立分支并切换",
    });
    if (!ok) return;
    simulationStore.branchSnapshot(snapshotId);
    setComparison(null);
  }

  async function remove(snapshotId: string, name: string) {
    const ok = await confirm({
      title: `删除快照「${name}」？`,
      message: "快照及其完整世界数据会从浏览器中删除，不可恢复。",
      tone: "danger",
      confirmText: "删除快照",
    });
    if (!ok) return;
    simulationStore.deleteSnapshot(snapshotId);
    if (compareA === snapshotId) {
      setCompareA(snapshots.find((snapshot) => snapshot.id !== snapshotId)?.id ?? "");
    }
    if (compareB === snapshotId) setCompareB("current");
  }

  function runCompare() {
    if (!targetA) {
      setCompareError("请至少先捕获一个快照。");
      return;
    }
    setCompareError(null);
    if (compareB === "current") {
      setComparison(simulationStore.compareSnapshotWithCurrent(targetA));
    } else if (compareB === targetA) {
      setCompareError("请选择两个不同的快照进行比较。");
      setComparison(null);
    } else {
      setComparison(simulationStore.compareSnapshots(targetA, compareB));
    }
  }

  return (
    <div className="experiments-tab">
      <div className="experiments-columns">
        <section className="snapshots-panel">
          <header className="tab-toolbar">
            <div className="tab-toolbar-title">
              <h5>平行世界快照</h5>
              <span className="muted mono">
                {snapshots.length} / 10
              </span>
            </div>
          </header>
          <div className="capture-form">
            <TextField
              label="快照名称（可选）"
              value={snapshotName}
              onChange={setSnapshotName}
              maxLength={60}
              placeholder={`第 ${world.clock.day} 天 ${formatClock(world.clock.minuteOfDay)} 快照`}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={snapshots.length >= 10}
              title={snapshots.length >= 10 ? "快照数量已达上限（10），请先删除旧快照" : "捕获当前世界的完整快照"}
              onClick={capture}
            >
              捕获当前世界
            </button>
          </div>
          <div className="snapshot-list">
            {snapshots.length === 0 ? (
              <EmptyHint>还没有快照。捕获快照后可以恢复、建立分支或进行平行世界比较。</EmptyHint>
            ) : null}
            {snapshots.map((snapshot) => (
              <article className="snapshot-card" key={snapshot.id}>
                <header className="snapshot-head">
                  <span className="snapshot-name">{snapshot.name}</span>
                  {snapshot.branchOf ? <span className="tag tag-purple">分支</span> : null}
                </header>
                <div className="snapshot-meta mono">
                  D{snapshot.day} · tick {snapshot.tick} · 人口 {snapshot.population} · 规则 v{snapshot.ruleVersion}
                </div>
                <div className="snapshot-metrics">
                  <span>稳定 {Math.round(snapshot.metrics.stability)}</span>
                  <span>污染 {Math.round(snapshot.metrics.pollution)}</span>
                  <span>信任 {Math.round(snapshot.metrics.trust)}</span>
                  <span>情绪 {Math.round(snapshot.metrics.averageMood)}</span>
                </div>
                <div className="snapshot-saved muted">{new Date(snapshot.savedAt).toLocaleString("zh-CN")}</div>
                <div className="snapshot-actions">
                  <button type="button" className="btn btn-tiny btn-ghost" onClick={() => setCompareA(snapshot.id)} title="设为比较 A">
                    {compareA === snapshot.id ? "已选 A" : "选为 A"}
                  </button>
                  <button type="button" className="btn btn-tiny btn-primary" onClick={() => void restore(snapshot.id, snapshot.name)}>
                    恢复
                  </button>
                  <button type="button" className="btn btn-tiny btn-ghost" onClick={() => void branch(snapshot.id, snapshot.name)}>
                    分支
                  </button>
                  <button type="button" className="btn btn-tiny btn-danger" onClick={() => void remove(snapshot.id, snapshot.name)}>
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="compare-panel">
          <header className="tab-toolbar">
            <div className="tab-toolbar-title">
              <h5>平行世界比较</h5>
            </div>
          </header>
          <div className="compare-controls">
            <label className="compare-select">
              <span>快照 A</span>
              <select value={targetA} onChange={(event) => setCompareA(event.target.value)}>
                {snapshots.length === 0 ? <option value="">（无快照）</option> : null}
                {snapshots.map((snapshot) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {snapshot.name} · D{snapshot.day}
                  </option>
                ))}
              </select>
            </label>
            <label className="compare-select">
              <span>对比对象 B</span>
              <select value={compareB} onChange={(event) => setCompareB(event.target.value)}>
                <option value="current">当前世界</option>
                {snapshots
                  .filter((snapshot) => snapshot.id !== targetA)
                  .map((snapshot) => (
                    <option key={snapshot.id} value={snapshot.id}>
                      {snapshot.name} · D{snapshot.day}
                    </option>
                  ))}
              </select>
            </label>
            <button type="button" className="btn btn-primary" onClick={runCompare}>
              比较
            </button>
          </div>
          {compareError ? <p className="form-error">{compareError}</p> : null}

          {comparison ? (
            <div className="compare-result">
              <div className="compare-head">
                <span className="mono">{comparison.a.name}</span>
                <span className="muted">A → B</span>
                <span className="mono">{comparison.b.name}</span>
              </div>
              <div className="compare-metrics">
                {COMPARE_METRICS.map((metric) => {
                  const valueA = comparison.a.metrics[metric.key];
                  const valueB = comparison.b.metrics[metric.key];
                  const delta = comparison.metricDelta[metric.key];
                  return (
                    <div className="compare-metric-row" key={metric.key}>
                      <span className="compare-metric-label">{metric.label}</span>
                      <span className="mono muted">{Math.round(valueA * 10) / 10}</span>
                      <span className="mono">{Math.round(valueB * 10) / 10}</span>
                      <span className={cx("mono compare-delta", deltaClass(delta, metric.higherIsBetter))}>
                        {formatSigned(delta, 1)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="compare-columns">
                <div>
                  <h6 className="editor-title">财富变化（前 5）</h6>
                  {comparison.biggestWealthShifts.length === 0 ? (
                    <p className="muted">没有可比较的居民财富数据。</p>
                  ) : (
                    <table className="mini-table">
                      <thead>
                        <tr>
                          <th>居民</th>
                          <th>A</th>
                          <th>B</th>
                          <th>Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.biggestWealthShifts.slice(0, 5).map((shift) => (
                          <tr key={shift.name}>
                            <td>{shift.name}</td>
                            <td className="mono">{formatMoney(shift.a)}</td>
                            <td className="mono">{formatMoney(shift.b)}</td>
                            <td className={cx("mono", deltaClass(shift.delta, true))}>{formatSigned(shift.delta, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div>
                  <h6 className="editor-title">条件差异</h6>
                  <div className="compare-conditions">
                    <div className="ov-kv">
                      <span>规则版本</span>
                      <span className="mono">
                        v{comparison.conditions.ruleVersionA} → v{comparison.conditions.ruleVersionB}
                      </span>
                    </div>
                    <div className="ov-kv">
                      <span>天气</span>
                      <span>
                        {weatherName(comparison.conditions.weatherA)} → {weatherName(comparison.conditions.weatherB)}
                      </span>
                    </div>
                    <div className="ov-kv">
                      <span>事件总数</span>
                      <span className="mono">
                        {comparison.eventCount.a} → {comparison.eventCount.b}
                      </span>
                    </div>
                    {ruleDiff(comparison.conditions.rulesA, comparison.conditions.rulesB)
                      .slice(0, 6)
                      .map((diff) => (
                        <div className="ov-kv" key={diff.label}>
                          <span>{diff.label}</span>
                          <span className="mono">
                            {diff.a} → {diff.b}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              <div>
                <h6 className="editor-title">关系类型变化（前 8）</h6>
                {comparison.relationshipChanges.length === 0 ? (
                  <p className="muted">没有关系类型发生变化。</p>
                ) : (
                  <ul className="relationship-changes">
                    {comparison.relationshipChanges.slice(0, 8).map((change) => (
                      <li key={`${change.pair}-${change.a}-${change.b}`}>
                        <span>{change.pair}</span>
                        <span className="mono muted">
                          {change.a} → {change.b}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <EmptyHint>选择快照 A 与对比对象 B，然后点击「比较」查看指标、财富、关系与规则差异。</EmptyHint>
          )}
        </section>
      </div>
    </div>
  );
}
