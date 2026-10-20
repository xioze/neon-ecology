const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("required project files exist", () => {
  for (const file of ["server.js", "package.json", "public/index.html", "public/styles.css", "public/app.js", ".env.example", "README.md"]) {
    assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
  }
});

test("API key is not embedded in client source", () => {
  const client = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.equal(client.includes("DEEPSEEK_API_KEY"), false);
  assert.equal(client.includes("Authorization: `Bearer"), false);
});

test("client contains safe action allowlist and save version", () => {
  const client = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(client, /"work", "trade", "share", "ally", "spread_rumor", "ask_help", "hoard"/);
  assert.match(client, /version: 1/);
});
