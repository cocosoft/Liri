/**
 * ConnectionBanner（C7，2026-11-05）：全局「连接中断」横幅。
 *
 * 缺陷背景：`httpClient` 已有 `Failed to fetch` 退避重试，但失败后**没有任何全局提示**
 * （真机 15Z 窗口：前端上报 Failed to fetch 5 次 + socket 超时 2 次，用户侧无感）。
 *
 * 口径：横幅只做**呈现**，检测复用 `connectionMonitor` 状态机（/health 连续 3 次失败
 * ⇒ DISCONNECTED；浏览器 offline ⇒ OFFLINE），手动重试走同一 `tick()` 实现。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConnectionState } from "../services/connectionMonitor";
import { connectionBannerKind } from "../utils/connectionBannerState";

const readClient = (rel: string): string =>
  readFileSync(resolve(__dirname, rel), "utf-8");

describe("ConnectionBanner — 状态到横幅的映射", () => {
  it("CONNECTED / RECONNECTING ⇒ 不显示横幅", () => {
    expect(connectionBannerKind(ConnectionState.CONNECTED)).toBeNull();
    expect(connectionBannerKind(ConnectionState.RECONNECTING)).toBeNull();
  });

  it("OFFLINE ⇒ 网络断开提示；DISCONNECTED ⇒ 后端连接中断提示", () => {
    expect(connectionBannerKind(ConnectionState.OFFLINE)).toBe("offline");
    expect(connectionBannerKind(ConnectionState.DISCONNECTED)).toBe(
      "disconnected",
    );
  });
});

describe("ConnectionBanner — 接线", () => {
  it("挂在应用壳层（任意路由都能看到）", () => {
    const app = readClient("../App.tsx");
    expect(app).toContain("<ConnectionBanner />");
  });

  it("复用 connectionMonitor 状态机与手动重试，不新造检测", () => {
    const src = readClient("../components/common/ConnectionBanner.tsx");
    expect(src).toContain("connectionMonitor.subscribe");
    expect(src).toContain("connectionMonitor.recheckNow");
  });
});
