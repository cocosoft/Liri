/**
 * ExitRecorder 异常退出痕迹测试（#57-3）
 *
 * Windows 外部强杀不触发任何 Node 退出事件，last-exit.json 与 crash dump
 * 均不产生；下次启动检测到锁文件残留时调用 recordAbnormalExit 持久化痕迹。
 */

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  recordAbnormalExit,
  AbnormalExitRecord,
  ExitRecord,
} from '../ExitRecorder.js';

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'exit-recorder-'));
  return join(dir, 'last-abnormal.json');
}

describe('ExitRecorder 异常退出痕迹（#57-3）', () => {
  test('持久化痕迹包含 stalePid/lastLockedAt/lastExit', () => {
    const file = tempFile();
    const lastExit: ExitRecord = {
      code: 1,
      reason: 'uncaughtException',
      exitAt: '2026-08-12T06:00:00.000Z',
      pid: 12345,
      uptimeMs: 1000,
    };
    try {
      recordAbnormalExit(
        {
          detectedAt: '2026-08-15T00:00:00.000Z',
          stalePid: 41084,
          lastLockedAt: '2026-08-12T06:12:45.000Z',
          lastExit,
        },
        file
      );
      const record = JSON.parse(
        readFileSync(file, 'utf-8')
      ) as AbnormalExitRecord;
      expect(record.stalePid).toBe(41084);
      expect(record.lastLockedAt).toContain('2026-08-12');
      expect(record.lastExit?.reason).toBe('uncaughtException');
      expect(record.detectedAt).toBe('2026-08-15T00:00:00.000Z');
    } finally {
      rmSync(file, { recursive: true, force: true });
    }
  });

  test('lastExit 为 null（强杀/断电，从未触发退出事件）', () => {
    const file = tempFile();
    try {
      recordAbnormalExit(
        {
          detectedAt: '2026-08-15T00:00:00.000Z',
          stalePid: 41084,
          lastLockedAt: null,
          lastExit: null,
        },
        file
      );
      const record = JSON.parse(
        readFileSync(file, 'utf-8')
      ) as AbnormalExitRecord;
      expect(record.lastExit).toBeNull();
      expect(record.lastLockedAt).toBeNull();
      expect(record.stalePid).toBe(41084);
    } finally {
      rmSync(file, { recursive: true, force: true });
    }
  });
});
