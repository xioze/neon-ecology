# 架构说明

NEON//ECOLOGY 的核心目标不是“生成一段看起来像故事的文字”，而是让程序真实维护一个可复现的世界，再由居民互动自然产生故事。因此代码严格区分：

1. **世界事实**：`WorldState`（居民位置、资源、关系、记忆、建筑、势力、规则、随机数状态）。
2. **程序规则**：`src/sim/**`。所有事实变化必须经过它。
3. **AI 主观建议**：只作为居民决策的一条建议，不直接写数据库。
4. **叙事文字**：根据程序事实生成日志/面板文案；不得反向修改事实。

## 1. 分层

```text
┌──────────────────────────────────────────────────────────────┐
│ React UI / Creator Console / Inspector                       │
│ 只读 SimulationUiState；只调用 store 的公开方法              │
└───────────────┬──────────────────────────────────────────────┘
                │ state / commands
┌───────────────▼──────────────────────────────────────────────┐
│ SimulationStore（React 之外的单例）                          │
│ 固定时钟、暂停/倍速、选择、AI 调用调度、存档/快照、toast      │
└───────┬───────────────────────────────┬──────────────────────┘
        │ tickWorld()                   │ executeCommand()
┌───────▼───────────────────────────────▼──────────────────────┐
│ Deterministic Simulation Engine                              │
│ needs → decision → movement → action → relationships → goals  │
│ → metrics → factions → lifecycle → history → rngState         │
└───────────────┬──────────────────────────────────────────────┘
                │ JSON state / proposal context
        ┌───────▼────────┐                    ┌───────────────────────┐
        │ Zod save/schema │                    │ Express /api/status   │
        │ snapshots       │                    │ Express /api/ai/...   │
        └────────────────┘                    │ Zod request schema    │
                                              │ DeepSeek proposals    │
                                              └───────────────────────┘
```

## 2. 前端状态与渲染频率

- `simulationStore` 是唯一状态源，通过 `useSyncExternalStore` 暴露给 React。
- 一个 tick 默认 1.2 秒（1×），每次 tick 只触发一次 React 通知；不会在 60fps 渲染循环里更新 React 状态。
- 3D 场景通过 props/store 读取权威 `position`，在 `useFrame` 里对视觉对象做平滑插值。渲染层不决定移动目标、可通行性、行动结果。
- `WorldState` 是可变对象，但只有引擎/命令可以修改。UI 只读取；每次更新递增 `revision`，React 根据新快照重渲染。
- pause 时 store 停止计时；`stepOnce()` 只调用一次 `tickWorld()`（如果正在运行会先暂停）。
- 3D 使用 R3F 的普通 Mesh 组合表现建筑/居民；18 人与 20 建筑规模无需 InstancedMesh，保持选择/高亮简单可靠。规模扩大后再替换渲染实现，不必改模拟接口。

## 3. 固定步长与更新顺序

一个 tick = 30 模拟分钟；48 tick = 1 天。`tickWorld(world)` 的顺序：

1. 时钟推进（处理跨日）。
2. 若跨日：资源生产/消耗、商店补货、税收/福利、建筑维护与自动修复、居民衰老与自然死亡判定、目标期限复核、势力日收入、历史采样。
3. 天气到期/变化、天气与环境对污染/健康/安全感的影响。
4. 按 `world.residents` 稳定数组顺序，对每名存活且未暂停的居民：
   - 更新需求、压力、情绪、健康；
   - 若当前行动存在：沿路径移动 → 到门 → 进入建筑 → 执行行动 → 结算；
   - 否则自主决策：本地效用候选 + AI 建议（如有）+ 目标/日程/关系/资源约束；
   - 启动/进入新行动。
5. 每 3 tick 更新公众指标漂移；每 12 tick 执行势力规则；每 4 tick 记录历史。
6. 重算派生指标，写回显式 `rngState`。

随机性全部来自 `Rng`，状态存于 `WorldState.rngState`。因此：

- 相同初始种子 + 相同命令序列 + 相同 tick 数 → 相同世界状态；
- 存档/快照/分支携带 RNG 状态，不会因重新打开页面而改变后续命运；
- 快照比较能区分“规则/天气/行动差异”和随机噪声。

> 边界：`savedAt`、快照 ID、分支 worldId 等元数据使用系统时间/随机 ID，但它们不参与模拟推进，不影响居民未来状态。

## 4. 行动与合法性

行动统一由引擎执行：

