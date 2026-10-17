import { handleClientError } from "../utils/handleError";
import { LOCAL_HOST } from "./endpoints";

/**
 * 默认后端 HTTP 端口
 *
 * 前端所有引用后端默认端口的位置都应引用此常量，避免散落硬编码。
 *
 * **契约（硬编码治理 HD-P0-3 / 方案 §4.2 B1）**：与后端**真源** `app/src/core/ports.ts` 的
 * `DEFAULT_HTTP_PORT` 保持一致 —— 前端与后端是**两个部署单元**，物理上无法共享同一模块 ⇒
 * 由 `app/tests/contracts/crossDeploymentContract.test.ts` 做**同值契约测试**钉住
 * （改任一侧都会让该测试变红）。
 *
 * ⚠️ 原注释写的是"与后端 `app/src/main.ts` 保持一致"，**指向的不是真源**：`main.ts` 只是
 * 读取方，真源为 `core/ports.ts`（HD-P0-3 回仓取证时更正）。
 *
 * 注意：vite.config.ts 和测试脚本因构建期/独立运行约束，仍保留字面量。
 */
export const DEFAULT_BACKEND_PORT = 18990;

let _backendBase = `http://${LOCAL_HOST}:${DEFAULT_BACKEND_PORT}`;
let _port = DEFAULT_BACKEND_PORT;
let _apiSecret = "";

export function getBackendBaseUrl(): string {
  return _backendBase;
}

export function getBackendPort(): number {
  return _port;
}

export function getApiSecret(): string {
  return _apiSecret;
}

export function setBackendPort(port: number): void {
  _port = port;
  _backendBase = `http://${LOCAL_HOST}:${port}`;
}

export function setApiSecret(secret: string): void {
  _apiSecret = secret;
}

export async function initBackendUrlFromConfig(): Promise<void> {
  try {
    const { appConfigService } = await import("./appConfigService");
    const config = await appConfigService.get();
    setBackendPort(config.httpPort);
  } catch (e) {
    handleClientError(e, {
      module: "services:backendUrl",
      action: "initBackendUrlFromConfig",
    });
    // 使用默认值
  }
}
