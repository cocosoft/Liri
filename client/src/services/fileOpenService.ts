import { getBackendBaseUrl, getApiSecret } from "./backendUrl";

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

/**
 * fileOpenService — 本地文件"系统打开"统一入口（R5 引用锚点复用）
 *
 * 桌面（Tauri）：@tauri-apps/plugin-shell open(path)
 * Web/浏览器：GET {backend}/api/file/open?path=（后端白名单校验 + 系统 open）
 */
export async function openLocalFile(filePath: string): Promise<void> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(filePath);
    return;
  }
  const baseUrl = getBackendBaseUrl();
  const encodedPath = encodeURIComponent(filePath);
  const secret = getApiSecret();
  const headers: Record<string, string> = secret ? { "X-API-Key": secret } : {};
  const resp = await fetch(`${baseUrl}/api/file/open?path=${encodedPath}`, {
    headers,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}
