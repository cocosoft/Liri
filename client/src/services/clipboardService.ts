/**
 * clipboardService — 跨平台剪贴板图片读取服务
 *
 * 支持 Windows (PowerShell)、macOS (osascript)、Linux (xclip/wl-paste)
 * 参照 cc_code backend/utils/imagePaste.ts
 */

import { createLogger } from "@/utils/logger";
import { handleClientError } from "../utils/handleError";

const logger = createLogger("clipboardService");

/** 图片读取结果 */
export interface ClipboardImageResult {
  /** Base64 编码的图片数据 */
  base64: string;
  /** MIME 类型 */
  mimeType: string;
  /** 数据大小（字节） */
  size: number;
}

/**
 * 从系统剪贴板读取图片
 * @returns 图片数据，无图片时返回 null
 */
export async function readImageFromClipboard(): Promise<ClipboardImageResult | null> {
  try {
    const platform = getPlatform();
    let base64: string | null = null;
    let mimeType = "image/png";

    switch (platform) {
      case "windows":
        base64 = await readFromWindows();
        break;
      case "macos":
        base64 = await readFromMacOS();
        break;
      case "linux":
        base64 = await readFromLinux();
        break;
      default:
        logger.warn("不支持的平台:", platform);
        return null;
    }

    if (!base64) return null;

    return {
      base64,
      mimeType,
      size: base64.length,
    };
  } catch (err) {
    handleClientError(err, { module: "services:clipboard", action: "readImageFromClipboard" });
    logger.warn("剪贴板读取失败:", err);
    return null;
  }
}

/**
 * 检查剪贴板中是否有图片
 */
export async function hasImageInClipboard(): Promise<boolean> {
  const result = await readImageFromClipboard();
  return result !== null && result.size > 0;
}

/** 获取当前平台标识 */
function getPlatform(): string {
  // Tauri 环境下使用 window.__TAURI__ 判断，否则用 navigator
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent || "";
    if (ua.includes("Win")) return "windows";
    if (ua.includes("Mac")) return "macos";
    if (ua.includes("Linux")) return "linux";
  }
  // 默认返回 Windows
  return "windows";
}

/** Windows: 使用 PowerShell Get-Clipboard */
async function readFromWindows(): Promise<string | null> {
  try {
    // PowerShell 脚本：读取剪贴板图片并转为 Base64
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $img = [System.Windows.Forms.Clipboard]::GetImage()
      if ($img) {
        $ms = New-Object System.IO.MemoryStream
        $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        [Convert]::ToBase64String($ms.ToArray())
        $ms.Close()
        $img.Dispose()
      }
    `;

    const cmd = `powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`;
    const result = await execCommand(cmd);
    if (result && result.trim()) {
      return result.trim();
    }
    return null;
  } catch (e) {
    handleClientError(e, { module: "services:clipboard", action: "readFromWindows" });
    return null;
  }
}

/** macOS: 使用 osascript 读取剪贴板 PNG 数据 */
async function readFromMacOS(): Promise<string | null> {
  try {
    // 方法 1: 直接获取 PNG 格式的剪贴板数据
    const script = `
      set pngData to (the clipboard as «class PNGf»)
      if pngData is not missing value then
        return pngData
      end if
    `;
    const result = await execCommand(
      `osascript -e '${script.replace(/'/g, "\\'")}'`,
    );
    if (result && result.trim() && !result.includes("missing value")) {
      return result.trim();
    }

    // 方法 2: 使用 pngpaste (如已安装)
    try {
      const pngResult = await execCommand(
        "pngpaste -b /dev/stdout 2>/dev/null | base64",
      );
      if (pngResult && pngResult.trim()) {
        return pngResult.trim();
      }
    } catch (e) {
      handleClientError(e, { module: "services:clipboard", action: "readFromMacOS-pngpaste" });
      // pngpaste 不可用，忽略
    }

    return null;
  } catch (e) {
    handleClientError(e, { module: "services:clipboard", action: "readFromMacOS" });
    return null;
  }
}

/** Linux: xclip (X11) 或 wl-paste (Wayland) */
async function readFromLinux(): Promise<string | null> {
  try {
    // 尝试 Wayland
    const waylandResult = await execCommand(
      "wl-paste --type image/png 2>/dev/null | base64 -w0",
    );
    if (waylandResult && waylandResult.trim()) {
      return waylandResult.trim();
    }
  } catch (e) {
    handleClientError(e, { module: "services:clipboard", action: "readFromLinux-wayland" });
    // Wayland 不可用
  }

  try {
    // 尝试 X11
    const xResult = await execCommand(
      "xclip -selection clipboard -t image/png -o 2>/dev/null | base64 -w0",
    );
    if (xResult && xResult.trim()) {
      return xResult.trim();
    }
  } catch (e) {
    handleClientError(e, { module: "services:clipboard", action: "readFromLinux-xclip" });
    // xclip 不可用
  }

  return null;
}

/**
 * 执行 shell 命令并返回 stdout
 * 在 Tauri 环境下使用 Tauri API，否则使用 child_process
 */
async function execCommand(cmd: string): Promise<string> {
  // 前端环境：通过后端 HTTP API 执行命令
  // 或使用 Tauri invoke
  try {
    // 使用 Tauri command invoke（如果在 Tauri 环境中）
    if (typeof window !== "undefined" && (window as any).__TAURI__) {
      const { invoke } = (window as any).__TAURI__.core;
      return (await invoke("exec_command", { command: cmd })) as string;
    }
  } catch (e) {
    handleClientError(e, { module: "services:clipboard", action: "execCommand-tauri" });
    // 非 Tauri 环境
  }

  // 回退：通过 fetch 调用后端 API
  try {
    const response = await fetch("/v1/system/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: cmd }),
    });
    if (response.ok) {
      const data = (await response.json()) as { output: string };
      return data.output || "";
    }
  } catch (e) {
    handleClientError(e, { module: "services:clipboard", action: "execCommand-fetch" });
    // API 不可用
  }

  return "";
}
