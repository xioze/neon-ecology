import { useState } from "react";
import type { CSSProperties } from "react";
import { RESOURCE_LABELS, RULES_BOUNDS, WEATHER_META } from "../../shared/constants";
import type { CityReserves, WeatherCondition, WorldRules } from "../../shared/types";
import { simulationStore, useSimulation } from "../../store/useSimulation";
import {
  cx,
  ObserveNotice,
  Tag,
  validateNumberRange,
} from "../ui";

type NumericRuleKey = Exclude<keyof WorldRules, "factionsActive">;

const NUMERIC_RULES: NumericRuleKey[] = (
  Object.keys(RULES_BOUNDS) as Array<keyof WorldRules>
).filter((key): key is NumericRuleKey => key !== "factionsActive");

const RESERVE_KEYS: Array<keyof CityReserves> = ["credits", "food", "energy", "meds"];

function scaleOf(key: NumericRuleKey): number {
  return key === "taxRate" ? 100 : 1;
}

function decimalsOf(key: NumericRuleKey): number {
  if (key === "taxRate") return 0;
  if (key === "aiAdvisorFrequencyTicks") return 0;
  return 2;
}

function displayValue(draft: WorldRules, key: NumericRuleKey): number {
  return draft[key] * scaleOf(key);
}

export function RulesTab() {
  const state = useSimulation();
  const { world, mode } = state;
  const editable = mode === "intervene";
  const [draft, setDraft] = useState<WorldRules>(() => ({ ...world.rules }));
  const [error, setError] = useState<string | null>(null);
  const [reserveDrafts, setReserveDrafts] = useState<Record<keyof CityReserves, string>>(() => ({
    credits: String(Math.round(world.reserves.credits)),
    food: String(Math.round(world.reserves.food)),
    energy: String(Math.round(world.reserves.energy)),
    meds: String(Math.round(world.reserves.meds)),
  }));
  const [reserveError, setReserveError] = useState<string | null>(null);

  const invalidKeys = NUMERIC_RULES.filter((key) => {
    const bounds = RULES_BOUNDS[key];
    const value = draft[key];
    return !Number.isFinite(value) || value < bounds.min || value > bounds.max;
  });

  function setRuleValue(key: NumericRuleKey, display: number) {
    if (!Number.isFinite(display)) return;
    const value = display / scaleOf(key);
    setDraft((previous) => {
      const next: WorldRules = { ...previous };
      next[key] = value;
      return next;
    });
  }

  function setRuleFromRaw(key: NumericRuleKey, raw: string) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    setRuleValue(key, parsed);
  }

  function submitRules() {
    const errors: string[] = [];
    const patch: Partial<WorldRules> = {};
    for (const key of NUMERIC_RULES) {
      const bounds = RULES_BOUNDS[key];
      const value = draft[key];
      if (!Number.isFinite(value)) {
        errors.push(`${bounds.label}必须是数字。`);
        continue;
      }
      if (value < bounds.min || value > bounds.max) {
        errors.push(`${bounds.label}必须在 ${bounds.min} 到 ${bounds.max} 之间。`);
        continue;
      }
      const normalized = key === "aiAdvisorFrequencyTicks" ? Math.round(value) : value;
      if (Math.abs(normalized - world.rules[key]) > 1e-9) patch[key] = normalized;
    }
    if (draft.factionsActive !== world.rules.factionsActive) {
      patch.factionsActive = draft.factionsActive;
    }
    if (errors.length > 0) {
      setError(errors[0] ?? "规则校验失败。");
      return;
    }
    if (Object.keys(patch).length === 0) {
      setError("没有规则被修改。调整滑块或输入框后再提交。");
      return;
    }
    const result = simulationStore.runCommand({ type: "update_rules", patch });
    if (result.ok) {
      setError(null);
      setDraft({ ...world.rules });
    } else {
      setError(result.message);
    }
  }

  function syncDraft() {
    setDraft({ ...world.rules });
    setError(null);
  }

  function applyReserve(key: keyof CityReserves) {
    const check = validateNumberRange(reserveDrafts[key], RESOURCE_LABELS[key], 0, 10_000_000);
    if (check.error) {
      setReserveError(check.error);
      return;
    }
    setReserveError(null);
    const result = simulationStore.runCommand({
      type: "set_reserves",
      key,
      value: check.value ?? 0,
    });
    if (!result.ok) setReserveError(result.message);
  }

  function syncReserves() {
    setReserveDrafts({
      credits: String(Math.round(world.reserves.credits)),
      food: String(Math.round(world.reserves.food)),
      energy: String(Math.round(world.reserves.energy)),
      meds: String(Math.round(world.reserves.meds)),
    });
    setReserveError(null);
  }

  return (
    <div className="rules-tab">
      {!editable ? <ObserveNotice>世界规则与天气只能以只读方式查看。切换到干预模式后可以提交规则。 </ObserveNotice> : null}
      <div className="rules-columns">
        <div className="rules-main">
          <header className="tab-toolbar">
            <div className="tab-toolbar-title">
              <h5>世界规则</h5>
              <Tag tone="purple">规则版本 v{world.ruleVersion}</Tag>
              {invalidKeys.length > 0 ? <Tag tone="bad">{invalidKeys.length} 项越界</Tag> : null}
            </div>
            <div className="tab-toolbar-actions">
              <button type="button" className="btn btn-ghost btn-tiny" onClick={syncDraft} title="丢弃未提交修改，从当前世界重新读取">
                ↺ 同步当前规则
              </button>
              <button type="button" className="btn btn-primary btn-tiny" disabled={!editable} onClick={submitRules}>
                提交规则
              </button>
            </div>
          </header>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="rule-list">
            {NUMERIC_RULES.map((key) => {
              const bounds = RULES_BOUNDS[key];
              const factor = scaleOf(key);
              const decimals = decimalsOf(key);
              const display = displayValue(draft, key);
              const invalid = invalidKeys.includes(key);
              return (
                <div className={cx("rule-row", invalid && "is-invalid")} key={key}>
                  <div className="rule-head">
                    <span className="rule-label">{bounds.label}</span>
                    <span className="rule-bounds mono">
                      {factor === 100 ? `${bounds.min * 100}–${bounds.max * 100}%` : `${bounds.min}–${bounds.max}${bounds.unit ?? ""}`}
                    </span>
                    <span className={cx("rule-value", "mono", invalid && "is-invalid")}>
                      {display.toFixed(decimals)}
                      {bounds.unit === "%" ? "%" : bounds.unit ?? ""}
                    </span>
                  </div>
                  <div className="rule-inputs">
                    <input
                      type="range"
                      min={bounds.min * factor}
                      max={bounds.max * factor}
                      step={bounds.step * factor}
                      value={Number.isFinite(display) ? display : bounds.min * factor}
                      disabled={!editable}
                      onChange={(event) => setRuleValue(key, Number(event.target.value))}
                      aria-label={bounds.label}
                    />
                    <input
                      type="number"
                      className="rule-number"
                      min={bounds.min * factor}
                      max={bounds.max * factor}
                      step={bounds.step * factor}
                      value={Number(display.toFixed(decimals))}
                      disabled={!editable}
                      onChange={(event) => setRuleFromRaw(key, event.target.value)}
                      aria-label={`${bounds.label}数值`}
                    />
                  </div>
                </div>
              );
            })}
            <div className="rule-row rule-toggle-row">
              <div className="rule-head">
                <span className="rule-label">{RULES_BOUNDS.factionsActive.label}</span>
                <span className="rule-bounds">开启后势力会消耗资源、调整影响力</span>
                <span className={cx("rule-value", "mono")}>{draft.factionsActive ? "开启" : "关闭"}</span>
              </div>
              <div className="rule-inputs">
                <button
                  type="button"
                  className={cx("btn", "btn-tiny", draft.factionsActive ? "btn-primary" : "btn-ghost")}
                  disabled={!editable}
                  onClick={() => setDraft({ ...draft, factionsActive: !draft.factionsActive })}
                >
                  {draft.factionsActive ? "关闭势力模拟" : "开启势力模拟"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="rules-side">
          <section className="side-block">
            <header className="side-block-head">
              <h5>天气</h5>
              <span className="muted">当前 {WEATHER_META[world.weather.condition].label}</span>
            </header>
            <div className="weather-grid">
              {(Object.keys(WEATHER_META) as WeatherCondition[]).map((condition) => {
                const meta = WEATHER_META[condition];
                const active = world.weather.condition === condition;
                return (
                  <button
                    key={condition}
                    type="button"
                    className={cx("weather-btn", active && "is-active")}
                    style={{ "--weather": meta.color } as CSSProperties}
                    disabled={!editable}
                    title={meta.description}
                    onClick={() =>
                      simulationStore.runCommand({
                        type: "set_weather",
                        condition,
                        intensity: 0.4,
                      })
                    }
                  >
                    <span aria-hidden="true">{meta.icon}</span>
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="side-block">
            <header className="side-block-head">
              <h5>公共资源</h5>
              <button type="button" className="link-btn" onClick={syncReserves}>
                同步当前
              </button>
            </header>
            <div className="reserve-edit-list">
              {RESERVE_KEYS.map((key) => (
                <div className="reserve-edit-row" key={key}>
                  <span className="reserve-edit-label">{RESOURCE_LABELS[key]}</span>
                  <span className="muted mono">当前 {Math.round(world.reserves[key])}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={reserveDrafts[key]}
                    disabled={!editable}
                    onChange={(event) =>
                      setReserveDrafts((previous) => ({ ...previous, [key]: event.target.value }))
                    }
                    aria-label={`${RESOURCE_LABELS[key]}储备`}
                  />
                  <button
                    type="button"
                    className="btn btn-tiny btn-primary"
                    disabled={!editable}
                    onClick={() => applyReserve(key)}
                  >
                    设为
                  </button>
                </div>
              ))}
            </div>
            {reserveError ? <p className="form-error">{reserveError}</p> : null}
          </section>

          <section className="side-block">
            <header className="side-block-head">
              <h5>规则说明</h5>
            </header>
            <ul className="rule-notes">
              <li>规则提交会重新计算派生指标，并写入一条「造物主改写世界规则」事件。</li>
              <li>越界数值会被前端阻止；即使绕过，引擎也会拒绝并返回中文错误。</li>
              <li>税额为比例（0–0.5），界面按百分比显示。</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
