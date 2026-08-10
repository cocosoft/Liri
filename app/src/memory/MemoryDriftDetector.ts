/**
 * MemoryDriftDetector — 记忆外部漂移检测
 *
 * P2-7: 对标 hermes-agent 外部漂移检测。
 * 通过 checksum 校验检测 tool/shell/manual 对记忆文件的意外修改。
 *
 * 检测到漂移→备份 .bak.\<ts\> →拒绝变异→告警
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('memory:driftDetector');

export interface DriftSnapshot {
  filePath: string;
  checksum: string;
  size: number;
  mtime: number;
  /** P2-7 fix: 保存原始内容，用于恢复 */
  originalContent: Buffer;
}

export class MemoryDriftDetector {
  private snapshots = new Map<string, DriftSnapshot>();

  /** 拍摄快照 */
  snapshot(filePath: string): DriftSnapshot | null {
    if (!existsSync(filePath)) return null;
    try {
      const content = readFileSync(filePath);
      const snap: DriftSnapshot = {
        filePath,
        checksum: createHash('sha256').update(content).digest('hex'),
        size: content.length,
        mtime: Date.now(),
        originalContent: content,
      };
      this.snapshots.set(filePath, snap);
      return snap;
    } catch {
      return null;
    }
  }

  /** 检查漂移：文件被外部修改但 checksum 不匹配 */
  check(filePath: string): { drifted: boolean; reason: string } {
    const snap = this.snapshots.get(filePath);
    if (!snap) return { drifted: false, reason: 'no snapshot' };
    if (!existsSync(filePath))
      return { drifted: true, reason: 'file deleted externally' };

    try {
      const content = readFileSync(filePath);
      const currentChecksum = createHash('sha256')
        .update(content)
        .digest('hex');
      if (currentChecksum !== snap.checksum) {
        const bakPath = `${filePath}.bak.${Date.now()}`;
        writeFileSync(bakPath, content);
        // Restore from in-memory snapshot (original content)
        try {
          writeFileSync(filePath, snap.originalContent);
          logger.warn('memoryDrift:restored', { filePath });
        } catch {
          /* best-effort */
        }

        logger.warn('memoryDrift:detected', {
          filePath,
          expected: snap.checksum.slice(0, 8),
          actual: currentChecksum.slice(0, 8),
          backup: bakPath,
        });

        return {
          drifted: true,
          reason: `Checksum mismatch. Backup saved to ${bakPath}`,
        };
      }
      return { drifted: false, reason: 'checksum match' };
    } catch (err) {
      return { drifted: true, reason: `Read error: ${String(err)}` };
    }
  }

  /** 删除快照 */
  remove(filePath: string): void {
    this.snapshots.delete(filePath);
  }

  /** 获取所有被快照的文件 */
  getTrackedFiles(): string[] {
    return [...this.snapshots.keys()];
  }
}

/** P2-7: 全局单例 */
let _detector: MemoryDriftDetector;
export function getMemoryDriftDetector(): MemoryDriftDetector {
  if (!_detector) _detector = new MemoryDriftDetector();
  return _detector;
}
