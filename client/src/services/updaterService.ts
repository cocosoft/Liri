/**
 * 客户端更新服务
 * 封装 Tauri updater 插件的检查、下载、安装流程
 */

import { check } from "@tauri-apps/plugin-updater";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { handleClientError } from "../utils/handleError";

export interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  body?: string;
}

/**
 * 检查是否在 Tauri 环境中
 */
function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  );
}

/**
 * 检查更新
 * @returns 更新检查结果
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  // 浏览器模式下直接返回无更新，不上报错误
  if (!isTauri()) {
    return { available: false, currentVersion: "" };
  }

  try {
    const update = await check();
    if (!update) {
      return { available: false, currentVersion: "" };
    }
    return {
      available: true,
      currentVersion: update.currentVersion,
      latestVersion: update.version,
      body: update.body,
    };
  } catch (e) {
    handleClientError(e, {
      module: "services:updater",
      action: "checkForUpdate",
    });
    return { available: false, currentVersion: "" };
  }
}

/**
 * 下载并安装更新
 * @param onProgress 下载进度回调
 */
export async function downloadAndInstall(
  onProgress?: (progress: {
    downloaded: number;
    total: number;
    percent: number;
  }) => void,
): Promise<void> {
  const update = await check();
  if (!update) {
    return;
  }

  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started" && event.data.contentLength) {
      onProgress?.({
        downloaded: 0,
        total: event.data.contentLength,
        percent: 0,
      });
    }
  });

  const shouldRelaunch = await ask("更新已完成，是否立即重启应用？", {
    title: "更新完成",
    kind: "info",
  });

  if (shouldRelaunch) {
    await relaunch();
  }
}
