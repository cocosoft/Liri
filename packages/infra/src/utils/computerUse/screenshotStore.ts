// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Computer Use 截图落盘 / 清理（2026-11-21，P1）
 *
 * **为什么不把 base64 放进工具结果**：一次全屏 PNG 的 base64 就有数百万字符，
 * 会瞬间撑爆上下文（实测把本轮 token 预算打满并触发压缩）。改为：
 *   ① 截图写临时文件 → 工具结果只返回**路径 + 尺寸 + 字节数**；
 *   ② 需要"看懂画面"时由 `analyze=true` 走视觉模型（只返回文字结论）。
 *
 * 目录按**会话隔离**（`<temp>/liri-computer-use/<session>/`），会话结束的 stop hook
 * 调用 {@link cleanupScreenshotFiles} 删除；路径里的会话 id 做白名单过滤，防目录穿越。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, basename } from 'node:path';

import { resolveTempDir } from '../../environment/paths';

/** 根目录名（放在系统临时目录下，随系统清理） */
const ROOT_DIR_NAME = 'liri-computer-use';

/** 会话目录名白名单（其余字符一律替换为 `_`） */
function safeSessionSegment(sessionId: string): string {
  const cleaned = String(sessionId ?? '').replace(/[^A-Za-z0-9_-]/g, '_');
  // 无 sessionId（工具在无会话上下文调用）⇒ 归入独立目录，避免与真实会话混放
  return cleaned || '__nosession__';
}

/** 某会话的截图目录（不存在则创建） */
export function resolveScreenshotDir(sessionId: string): string {
  const dir = join(resolveTempDir(), ROOT_DIR_NAME, safeSessionSegment(sessionId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** 落盘一张截图，返回文件绝对路径 */
export function saveScreenshotFile(
  sessionId: string,
  data: Buffer,
  format: 'jpeg' | 'jpg' | 'png'
): string {
  const ext = format === 'png' ? 'png' : 'jpg';
  const file = join(
    resolveScreenshotDir(sessionId),
    `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  );
  writeFileSync(file, data);
  return file;
}

/**
 * 删除某会话的全部截图（幂等）。
 * @returns 实际删除的文件数
 */
export function cleanupScreenshotFiles(sessionId: string): number {
  let removed = 0;
  try {
    const dir = resolveScreenshotDir(sessionId);
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      // 只删本模块产出的截图文件（防误删目录内其它内容）
      if (!/^shot-\d+-[a-z0-9]+\.(jpg|png)$/.test(basename(file))) continue;
      try {
        if (statSync(file).isFile()) {
          unlinkSync(file);
          removed++;
        }
      } catch {
        // 单文件删除失败不影响其余清理
      }
    }
  } catch {
    // 目录不存在 / 无权限 ⇒ 视为已清理
  }
  return removed;
}
