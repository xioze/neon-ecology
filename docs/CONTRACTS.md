# NEON//ECOLOGY 开发契约

本文件冻结并行开发期间的模块边界。所有路径相对于项目根目录。

## 所有权

| 区域 | 负责人 | 文件 |
| --- | --- | --- |
| 模拟引擎、存档、状态管理 | Lead | `src/shared/**`, `src/sim/**`, `src/store/**`, 根配置 |
| 3D 场景 | scene-dev | `src/components/CityScene.tsx`, `src/components/scene/**`, `src/styles/scene.css` |
| UI 外壳与面板 | ui-dev | `src/main.tsx`, `src/App.tsx`, `src/components/TopBar.tsx`, `WorldSidebar.tsx`, `Inspector.tsx`, `panels/**`, `console/**`, `Toast.tsx`, `src/styles/base.css`, `src/styles/ui.css` |
| 服务端 / DeepSeek | server-dev | `server/**`, `tests/server.test.ts` |
| 引擎、导航、存档测试 | qa-dev | `tests/engine.test.ts`, `tests/navigation.test.ts`, `tests/save.test.ts`, `tests/setup.ts` |
| README、集成、最终验收 | Lead | `README.md`, `index.html`, `package.json`, `vite.config.ts` |

**不要修改所有权之外的文件。** 如果必须修改其他文件，先向 Lead 发消息说明理由。

## 前端状态 API

`src/store/useSimulation.ts` 导出：

```ts
simulationStore: SimulationStore
useSimulation(): SimulationUiState
```

UI 组件只通过这两个入口读写状态。核心字段见 `src/store/simulationStore.ts` 的 `SimulationUiState`。

常用动作：

```ts
simulationStore.start();                 // App 挂载时启动计时
simulationStore.stop();
simulationStore.togglePause();
simulationStore.setPaused(boolean);
simulationStore.stepOnce();              // 暂停时只推进 1 个 tick
simulationStore.setSpeed(1 | 2 | 4);
simulationStore.setMode("observe" | "intervene");
simulationStore.select({kind:"resident"|"building", id} | null);
simulationStore.setHovered(selection|null);
simulationStore.closeInspector();
simulationStore.setConsoleOpen(boolean);
simulationStore.setConsoleTab("overview"|"events"|"rules"|"residents"|"buildings"|"logs"|"saves"|"experiments");
simulationStore.runCommand(command);     // 观察模式下会被拒绝；返回 {ok,message,event?}
simulationStore.editResident(id, patch);
simulationStore.createResident(spec);
simulationStore.injectEvent(eventId);
simulationStore.saveLocal(); simulationStore.loadLocal();
simulationStore.exportWorldJson(); simulationStore.importWorldJson(raw);
simulationStore.captureSnapshot(name?); simulationStore.restoreSnapshot(id);
simulationStore.branchSnapshot(id); simulationStore.deleteSnapshot(id);
simulationStore.compareSnapshots(a,b); simulationStore.compareSnapshotWithCurrent(id);
simulationStore.refreshAiStatus(); simulationStore.requestAiForSelected();
simulationStore.setAiEnabled(boolean);
simulationStore.setPlacementType(type|null);
simulationStore.placeBuildingAt(tileX, tileZ);
simulationStore.newWorld({seed?, name?});
simulationStore.dismissToast();
```

`WorldCommand` 的完整联合类型和字段见 `src/sim/commands.ts`。`src/shared/types.ts` 是全部领域类型来源。

## 3D 场景契约

`src/components/CityScene.tsx` 必须导出：

```ts
export function CityScene(): JSX.Element
```

场景自我管理：

