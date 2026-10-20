/**
 * Real-browser acceptance smoke test for NEON//ECOLOGY.
 *
 *   npm run build && npm start   (or any server on :3000)
 *   npm run test:browser
 *
 * It uses the locally installed Chrome via playwright-core (no browser
 * download). The world is seeded deterministically through an injected save so
 * the 3D selection targets are stable, and automatic AI is disabled during the
 * test so no real DeepSeek quota is spent.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { createInitialWorld } from "../src/sim/data";
import { tickWorld } from "../src/sim/engine";
import { createSaveFile } from "../src/sim/save";

const BASE_URL = process.env.NEON_URL ?? "http://127.0.0.1:3000";
const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SCREENSHOT_DIR = path.resolve(".screenshots");
await mkdir(SCREENSHOT_DIR, { recursive: true });

// A deterministic world with one resident placed in the open-air park. The park
// has no tall building volume, so a real 3D click at screen centre is reliable.
const world = createInitialWorld({
  seed: 20261020,
  createdAtIso: "2026-10-20T00:00:00.000Z",
});
for (let i = 0; i < 2; i++) tickWorld(world);
const targetResident = world.residents.find((resident) => resident.id === "r_tang");
assert.ok(targetResident, "deterministic fixture must contain 唐糖");
for (const resident of world.residents) {
  resident.paused = true;
  resident.currentAction = null;
}
targetResident.position = { x: 5, z: 25 };
targetResident.insideBuildingId = null;
targetResident.currentAction = null;
const saveJson = JSON.stringify(createSaveFile(world));

const pageErrors: string[] = [];
const consoleErrors: string[] = [];
const failedRequests: string[] = [];
const summary: Record<string, unknown> = {};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--hide-scrollbars",
  ],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.startsWith("data:")) failedRequests.push(`${request.failure()?.errorText ?? "failed"} ${url}`);
  });
  await page.addInitScript(
    ({ injectedSave }) => {
      try {
        localStorage.setItem("neon-ecology-save-v2", injectedSave);
        localStorage.setItem("neon-ecology-snapshots-v2", "[]");
        localStorage.setItem("neon-ecology-ai-enabled-v2", "0");
      } catch {
        // The origin may not be ready on the very first about:blank execution.
      }
    },
    { injectedSave: saveJson },
  );

  console.log("[browser] loading", BASE_URL);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector(".scene-canvas canvas", { timeout: 20_000 });
  await page.waitForSelector(".resident-row", { timeout: 20_000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".resident-row").length >= 10,
    null,
    { timeout: 20_000 },
  );
  // Give the first frame and labels time to render before we pause and inspect.
  await page.waitForTimeout(2200);

  const initialText = await page.locator("body").innerText();
  assert.match(initialText, /造物主控制台/);
  assert.match(initialText, /城市态势/);
  assert.match(initialText, /AI (在线|离线|等待|错误|已停用)/);

  const residentRows = await page.locator(".resident-row").count();
  assert.ok(residentRows >= 10, `expected >=10 resident rows, got ${residentRows}`);

  const webgl = await page.evaluate(() => {
    const canvas = document.querySelector(".scene-canvas canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  });
  assert.equal(webgl, true, "WebGL canvas context must be available");

  await page.locator(".btn-pause").click();
  await page.waitForTimeout(300);
  const pausedTick = (await page.locator(".clock-tick").innerText()).trim();
  const pausedClock = (await page.locator(".console-clock").innerText()).trim();
  await page.waitForTimeout(1400);
  assert.equal(
    (await page.locator(".clock-tick").innerText()).trim(),
    pausedTick,
    "simulation clock must not advance while paused",
  );
  summary.pausedTick = pausedTick;
  summary.pausedClock = pausedClock;
  summary.residentRows = residentRows;
  summary.webgl = webgl;

  // --- real 3D building click (initial isometric camera) -----------------
  let buildingTitle: string | null = null;
  for (const [x, y] of [
    [850, 400],
    [1050, 360],
    [700, 500],
    [1150, 470],
    [800, 520],
    [980, 500],
  ]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    if ((await page.locator(".inspector").count()) > 0) {
      buildingTitle = (await page.locator(".inspector-title").innerText()).trim();
      break;
    }
  }
  assert.ok(buildingTitle, "clicking a 3D building must open its inspector");
  const buildingText = await page.locator(".inspector").innerText();
  assert.match(buildingText, /容量|状况|库存|所有者/, "building inspector should show real fields");
  summary.building = buildingTitle;
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "browser-01-building.png") });
  await page.locator(".inspector-close").click();
  await page.waitForTimeout(250);

  // --- sidebar resident inspector ---------------------------------------
  const targetRow = page
    .locator(".resident-row")
    .filter({ hasText: targetResident.name })
    .first();
  await targetRow.click();
  await page.waitForSelector(".inspector", { timeout: 5_000 });
  assert.equal(
    (await page.locator(".inspector-title").innerText()).trim(),
    targetResident.name,
    "resident inspector must show the clicked resident",
  );
  const residentText = await page.locator(".inspector").innerText();
  assert.match(residentText, /目标|长期|短期/, "resident inspector should show goals");
  assert.match(residentText, /记忆/, "resident inspector should show memories");
  summary.resident = targetResident.name;

  // --- focus the selected resident, then click them in 3D ---------------
  const focusButton = page.locator(".scene-hud button").filter({ hasText: "聚焦选中" });
  await focusButton.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "browser-02-resident.png") });
  await page.locator(".inspector-close").click();
  await page.waitForTimeout(300);

  // Freeze rAF only after the camera tween has completed. Software-rendered
  // headless Chrome otherwise burns CPU; store logic and DOM stay responsive.
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  let sceneResident: string | null = null;
  for (const [x, y] of [
    [800, 500],
    [800, 470],
    [800, 530],
    [820, 500],
    [780, 500],
    [800, 450],
  ]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
    if ((await page.locator(".inspector").count()) === 0) continue;
    const title = (await page.locator(".inspector-title").innerText()).trim();
    if (title === targetResident.name) {
      sceneResident = title;
      break;
    }
    await page.locator(".inspector-close").click().catch(() => {});
    await page.waitForTimeout(120);
  }
  assert.equal(sceneResident, targetResident.name, "clicking the focused resident in 3D must open their inspector");
  summary.sceneResidentClick = sceneResident;
  await page.locator(".inspector-close").click().catch(() => {});
  await page.waitForTimeout(150);

  // --- single step exactly once -----------------------------------------
  await page
    .locator(".topbar-controls .btn")
    .filter({ hasText: "单步" })
    .click();
  await page.waitForTimeout(300);
  const steppedTick = (await page.locator(".clock-tick").innerText()).trim();
  assert.notEqual(steppedTick, pausedTick, "single-step must advance the simulation");
  summary.steppedTick = steppedTick;

  // --- AI status wiring without spending a real request ------------------
  await page
    .locator(".ai-actions button[title*='启用 AI']")
    .click({ timeout: 5_000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  summary.aiBadge = (await page.locator(".ai-badge").innerText()).replace(/\s+/g, " ").trim();

  // --- intervene mode + real event injection -----------------------------
  await page.locator(".seg-mode .seg-btn").filter({ hasText: "干预" }).click();
  await page.waitForTimeout(250);
  await page.locator(".console-tab").filter({ hasText: "事件注入" }).click();
  const eventCard = page.locator(".event-card").filter({ hasText: "停电" });
  await eventCard.getByRole("button", { name: "注入事件" }).click();
  await page.waitForTimeout(400);
  const eventFooter = await page.locator(".events-footer").innerText();
  assert.match(eventFooter, /造物主事件：停电/, "injected event must appear in the real event feed");
  summary.injectedEvent = "停电";

  // --- local save + snapshot comparison ----------------------------------
  await page.locator(".console-tab").filter({ hasText: "存档" }).click();
  await page.locator(".save-action").filter({ hasText: "保存到浏览器" }).click();
  await page.waitForTimeout(400);
  const saveExists = await page.evaluate(() =>
    Boolean(localStorage.getItem("neon-ecology-save-v2")),
  );
  assert.equal(saveExists, true, "saveLocal must write the versioned save key");
  summary.localSave = saveExists;

  await page.locator(".console-tab").filter({ hasText: "实验" }).click();
  await page.getByRole("button", { name: "捕获当前世界" }).click();
  await page.waitForTimeout(350);
  await page.locator(".snapshot-card").first().waitFor({ timeout: 5_000 });
  const snapshotCount = await page.locator(".snapshot-card").count();
  assert.ok(snapshotCount >= 1, "snapshot capture must create a snapshot card");
  await page.getByRole("button", { name: "比较", exact: true }).click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator(".compare-result").count()) >= 1, "snapshot comparison must render");
  summary.snapshots = snapshotCount;
  summary.comparison = true;

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "browser-03-console.png") });

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
  const fatalConsole = consoleErrors.filter(
    (message) =>
      !message.includes("favicon") &&
      !message.includes("WebGL") &&
      !message.includes("THREE.WebGLRenderer"),
  );
  assert.deepEqual(fatalConsole, [], `console errors: ${fatalConsole.join(" | ")}`);

  summary.pageErrors = pageErrors.length;
  summary.consoleErrors = fatalConsole.length;
  summary.failedRequests = failedRequests.length;
  summary.status = "PASS";
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  summary.status = "FAIL";
  summary.error = error instanceof Error ? error.message : String(error);
  summary.pageErrors = pageErrors;
  summary.consoleErrors = consoleErrors;
  summary.failedRequests = failedRequests;
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
