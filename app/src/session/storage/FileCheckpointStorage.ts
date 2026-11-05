/**
 * @owner session（2026-10-01 由 `query/` 下沉：其唯一 app 耦合 `chat/types/checkpoint`
 * 随 B11 迁入 `session/types/checkpoint`(service) 而消失；原 owner 注释为 chat/ChatManager）
 *
 * 文件系统检查点存储
 * 将 SessionCheckpoint 持久化到磁盘 JSON 文件
 * 实现 session/types/checkpoint.CheckpointStorage 接口，可注入到 SessionCheckpointService
 * 存储路径遵循文件存储规范第二层：~/.pyapp/data/checkpoints/
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveDataDir } from '@openliri/infra/environment';
import type {
  SessionCheckpoint,
  CheckpointStorage,
} from '@modules/session/types/checkpoint.js';
import { CHECKPOINT_MAX_AUTO } from '@modules/session/types/checkpoint.js';
import { getLogger } from '@openliri/infra/monitoring';
import {
  MS_PER_MINUTE,
  FS_UNLINK_RETRY_BASE_DELAY_MS,
} from '@openliri/infra/constants';
import { LogThrottle } from '@openliri/infra/monitoring/logs/LogThrottle';
const logger = getLogger('session:fileCheckpointStorage');

const CHECKPOINT_DIR_DEFAULT = 'checkpoints';

/**
 * P2-1（2026-11-04）：淘汰日志的**放行间隔**（按会话）。
 *
 * 实测单窗口 `Enforced max checkpoints per session` **901 条** —— 根因是每次写入都在上限上
 * 淘汰一个（checkpoint 策略问题，不属日志面），但"每次都打"本身让这条**唯一信号**淹没在
 * 日志里。这里按会话每分钟放行一次（被压条数随下一条带出）：信号保留、条数受控，
 * 不降级、不掩盖（降级才会让"持续淘汰"彻底不可见）。
 */
const CHECKPOINT_EVICT_LOG_MIN_INTERVAL = MS_PER_MINUTE;
const evictLogThrottle = new LogThrottle({
  windowMs: CHECKPOINT_EVICT_LOG_MIN_INTERVAL,
});

/** 仅测试用：重置淘汰日志的限流窗口（模块级状态，避免用例间互相压制） */
export function resetCheckpointEvictLogThrottleForTest(): void {
  evictLogThrottle.reset();
}

/**
 * Windows 下检查点文件可能被 AV / 残留句柄短暂占用（`EPERM` / `EBUSY`）⇒ 删除失败。
 * 实测日志 `session:fileCheckpointStorage|Failed to delete checkpoint` 即此形态：
 * 一次失败就永久残留，直到（若有的）过期清理再撞同一把锁。
 *
 * 处置：有界重试（3 次、50/100ms 退避）+ 成功恢复留 info + 终态失败带 `attempts`。
 * `ENOENT` 视为"已被并发删除"= 成功，不做无意义重试。
 */
export const CHECKPOINT_UNLINK_MAX_ATTEMPTS = 3;

export async function unlinkCheckpointFileWithRetry(
  target: string,
  unlink: (filePath: string) => Promise<void> = (filePath) =>
    fs.promises.unlink(filePath)
): Promise<number> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CHECKPOINT_UNLINK_MAX_ATTEMPTS; attempt++) {
    try {
      await unlink(target);
      if (attempt > 1) {
        logger.info('checkpoint:unlink_retry_recovered', {
          target,
          attempts: attempt,
        });
      }
      return attempt;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return attempt;
      lastError = err;
      if (attempt < CHECKPOINT_UNLINK_MAX_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, FS_UNLINK_RETRY_BASE_DELAY_MS * attempt)
        );
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('unlink_failed');
}

export class FileCheckpointStorage implements CheckpointStorage {
  private storageDir: string;
  /**
   * 每会话的检查点索引（A4，2026-11-05）——把「每次写入都重扫目录 + 读全部文件」
   * 改为「首次按需扫描一次，之后随写入增量维护」。
   *
   * 真机证据：单窗口 `Enforced max checkpoints per session` 901 次，而每次淘汰都要
   * 3 次 `readdir` + 读取上限内全部 JSON（~50 个）⇒ 数万次无谓文件读。
   * 索引是**可重建缓存**（非跨重启状态）：`deleteSessionCheckpoints` / `cleanup` 时失效，
   * 失效后下一次写入重新做一次权威扫描。
   */
  private readonly sessionIndex = new Map<
    string,
    Map<string, { createdAt: number; autoCreated: boolean }>
  >();

  constructor(storageDir?: string) {
    if (storageDir) {
      this.storageDir = path.resolve(storageDir);
    } else {
      this.storageDir = path.join(resolveDataDir(), CHECKPOINT_DIR_DEFAULT);
    }
    this.ensureDir();
  }