- 用 `useSimulation()` 读取 `world`、`selected`、`hovered`、`placement`。
- 左键点击居民/建筑：`simulationStore.select({kind,id})`。
- 悬停：`simulationStore.setHovered(...)`，离开时清空。
- 点击地面：清空选择；若 `placement.type` 非空，调用 `simulationStore.placeBuildingAt(tileX,tileZ)`。
- 场景内部通过 Three.js 世界坐标渲染；模拟数据坐标是 32×28 网格（见 `src/sim/city.ts` 的 `tileToWorld`、`MAP_WIDTH`、`MAP_DEPTH`、`TILE_SIZE`），**不要**自己改世界规则。
- 3D 必须显示道路、地面、公共空间、不同外观的建筑、可辨认居民、选中/悬停高亮。
- 居民方向与移动动画在渲染层平滑；模拟引擎的 `resident.position` 才是权威位置。
- 相机：OrbitControls 旋转/缩放/平移；提供跟随选中居民、重置视角、聚焦选中对象的 UI 控件。可以放在场景内左上角浮动控件，也可以由 App 的 TopBar 调用 `window` 事件；推荐在场景内小控件。
- 提供入口导航提示和放置模式提示。
- 性能：不要每个渲染帧调用 store 写操作；不要每帧 setState 整个 UI。居民视觉插值用 `useFrame` + ref。建筑用 memo 组件。
- 场景 CSS 放在 `src/styles/scene.css`，类名以 `scene-` 开头。

## UI 契约

`src/App.tsx` 组合（export default App）：

```tsx
<TopBar />
<WorldSidebar />
<main className="viewport"><CityScene /></main>
<Inspector />          // selection 不为 null 时显示
<CreatorConsole />     // 可折叠底部/侧边控制台
<Toast />
```

- `src/main.tsx` 挂载 App，并在 `useEffect` 中 `simulationStore.start()`、卸载 `stop()`。
- 中文界面，深色赛博朋克（青绿 #5af2d0 / 洋红 #ff4fa3 / 紫 #a48aff）。
- 布局适用于 1366×768 至 2560×1440；3D 城市是视觉主体，侧栏/控制台可折叠。
- 所有用户输入使用受控组件；不可使用 `dangerouslySetInnerHTML`。
- 不可逆操作（删除居民、拆除建筑、重置世界、恢复快照）必须二次确认（window.confirm 可以接受，但自定义确认框更佳）。
- 干预模式下才允许显示编辑表单；观察模式显示只读信息。
- 每个面板都必须反映 `SimulationUiState` 实际数据，并调用真实 store 方法。
- 关键组件：TopBar（时间/暂停/单步/倍速/AI 状态/模式切换）；WorldSidebar（城市指标、资源、势力、居民列表、简讯）；Inspector（居民/建筑详情，完整字段与编辑）；CreatorConsole（8 个 tab：总览、事件注入、规则、居民编辑、建筑编辑、日志、存档、实验）。日志支持关键字搜索和类型筛选。
- 可用性：详情打开时右侧面板 360–420px；控制台底部 300–400px 高，折叠后保留把手。面板滚动，不遮挡整座城市。

## 服务端 API 契约

`server/index.ts` 导出 `createApp()`，`server/app.ts` 或同等模块实现 app，供测试直接使用。生产 `tsx server/index.ts` 监听 `PORT` 并静态服务 `dist/`。

### GET /api/status

```json
{
  "mode": "online-ready",
  "model": "deepseek-chat",
  "ai": {
    "enabled": true,
    "hourlyLimit": 48,
    "calls": 3,
    "failures": 1,
    "rejected": 0,
    "lastError": null,
    "lastLatencyMs": 812,
    "minIntervalMs": 1800,
    "timeoutMs": 15000
  }
}
```

无 Key 时 `mode: "offline"`；绝不返回 Key。

### POST /api/ai/decision

请求使用 `src/shared/ai.ts` 的 `aiDecisionRequestSchema`。响应：

```json
{"ok":true,"proposal":{"action":"talk","targetId":"r_linlan","reason":"..."},
 "meta":{"model":"deepseek-chat","latencyMs":900,"retried":false,"source":"deepseek","requestId":"..."}}
```

错误响应：

```json
{"ok":false,"error":"中文可读错误","code":"AI_INVALID_PROPOSAL"}
```

必须实现：请求 zod 校验、行动白名单、目标白名单、超时、重试上限、按小时/最小间隔限流、无 Key 503、上游错误 502、请求体大小限制、AI 返回 JSON 解析失败安全拒绝、**任何日志/status 不出现 API Key**。服务端只返回提案，不执行世界变更。

## 验收命令

```bash
npm run typecheck
npm test
npm run build
```

最终 Lead 会跑 `npm start` 并用真实浏览器验证首屏、点击选择、时间暂停/单步、AI 离线状态。
