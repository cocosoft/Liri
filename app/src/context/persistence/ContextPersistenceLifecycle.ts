/**
 * ContextPersistLifecycle -- 上下文持久化生命周期（Phase 2.7 + Phase 2.25）
 *
 * 管理 ContextStore 的序列化/反序列化，在应用启动时恢复、关闭时保存。
 * Phase 2.25: 优先使用 SQLite (app.db)，JSONL 作为 fallback + 迁移源。
 */
import { contextStore, type ContextStore } from '../ContextStore';
import {
  JsonlContextPersistence,
  SqliteContextPersistenceImpl,
  type ContextPersistence,
  type ContextSnapshot,
} from '../persistence/ContextPersistence';
import { resolveDataSubDir } from '@modules/core/paths';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { join } from 'path';

const logger = new Logger({
  module: 'context:persist:lifecycle',
  level: LogLevel.INFO,
});

const SNAPSHOT_FILENAME = 'context-snapshot.jsonl';

let persistence: ContextPersistence | null = null;
let sqliteAvailable = false;
let registered = false;

async function getPersistence(): Promise<ContextPersistence> {
  if (persistence) return persistence;

  // 优先尝试 SQLite
  try {
    const sqlite = new SqliteContextPersistenceImpl();
    await sqlite.initialize();
    persistence = sqlite;
    sqliteAvailable = true;
    logger.info('persistence:using_sqlite');
    return persistence;
  } catch {
    logger.info('persistence:sqlite_unavailable, fallback to JSONL');
  }

  // Fallback: JSONL
  const dir = resolveDataSubDir('');
  persistence = new JsonlContextPersistence(join(dir, SNAPSHOT_FILENAME));
  return persistence;
}

/**
 * 启动时恢复 ContextStore（SQLite 优先 → JSONL fallback + 迁移）
 * 应在 DI 容器初始化完成后调用
 */
export async function hydrateOnStartup(): Promise<number> {
  try {
    const p = await getPersistence();
    const snapshot = await p.load();

    // 如果 SQLite 为空，尝试从 JSONL 加载并迁移
    if ((!snapshot || snapshot.entries.length === 0) && sqliteAvailable) {
      const dir = resolveDataSubDir('');
      const jsonlPath = join(dir, SNAPSHOT_FILENAME);
      const jsonlPersistence = new JsonlContextPersistence(jsonlPath);
      const jsonlSnapshot = await jsonlPersistence.load();

      if (jsonlSnapshot && jsonlSnapshot.entries.length > 0) {
        logger.info('persistence:migrating_jsonl_to_sqlite', {
          count: jsonlSnapshot.entries.length,
        });
        const count = hydrateFromSnapshot(jsonlSnapshot);
        // 迁移后保存到 SQLite，删除旧 JSONL
        try {
          await p.save(jsonlSnapshot);
          const { unlink } = await import('fs/promises');
          await unlink(jsonlPath).catch(() => {
            /* @ignore-catch: unlink best-effort */
          });
        } catch {
          // @ignore-catch: migration save fallback
        }
        return count;
      }

      logger.info('persistence:no_snapshot');
      return 0;
    }

    if (!snapshot || snapshot.entries.length === 0) {
      logger.info('persistence:no_snapshot');
      return 0;
    }

    return hydrateFromSnapshot(snapshot);
  } catch (err) {
    await handleError(err, { module: 'context:persist', action: 'hydrate' });
    return 0;
  }
}

/** 从 snapshot 恢复 ContextStore */
function hydrateFromSnapshot(snapshot: {
  entries: unknown[];
  schemaVersion: string;
}): number {
  const p = getPersistenceSync();
  const validation = p.validate(snapshot as unknown as ContextSnapshot);
  if (!validation.valid) {
    logger.warn('persistence:invalid_snapshot', {
      errors: validation.errors,
      schemaVersion: snapshot.schemaVersion,
    });
    return 0;
  }

  const count = contextStore.hydrate(snapshot as unknown as ContextSnapshot);
  logger.info('persistence:hydrated', { count });
  return count;
}

/** 获取已创建的持久化实例（同步，仅用于 validate），不触发 SQLite 初始化 */
function getPersistenceSync(): ContextPersistence {
  if (persistence) return persistence;
  const dir = resolveDataSubDir('');
  return new JsonlContextPersistence(join(dir, SNAPSHOT_FILENAME));
}

/**
 * 关闭时序列化 ContextStore（SQLite 优先 → JSONL fallback）
 * 用于 SIGINT/SIGTERM 处理器（可以在退出前 await）
 */
export async function serializeOnShutdown(): Promise<void> {
  try {
    const snapshot = contextStore.serialize();
    if (snapshot.entries.length === 0) {
      logger.debug('persistence:empty_store_skip');
      return;
    }

    const p = await getPersistence();
    await p.save(snapshot);
  } catch (err) {
    await handleError(err, { module: 'context:persist', action: 'serialize' });
  }
}

/**
 * 关闭时同步序列化 ContextStore（用于 process.on('exit')）
 * exit 事件不支持异步，使用 writeFileSync
 */
export function serializeOnShutdownSync(): void {
  try {
    const snapshot = contextStore.serialize();
    if (snapshot.entries.length === 0) return;

    const { writeFileSync } = require('fs');
    const dir = resolveDataSubDir('');
    const lines = snapshot.entries.map((e) => JSON.stringify(e));
    writeFileSync(
      join(dir, SNAPSHOT_FILENAME),
      lines.join('\n') + '\n',
      'utf-8'
    );
  } catch {
    // @ignore-catch: shutdown phase
  }
}

/**
 * 注册生命周期钩子：启动 hydrate + 关闭 serialize
 *
 * 调用时机：
 *   hydrateOnStartup() -- 在 main.ts launch() 的 T1 bootstrap 之后
 *   serializeOnShutdown() -- 在 main.ts checkSingletonInstance() 的 exit/SIGINT/SIGTERM 处理器中
 */
export function registerPersistenceLifecycle(): void {
  if (registered) return;
  registered = true;

  // 进程退出时序列化
  const prevExit = process.listeners('exit');
  process.removeAllListeners('exit');
  for (const fn of prevExit) {
    process.on('exit', fn);
  }
  process.on('exit', () => {
    // exit 事件中只能执行同步操作，使用同步 writeFile
    const { writeFileSync } = require('fs');
    try {
      const snapshot = contextStore.serialize();
      if (snapshot.entries.length > 0) {
        const dir = resolveDataSubDir('');
        const lines = snapshot.entries.map((e) => JSON.stringify(e));
        writeFileSync(
          join(dir, SNAPSHOT_FILENAME),
          lines.join('\n') + '\n',
          'utf-8'
        );
      }
    } catch {
      // @ignore-catch: shutdown phase
    }
  });

  logger.info('persistence:lifecycle_registered');
}
