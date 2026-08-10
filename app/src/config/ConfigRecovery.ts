import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getLogger } from '../monitoring/logs/Logger.js';
import { handleError } from '@modules/error';
import { ConfigSnapshot } from './ConfigSnapshot';

const logger = getLogger('config:recovery');

export interface RecoveryResult {
  recovered: boolean;
  config?: Record<string, unknown>;
  snapshotPath?: string;
  error?: string;
}

export class ConfigRecovery {
  private snapshot: ConfigSnapshot;
  private configPath: string;

  constructor(snapshot: ConfigSnapshot, configPath: string) {
    this.snapshot = snapshot;
    this.configPath = configPath;
  }

  attemptRecovery(): RecoveryResult {
    const latest = this.snapshot.getLatestSnapshot();
    if (!latest) {
      logger.warning('配置恢复失败：无可用的快照');
      return { recovered: false, error: 'No snapshots available' };
    }

    logger.warning('尝试从快照恢复配置', { snapshotPath: latest.path });

    const config = this.snapshot.loadSnapshot(latest.path);
    if (!config) {
      logger.error('快照文件损坏，无法恢复', { snapshotPath: latest.path });
      return {
        recovered: false,
        error: 'Snapshot is corrupted',
        snapshotPath: latest.path,
      };
    }

    try {
      const configDir = join(this.configPath, '..');
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      copyFileSync(latest.path, this.configPath);

      logger.warning('配置已从快照恢复', {
        snapshotPath: latest.path,
        configPath: this.configPath,
      });

      return { recovered: true, config, snapshotPath: latest.path };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      void handleError(error, {
        module: 'config:recovery',
        action: '快照恢复写入失败',
      });
      return { recovered: false, error: msg, snapshotPath: latest.path };
    }
  }
}