- `CurrentAction` 包含 `phase`（moving/acting）、路径、目的地建筑/居民、开始/结束 tick、来源（local/ai/player/schedule）和简短原因。
- 建筑进入必须经过门前可通行瓦片；A* 不允许穿过非 `openAir` 建筑，不允许越过地图边界。
- 社会行动必须满足目标存在、相邻/同一建筑等条件；资源行动必须满足建筑、库存与资金/健康等条件。
- 失败的行动不会伪造成功：会记录失败结果，必要时回退到常规生活。
- `CurrentAction.source === "ai"` 只影响决策来源和日志，不会绕过任何合法性检查。

## 5. 居民模型与叙事

- 关系为**有方向**的记录：A 对 B 的 `affinity/trust/attraction/hostility` 与 B 对 A 可以不同。初始数据不是简单复制，互动也按双方性格、既有认知与经历非对称修改。
- 记忆分近期/重要/长期摘要，保留来源、可靠性、情绪、涉及人物和时间。传闻以 `told`、较低 `reliability` 保存，因此居民认知可以偏离事实。
- 人物印象是主观摘要（可能错误），不会覆盖客观事实。
- 目标有状态：active/completed/blocked/abandoned；短期目标会从需求自动生成，长期目标可被造物主创建；逾期目标会阻塞并触发替代方案，而不是永远停滞。
- 自然生育尚未实现；衰老、疾病、死亡及死亡带来的关系/记忆/财富后果已实现。

## 6. AI 决策链路

```text
每 rules.aiAdvisorFrequencyTicks（或玩家点击请求）
        │
        ▼
buildAiDecisionRequest(world, residentId)
  - 只发送该居民必要的状态、目标、记忆、关系、世界摘要
  - allowedActions：根据当前可用建筑/对象本地预筛
  - targets：最多 16 个白名单建筑/居民
        │ JSON（Zod schema 约束）
        ▼
POST /api/ai/decision
  - 请求 schema 校验
  - 服务端限流 / 超时 / 重试
  - DeepSeek → 严格 JSON 解析 → action/target/reason 校验
        │ proposal
        ▼
applyAiProposal()
  - 检查居民仍存在、行动在 allowedActions、目标在请求白名单
  - 写入 resident.aiHint（带过期 tick），不直接修改其他世界状态
        │ 下一次居民决策
        ▼
decideIntent() 读取 aiHint
  - 引擎重新检查所有前置条件
  - 正常启动/执行行动，来源标记为 ai，写入事件与决策理由
```

自动调用的频率来自世界规则（默认 48 tick；可在造物主规则编辑器修改，最低 12 tick）。手动按钮只影响被选中的居民。模型错误/超时/限流不会阻塞 tick，也不会破坏自动存档。

## 7. 存档、快照与分支

- 自动存档与手动存档使用 `SaveFile {schemaVersion, appVersion, savedAt, world}`，经 Zod + 语义校验后导入。
- 快照保存完整 `WorldState`（含居民记忆、关系、AI 建议、RNG 状态、规则版本、天气、历史），最多 10 个，存于浏览器 `localStorage`。
- 分支世界 = 克隆快照状态 + 新 `worldId` + 记录父快照；两个世界独立推进。
- 快照比较输出指标差、居民财富差、关系类型变化、事件数量与规则/天气条件，便于实验复盘。

## 8. 安全与性能边界

- API Key 只在 `server/config.ts` 读取；状态 API、响应、日志、构建产物不包含它。
- 前端没有 `eval`、动态函数、`dangerouslySetInnerHTML`；所有文本由 React 转义。
- 服务端对请求体大小、schema、行动/目标白名单、时间与频率做硬限制；未知字段被 Zod `.strict()` 拒绝。
- 引擎不依赖 AI；AI 层完全可拔除。
- 内置测试不调用真实 API；需要在线验证时由玩家手动触发，避免测试消耗额度。

## 9. 后续扩展点

- 将 `tickWorld` 移入 Web Worker 或服务端权威模拟：`WorldState` 和命令接口已与 UI 解耦，替换传输层即可。
- 大规模建筑/居民：保留 `Building`/`Resident` 权威数据结构，在 Three.js 侧切换 InstancedMesh + 自定义拾取。
- 自然出生/成长：新增生命事件和居民生成规则，但必须经过同一引擎校验与存档迁移。
- AI 组织领导者：新增组织决策上下文，沿用“提案 → 服务端 schema → 引擎执行”的安全链路。
- 长期人生摘要：可增加独立的、预算受限的摘要任务，只读取结构化记忆并把摘要作为新的“长期摘要”写入，不修改客观事实。
