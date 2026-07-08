// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话级已确认路径集合（方案 4 核心实现）
 *
 * 泛化自 ImageContextService.sessionImagePaths，
 * 维护"本次会话中通过工具调用已确认真实存在的路径"集合。
 * 用于方案 1 PathGuardService 校验 AI 文本输出中的路径引用。
 *
 * 维护策略：
 * - 归一化存储（Windows 统一小写，跨平台兼容）
 * - LRU 淘汰（MAX_SIZE=500，防长会话内存泄漏）
 * - Worktree 感知（切换时清理旧路径）
 * - glob/ls 目录批量注册（addDirectoryListing）
 */
import * as path from 'path';
import * as fs from 'fs/promises';

// ============================================================
// 类型
// ============================================================

export interface ConfirmedPathEntry {
  /** 归一化后的路径 */
  path: string;
  /** 确认时间戳 */
  confirmedAt: number;
  /** 文件元数据（用于失效检测） */
  stat: { size: number; mtimeMs: number };
  /** worktree 标识（bridge-<sessionId> 或 <slug>） */
  worktreeSlug?: string;
  /** worktree 根路径 */
  worktreeRoot?: string;
  /** 文件内容 SHA256（用于跨 worktree 路径匹配，按需计算） */
  contentHash?: string;
}

// ============================================================
// 工具函数
// ============================================================

function normalizeKey(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

// ============================================================
// 主类
// ============================================================

export class SessionConfirmedPaths {
  private paths = new Map<string, ConfirmedPathEntry>();
  private readonly MAX_SIZE = 500;

  /**
   * 添加已确认路径
   * @param rawPath 原始路径（可以是别名、相对路径）
   * @param worktreeContext worktree 上下文（可选）
   */
  add(rawPath: string, worktreeContext?: { slug: string; root: string }): void {
    const normalized = normalizeKey(rawPath);
    if (this.paths.size >= this.MAX_SIZE) {
      const oldest = [...this.paths.entries()].sort(
        (a, b) => a[1].confirmedAt - b[1].confirmedAt
      )[0];
      if (oldest) this.paths.delete(oldest[0]);
    }
    this.paths.set(normalized, {
      path: normalized,
      confirmedAt: Date.now(),
      stat: { size: 0, mtimeMs: 0 },
      worktreeSlug: worktreeContext?.slug,
      worktreeRoot: worktreeContext?.root,
    });
  }

  /**
   * 检查路径是否在已确认集合中
   */
  has(rawPath: string): boolean {
    return this.paths.has(normalizeKey(rawPath));
  }

  /**
   * 获取所有已确认路径（用于传递给 PathGuardService）
   */
  getConfirmedPaths(): Set<string> {
    return new Set(this.paths.keys());
  }

  /**
   * 获取路径数量
   */
  get size(): number {
    return this.paths.size;
  }

  /**
   * Worktree 切换时调用：清理旧 worktree 的所有确认路径
   * 避免 ghost path — 主仓库路径在 worktree 中物理路径变化后误判
   */
  onWorktreeSwitch(newSlug: string): void {
    const oldCount = this.paths.size;
    for (const [key, entry] of this.paths) {
      if (entry.worktreeSlug && entry.worktreeSlug !== newSlug) {
        this.paths.delete(key);
      }
    }
    const removed = oldCount - this.paths.size;
    if (removed > 0) {
      // Logger 引用在 PathGuardService 中使用，此处保持轻量
    }
  }

  /**
   * 将 glob/ls 确认的目录下文件批量纳入已确认集合
   *
   * 当 AI 通过 GlobTool 或 Bash ls 确认了某个目录后，
   * 该目录下的文件路径应自动加入，减少后续文本引用中不必要的磁盘 I/O
   */
  addDirectoryListing(dirPath: string, files: string[]): void {
    const normalizedDir = normalizeKey(dirPath);
    for (const file of files) {
      const fullPath = path.isAbsolute(file) ? file : path.join(dirPath, file);
      const fileDir = normalizeKey(path.dirname(fullPath));
      // 仅添加目录下的直接文件，不递归子目录
      if (fileDir === normalizedDir) {
        this.add(fullPath);
      }
    }
  }

  /**
   * 重新校验已确认路径（用于失效检测）
   * 文件被删除/mtime 变更后移出集合
   */
  async revalidate(): Promise<void> {
    for (const [key, entry] of this.paths) {
      try {
        const stat = await fs.stat(entry.path);
        if (stat.mtimeMs !== entry.stat.mtimeMs) {
          this.paths.delete(key);
        }
      } catch {
        this.paths.delete(key);
      }
    }
  }
}
