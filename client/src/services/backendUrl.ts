import { handleClientError } from "../utils/handleError";

/**
 * 默认后端 HTTP 端口
 *
 * 前端所有引用后端默认端口的位置都应引用此常量，避免散落硬编码。
 * 与后端 app/src/main.ts 的默认端口保持一致。
 *
 * 注意：vite.config.ts 和测试脚本因构建期/独立运行约束，仍保留字面量。
 */
export const DEFAULT_BACKEND_PORT = 18990;

let _backendBase = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
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
  _backendBase = `http://127.0.0.1:${port}`;
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
