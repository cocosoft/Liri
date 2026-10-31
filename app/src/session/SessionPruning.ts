/**
 * 会话修剪策略
 * 按时间/大小自动修剪旧会话
 * 对齐 OpenClaw config/sessions/store-pruning.ts
 */

import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { existsSync, readdirSync, statSync, renameSync, mkdirSync } from 'fs';
import { join } from 'path';

const logger = getLogger('session:pruning');

export interface PruningConfig {
  sessionsDir: string;
  maxSessions: number;
  maxAgeDays: number;
  maxSizeMB: number;
  dryRun: boolean;
}

export interface PruningResult {
  sessionsPruned: number;
  bytesFreed: number;
  errors: string[];
  prunedSessions: string[];
}

import { resolveSessionsDir } from '@modules/environment';

const DEFAULT_PRUNING_CONFIG: PruningConfig = {
  sessionsDir: resolveSessionsDir(),
  maxSessions: 100,
  maxAgeDays: 90,
  maxSizeMB: 500,
  dryRun: false,
};

/**
 * 目录型会话的**真实**占用与最近活动时间（2026-10-31）。
 *
 * 缺陷（原实现直接 `statSync(dir)`）：Windows 上目录的 `st.size` 近乎为 0、`mtimeMs`
 * 只在**子项增删**时变化 ⇒ `maxSizeMB` 对目录型会话**永不触发**、`maxAgeDays` 也读不到
 * 「最后一次写消息」的时间。保留策略因此实际只有「按会话数」一档生效。
 */
function inspectSessionDir(dir: string): { size: number; mtimeMs: number } {
  let size = 0;
  let mtimeMs = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      // @ignore-catch — 单个子目录不可读（权限/瞬时锁）⇒ 跳过，不中断整轮扫描
      continue;
    }
    for (const name of entries) {
      if (name === '.trash') continue;
      const full = join(cur, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        // @ignore-catch — 扫描期间被外部删除（isExternallyDeleted 场景）⇒ 跳过
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      size += st.size;
      if (st.mtimeMs > mtimeMs) mtimeMs = st.mtimeMs;
    }
  }
  if (mtimeMs === 0) {
    // 空目录（或全部不可读）⇒ 退回目录自身时间，避免被判成"最旧"而误剪
    try {
      mtimeMs = statSync(dir).mtimeMs;
    } catch {
      // @ignore-catch — 目录已消失 ⇒ 保持 0，由调用方按最旧处理
    }
  }
  return { size, mtimeMs };
}

/** 缺省保留策略（与 `DataRetentionConfig` 头注逐项一致：默认不启用、启用后默认只演练） */
export const DEFAULT_DATA_RETENTION = {
  enabled: false,
  dryRun: true,
  maxSessions: 100,
  maxAgeDays: 90,
  maxSizeMB: 500,
} as const;

/**
 * `~/.pyapp/config.json` 的 `dataRetention` 段（2026-10-31，台账「数据保留策略」项）。
 *
 * 读取方：`app/scripts/prune-sessions.ts`（`bun run prune:sessions`）。
 *  - `enabled` 是**落盘联锁**：为 false 时 `--apply` 被拒绝（演练不受影响）；
 *  - `dryRun` 缺省 true（只报"将会删除哪些"，不动文件）；
 *  - 删除一律**软删除**（rename 到 `<sessionsDir>/.trash`），可人工恢复。
 *
 * ⚠️ 刻意**不**声明进 `GlobalConfig`（`config/types.ts`）：该文件在启动面静态图内，
 * 新增类型会让 `lint:startup-graph` 的字节棘轮只增不减而失败；ConfigManager 保存时
 * 以整份已加载对象回写（`saveGlobalConfig` → `atomicWriteConfig`），未知键不会被剥离。
 */
export interface DataRetentionConfig {
  /** 落盘联锁：false ⇒ `prune:sessions --apply` 被拒绝（演练不受影响） */
  enabled?: boolean;
  /** 只统计不移动（缺省 true；显式 false 才落盘） */
  dryRun?: boolean;
  /** 保留会话数上限（缺省 100） */
  maxSessions?: number;
  /** 保留天数上限（缺省 90） */
  maxAgeDays?: number;
  /** 会话目录总占用上限 MB（缺省 500） */
  maxSizeMB?: number;
}

/**
 * 由配置的 `dataRetention` 段构造修剪参数（2026-10-31）。
 *
 * 缺省安全取向：未配置 ⇒ `enabled=false`（**不自动**修剪）；启用后缺省 `dryRun=true`
 * （只统计，不移动文件）。`forceApply` 仅用于 CLI 显式 `--apply`。
 */
