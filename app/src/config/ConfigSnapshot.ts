import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { getLogger } from '../monitoring/logs/Logger.js';
import { handleError } from '@modules/error/handleError.js';
import { redactConfig } from './ConfigRedactor';

const logger = getLogger('config:snapshot');

export interface SnapshotMeta {
  timestamp: number;
  path: string;
}

const DEFAULT_MAX_SNAPSHOTS = 3;

export class ConfigSnapshot {
  private snapshotDir: string;
  private maxSnapshots: number;

  constructor(
    snapshotDir: string,
    maxSnapshots: number = DEFAULT_MAX_SNAPSHOTS
  ) {
    this.snapshotDir = snapshotDir;
    this.maxSnapshots = maxSnapshots;
  }

  getSnapshotDir(): string {
    return this.snapshotDir;
  }

  saveSnapshot(config: Record<string, unknown>): string {
    this.ensureDir();

    const redactedConfig = redactConfig(config);

    const timestamp = Date.now();
    const fileName = `snapshot-${timestamp}.json`;
    const filePath = join(this.snapshotDir, fileName);

    writeFileSync(filePath, JSON.stringify(redactedConfig, null, 2), {
      encoding: 'utf-8',
    });
    logger.debug(`配置快照已保存: ${filePath}`);

    this.rotateSnapshots();

    return filePath;
  }

  getLatestSnapshot(): SnapshotMeta | null {
    const snapshots = this.listSnapshots();
    if (snapshots.length === 0) {
      return null;
    }
    return snapshots[0];
  }

  loadSnapshot(path: string): Record<string, unknown> | null {
    try {
      const content = readFileSync(path, 'utf-8');
      return JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
      void handleError(error, {
        module: 'config:snapshot',
        action: '读取快照失败',
      });
      return null;
    }
  }

  listSnapshots(): SnapshotMeta[] {
    if (!existsSync(this.snapshotDir)) {
      return [];
    }

    try {
      const files = readdirSync(this.snapshotDir)
        .filter((f: string) => f.startsWith('snapshot-') && f.endsWith('.json'))
        .map((f: string) => {
          const fullPath = join(this.snapshotDir, f);
          const ts = parseInt(
            f.replace('snapshot-', '').replace('.json', ''),
            10
          );
          return { timestamp: ts, path: fullPath };
        })
        .sort((a: SnapshotMeta, b: SnapshotMeta) => b.timestamp - a.timestamp);

      return files;
    } catch (error) {
      logger.warning(
        '读取快照目录失败',
        error instanceof Error ? error : undefined
      );
      return [];
    }
  }

  rotateSnapshots(): void {
    const snapshots = this.listSnapshots();
    if (snapshots.length <= this.maxSnapshots) {
      return;
    }

    const toRemove = snapshots.slice(this.maxSnapshots);
    for (const snap of toRemove) {
      try {
        unlinkSync(snap.path);
        logger.debug(`快照已轮转删除: ${snap.path}`);
      } catch (error) {
        logger.warning(
          `删除快照失败: ${snap.path}`,
          error instanceof Error ? error : undefined
        );
      }
    }
  }

  private ensureDir(): void {
    if (!existsSync(this.snapshotDir)) {
      mkdirSync(this.snapshotDir, { recursive: true });
    }
  }

  clearAllSnapshots(): void {
    const snapshots = this.listSnapshots();
    for (const snap of snapshots) {
      try {
        unlinkSync(snap.path);
      } catch (error) {
        logger.warning(
          `删除快照失败: ${snap.path}`,
          error instanceof Error ? error : undefined
        );
      }
    }
  }
}

export function createDefaultConfigSnapshot(configDir: string): ConfigSnapshot {
  const snapshotDir = join(configDir, 'snapshots');
  return new ConfigSnapshot(snapshotDir, DEFAULT_MAX_SNAPSHOTS);
}