  /** 确保存储目录存在 */
  private ensureDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  getStorageDir(): string {
    return this.storageDir;
  }

  /** 生成检查点文件名 */
  private filePath(checkpoint: SessionCheckpoint): string {
    return this.filePathFor(checkpoint.sessionId, checkpoint.id);
  }

  private filePathFor(sessionId: string, checkpointId: string): string {
    return path.join(
      this.storageDir,
      `checkpoint-${sessionId}-${checkpointId}.json`
    );
  }

  /** 保存检查点到 JSON 文件 */
  async saveCheckpoint(checkpoint: SessionCheckpoint): Promise<void> {
    this.ensureDir();
    const fp = this.filePath(checkpoint);
    const data = JSON.stringify(checkpoint, null, 2);
    await fs.promises.writeFile(fp, data, 'utf-8');
    await this.enforceMaxCheckpoints(checkpoint);
  }

  /**
   * 限制每会话自动检查点数量（对齐 CheckpointDatabase.enforceMaxCheckpoints），
   * 防止文件检查点无限累积（曾造成 12GB 级堆积）。
   * 仅清理自动创建的检查点（autoCreated），保留手动/显式检查点；最旧优先删除。
   *
   * A4（2026-11-05）：**按需触发** —— 首次为某会话建立索引时扫描一次目录，
   * 之后随写入增量维护；超限时按索引直接 `unlink` 目标路径，不再每写一次就
   * `readdir` + 读取全部检查点文件。
   */
  private async enforceMaxCheckpoints(
    checkpoint: SessionCheckpoint
  ): Promise<void> {
    const { sessionId } = checkpoint;
    try {
      let entries = this.sessionIndex.get(sessionId);
      if (!entries) {
        entries = new Map();
        for (const cp of await this.loadCheckpoints(sessionId)) {
          entries.set(cp.id, {
            createdAt: cp.createdAt,
            autoCreated: cp.autoCreated === true,
          });
        }
        this.sessionIndex.set(sessionId, entries);
      }
      entries.set(checkpoint.id, {
        createdAt: checkpoint.createdAt,
        autoCreated: checkpoint.autoCreated === true,
      });

      const overflow = entries.size - CHECKPOINT_MAX_AUTO;
      if (overflow <= 0) {
        return;
      }

      // 最旧的自动检查点优先淘汰（手动/显式检查点永不参与）
      const victims = [...entries.entries()]
        .filter(([, entry]) => entry.autoCreated)
        .sort((a, b) => a[1].createdAt - b[1].createdAt)
        .slice(0, overflow);

      for (const [victimId] of victims) {
        await unlinkCheckpointFileWithRetry(
          this.filePathFor(sessionId, victimId)
        );
        entries.delete(victimId);
      }

      if (victims.length > 0) {
        // P2-1：按会话限流（见 `CHECKPOINT_EVICT_LOG_MIN_INTERVAL`），信号不降级
        const decision = evictLogThrottle.tick(sessionId);
        if (decision.emit) {
          logger.info('Enforced max checkpoints per session', {
            sessionId,
            limit: CHECKPOINT_MAX_AUTO,
            removed: victims.length,
            ...(decision.suppressed > 0
              ? { suppressed: decision.suppressed }
              : {}),
          });
        }
      }
    } catch (e) {
      // 索引失效（例如外部按龄清理）⇒ 下次写入重新建立权威索引
      this.sessionIndex.delete(sessionId);
      logger.warn('Failed to enforce max checkpoints', {
        sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** 按 ID 加载单个检查点 */
  async loadCheckpoint(
    checkpointId: string
  ): Promise<SessionCheckpoint | null> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(
        `checkpoint-.+-${escapeRegex(checkpointId)}\\.json$`
      );
      const matched = files.find((f) => pattern.test(f));
      if (!matched) return null;

      const content = await fs.promises.readFile(
        path.join(this.storageDir, matched),
        'utf-8'
      );
      return JSON.parse(content) as SessionCheckpoint;
    } catch (loadErr) {
      // KB-CKPT-LOAD（2026-08-29）：检查点文件读取/解析失败静默 null → 恢复数据丢失
      logger.warn('检查点加载失败（loadCheckpoint）', {
        checkpointId,
        error: loadErr instanceof Error ? loadErr.message : String(loadErr),
      });
      return null;
    }
  }

  /** 按 sessionId 加载所有检查点（按创建时间倒序） */
  async loadCheckpoints(sessionId: string): Promise<SessionCheckpoint[]> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(
        `^checkpoint-${escapeRegex(sessionId)}-.+\\.json$`
      );
      const matched = files.filter((f) => pattern.test(f));
      if (matched.length === 0) return [];

      const checkpoints: SessionCheckpoint[] = [];
      for (const file of matched) {
        try {
          const content = await fs.promises.readFile(
            path.join(this.storageDir, file),
            'utf-8'
          );
          checkpoints.push(JSON.parse(content) as SessionCheckpoint);
        } catch (entryErr) {
          // KB-CKPT-ENTRY（2026-08-29）：单个检查点文件解析失败 → 该条静默丢弃
          logger.warn('检查点文件解析失败，跳过该条', {
            sessionId,
            error:
              entryErr instanceof Error ? entryErr.message : String(entryErr),
          });
          continue;
        }
      }

      return checkpoints.sort((a, b) => b.createdAt - a.createdAt);
    } catch (listErr) {
      // KB-CKPT-LIST（2026-08-29）：检查点列表加载失败静默 [] → 恢复状态丢失
      logger.warn('检查点列表加载失败', {
        sessionId,
        error: listErr instanceof Error ? listErr.message : String(listErr),
      });
      return [];
    }
  }

