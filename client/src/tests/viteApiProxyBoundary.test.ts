/**
 * BUG-03（2026-10-22 前端巡检）：dev proxy 的 `/api` 必须做**路径边界**匹配
 *
 * 缺陷现场：Vite 的 proxy key 走字符串**前缀**匹配 ⇒ `"/api"` 会把前端路由
 * `/apikeys`（以及任何 `/api*` 开头的路由）转发到后端，dev 下直接访问/刷新
 * `/apikeys` 得到后端 404 JSON 而不是 SPA 的 index.html。
 *
 * 本文件是「配置棘轮」：只要有人把边界正则改回裸前缀（或删掉 `/v1` 代理），立即变红。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CONFIG_PATH = join(__dirname, "..", "..", "vite.config.ts");
const SOURCE = readFileSync(CONFIG_PATH, "utf-8");

describe("BUG-03：Vite dev proxy 边界", () => {
  it("`/api` 代理必须是边界正则，不能是裸前缀字符串", () => {
    // 允许： "^/api(/|$)" / '^/api(/|$)'
    expect(SOURCE).toMatch(/\^\/api\(\/\|\$\)/);
    // 禁止：以裸 "/api" 作为 key（`"/api":` / `'/api':`）
    expect(SOURCE).not.toMatch(/["']\/api["']\s*:/);
  });

  it("`/v1` 代理仍然存在（防止为修 /apikeys 误删后端主代理）", () => {
    expect(SOURCE).toMatch(/["']\/v1["']\s*:/);
  });
});
