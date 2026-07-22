import { handleClientError } from "../utils/handleError";

let _backendBase = "http://127.0.0.1:7890";
let _port = 7890;
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
      handleClientError(e, { module: "services:backendUrl", action: "initBackendUrlFromConfig" });
      // 使用默认值 7890
    }
}