  /** 删除单个检查点 */
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    // 索引同步失效（找不到文件时也删：索引可能是陈旧项）
    for (const entries of this.sessionIndex.values()) {
      entries.delete(checkpointId);
    }
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(
        `checkpoint-.+-${escapeRegex(checkpointId)}\\.json$`
      );
      const matched = files.find((f) => pattern.test(f));
      if (!matched) return;

      await unlinkCheckpointFileWithRetry(path.join(this.storageDir, matched));
    } catch (err) {
      logger.warn('Failed to delete checkpoint', {
        checkpointId,
        error: err instanceof Error ? err.message : 'io_error',
        attempts: CHECKPOINT_UNLINK_MAX_ATTEMPTS,
      });
    }
  }

  /** 删除某 session 所有检查点 */
  async deleteSessionCheckpoints(sessionId: string): Promise<void> {
    // 索引整体失效（删除可能部分失败 ⇒ 下次写入重新做权威扫描）
    this.sessionIndex.delete(sessionId);
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(
        `^checkpoint-${escapeRegex(sessionId)}-.+\\.json$`
      );
      const matched = files.filter((f) => pattern.test(f));

      for (const file of matched) {
        try {
          await unlinkCheckpointFileWithRetry(path.join(this.storageDir, file));
        } catch (delErr) {
          // KB-CKPT-DEL-ENTRY（2026-08-29）：单文件删除失败静默 continue → 残留检查点
          logger.warn('删除检查点文件失败，跳过', {
            sessionId,
            file,
            error: delErr instanceof Error ? delErr.message : String(delErr),
          });
          continue;
        }
      }
    } catch {
      logger.warn('Failed to delete session checkpoints', {
        sessionId,
        error: 'io_error',
      });
    }
  }

  /** 获取某 session 检查点数量 */
  async getCheckpointCount(sessionId: string): Promise<number> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      const pattern = new RegExp(
        `^checkpoint-${escapeRegex(sessionId)}-.+\\.json$`
      );
      return files.filter((f) => pattern.test(f)).length;
    } catch (countErr) {
      // KB-CKPT-COUNT（2026-08-29）：计数失败静默 0 → 检查点数量失真
      logger.warn('检查点计数失败，按 0 处理', {
        sessionId,
        error: countErr instanceof Error ? countErr.message : String(countErr),
      });
      return 0;
    }
  }

  /** 获取最新检查点 */
  async getLatestCheckpoint(
    sessionId: string
  ): Promise<SessionCheckpoint | null> {
    const checkpoints = await this.loadCheckpoints(sessionId);
    return checkpoints.length > 0 ? checkpoints[0] : null;
  }

  /** 清理过期检查点 */
  async cleanup(expireTime: number): Promise<number> {
    // 按龄清理会绕过索引删文件 ⇒ 索引整体失效，下次写入重建
    this.sessionIndex.clear();
    try {
      const files = await fs.promises.readdir(this.storageDir);
      let count = 0;

      for (const file of files) {
        if (!file.startsWith('checkpoint-') || !file.endsWith('.json')) {
          continue;
        }
        try {
          const filePath = path.join(this.storageDir, file);
          const stat = await fs.promises.stat(filePath);
          if (stat.mtimeMs < expireTime) {
            await unlinkCheckpointFileWithRetry(filePath);
            count++;
          }
        } catch (cleanErr) {
          // KB-CKPT-CLEAN-ENTRY（2026-08-29）：单文件清理失败静默 continue → 残留检查点
          logger.warn('清理过期检查点失败，跳过', {
            file,
            error:
              cleanErr instanceof Error ? cleanErr.message : String(cleanErr),
          });
          continue;
        }
      }

      return count;
    } catch (cleanOuterErr) {
      // KB-CKPT-CLEAN（2026-08-29）：清理过程失败静默 0 → 过期检查点残留不可知
      logger.warn('清理过期检查点失败', {
        error:
          cleanOuterErr instanceof Error
            ? cleanOuterErr.message
            : String(cleanOuterErr),
      });
      return 0;
    }
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