export function buildPruningConfig(params: {
  retention?: DataRetentionConfig | undefined;
  sessionsDir?: string;
  forceDryRun?: boolean;
  forceApply?: boolean;
}): PruningConfig {
  const r = { ...DEFAULT_DATA_RETENTION, ...(params.retention ?? {}) };
  const dryRun = params.forceApply ? false : (params.forceDryRun ?? r.dryRun);
  return {
    sessionsDir: params.sessionsDir ?? DEFAULT_PRUNING_CONFIG.sessionsDir,
    maxSessions: r.maxSessions,
    maxAgeDays: r.maxAgeDays,
    maxSizeMB: r.maxSizeMB,
    dryRun,
  };
}

export class SessionPruning {
  private config: PruningConfig;

  constructor(config: Partial<PruningConfig> = {}) {
    this.config = { ...DEFAULT_PRUNING_CONFIG, ...config };
  }

  async prune(): Promise<PruningResult> {
    const result: PruningResult = {
      sessionsPruned: 0,
      bytesFreed: 0,
      errors: [],
      prunedSessions: [],
    };

    if (!existsSync(this.config.sessionsDir)) {
      return result;
    }

    try {
      const now = Date.now();
      const maxAgeMs = this.config.maxAgeDays * 24 * 3600 * 1000;
      const maxSizeBytes = this.config.maxSizeMB * 1024 * 1024;

      // M5-fix: 兼容两种布局——
      //  旧布局：顶层 *.json/*.jsonl（会话文件散放）
      //  新布局：{sessionId}/session.json 子目录（修剪对象是目录）
      const items = readdirSync(this.config.sessionsDir)
        .map((name) => {
          const fullPath = join(this.config.sessionsDir, name);
          const st = statSync(fullPath);
          // 新布局：目录型会话（目录自身 size/mtime 不可信 ⇒ 递归实测）
          const isDirSession =
            st.isDirectory() && existsSync(join(fullPath, 'session.json'));
          // 旧布局：顶层会话文件
          const isLegacyFile =
            st.isFile() &&
            (name.endsWith('.json') ||
              name.endsWith('.jsonl') ||
              name.endsWith('.transcript.jsonl'));
          if (!isDirSession && !isLegacyFile) return null;
          const metrics = isDirSession
            ? inspectSessionDir(fullPath)
            : { size: st.size, mtimeMs: st.mtimeMs };
          return {
            name,
            path: fullPath,
            size: metrics.size,
            mtimeMs: metrics.mtimeMs,
          };
        })
        .filter((i): i is NonNullable<typeof i> => i !== null)
        .sort((a, b) => a.mtimeMs - b.mtimeMs); // 最旧的在前

      let totalSize = items.reduce((s, f) => s + f.size, 0);

      for (const item of items) {
        let shouldRemove = false;

        // 超龄
        if (item.mtimeMs < now - maxAgeMs) {
          shouldRemove = true;
        }
        // 数量超限
        if (items.length - result.sessionsPruned > this.config.maxSessions) {
          shouldRemove = true;
        }
        // 大小超限
        if (totalSize > maxSizeBytes) {
          shouldRemove = true;
        }

        if (shouldRemove) {
          if (!this.config.dryRun) {
            try {
              // M5-fix: 软删除 —— rename 到 .trash 而非物理删除（unlinkSync），
              // 保留误剪恢复路径，对齐新链软删除语义。
              const trashRoot = join(this.config.sessionsDir, '.trash');
              mkdirSync(trashRoot, { recursive: true });
              renameSync(
                item.path,
                join(trashRoot, `${item.name}-${Date.now()}`)
              );
            } catch (error) {
              result.errors.push(`${item.name}: ${String(error)}`);
              continue;
            }
          }
          result.sessionsPruned++;
          result.bytesFreed += item.size;
          result.prunedSessions.push(item.name);
          totalSize -= item.size;
        }
      }

      if (result.sessionsPruned > 0) {
        logger.info(
          `会话修剪完成: 移除 ${result.sessionsPruned} 个会话, 释放 ${(result.bytesFreed / 1024 / 1024).toFixed(2)} MB${this.config.dryRun ? ' (DRY-RUN)' : ''}`
        );
      }
    } catch (error) {
      result.errors.push(`修剪失败: ${String(error)}`);
      handleError(error, {
        module: 'sessions:pruning',
        action: '会话修剪失败',
      });
    }

    return result;
  }

  updateConfig(config: Partial<PruningConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
