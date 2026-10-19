/**
 * 定时器生命周期专项（BUG-1/BUG-2/BUG-3）回归测试。
 *
 * 覆盖：
 * - FileExporter：构造函数零定时器副作用；start 幂等；stop/dispose 可回收；setConfig 重启句柄。
 * - MemoryIntegrationService：initialize 幂等；dispose 释放同步定时器。
 *
 * 说明：Bun 的 `process.getActiveResourcesInfo()` 不跟踪 setTimeout/Interval（实测恒为 []），
 * 故此处以**句柄字段**断言生命周期（白盒，但能确定性验证“可停止/不叠加”）。
 */
import { describe, it, expect } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileExporter } from '../../src/monitoring/exporters/FileExporter';
import { MemoryIntegrationService } from '../../src/memory/memdir/MemoryIntegrationService';

type TimerHandle = ReturnType<typeof setInterval> | null;

function rotationTimerOf(exporter: FileExporter): TimerHandle {
  return (exporter as unknown as { rotationTimer: TimerHandle }).rotationTimer;
}

function syncTimerOf(service: MemoryIntegrationService): TimerHandle {
  return (service as unknown as { syncTimer: TimerHandle }).syncTimer;
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'liri-timer-lifecycle-'));
}

describe('FileExporter 定时器生命周期', () => {
  it('构造函数不注册定时器；start 幂等；stop/dispose 可回收', () => {
    const outputDir = makeTempDir();
    try {
      const exporter = new FileExporter({
        outputDir,
        rotationInterval: 60_000,
      });

      // BUG-2：构造副作用已移除
      expect(rotationTimerOf(exporter)).toBeNull();

      exporter.start();
      const first = rotationTimerOf(exporter);
      expect(first).not.toBeNull();

      // 幂等：重复 start 不叠加、不重置句柄
      exporter.start();
      expect(rotationTimerOf(exporter)).toBe(first);

      exporter.stop();
      expect(rotationTimerOf(exporter)).toBeNull();

      // dispose 幂等
      exporter.dispose();
      exporter.dispose();
      expect(rotationTimerOf(exporter)).toBeNull();
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('rotationInterval <= 0 时 start 不注册定时器', () => {
    const outputDir = makeTempDir();
    try {
      const exporter = new FileExporter({ outputDir, rotationInterval: 0 });
      exporter.start();
      expect(rotationTimerOf(exporter)).toBeNull();
      exporter.dispose();
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('构造函数零 I/O；未 start 时首次 export 按需建目录', () => {
    const parent = makeTempDir();
    const outputDir = join(parent, 'nested', 'telemetry');
    try {
      const exporter = new FileExporter({ outputDir, rotationInterval: 0 });

      // 构造函数不做目录探测/创建
      expect(existsSync(outputDir)).toBe(false);

      exporter.export({
        timestamp: Date.now(),
        type: 'log',
        name: 'timer-lifecycle',
        value: 1,
      });
      expect(existsSync(outputDir)).toBe(true);

      exporter.dispose();
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('setConfig 变更输出目录 ⇒ 后续导出落到新目录', () => {
    const dirA = makeTempDir();
    const dirB = makeTempDir();
    const newOutputDir = join(dirB, 'nested');
    try {
      const exporter = new FileExporter({
        outputDir: dirA,
        rotationInterval: 0,
      });
      exporter.start();
      exporter.export({
        timestamp: Date.now(),
        type: 'log',
        name: 'first',
        value: 1,
      });
      expect(
        readdirSync(dirA).filter((f) => f.endsWith('.jsonl'))
      ).toHaveLength(1);

      exporter.setConfig({ outputDir: newOutputDir });
      exporter.export({
        timestamp: Date.now(),
        type: 'log',
        name: 'second',
        value: 2,
      });

      expect(existsSync(newOutputDir)).toBe(true);
      expect(
        readdirSync(newOutputDir).filter((f) => f.endsWith('.jsonl'))
      ).toHaveLength(1);

      exporter.dispose();
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it('setConfig 变更轮换间隔 ⇒ 旧句柄停止并换新句柄', () => {
    const outputDir = makeTempDir();
    try {
      const exporter = new FileExporter({
        outputDir,
        rotationInterval: 60_000,
      });
      exporter.start();
      const before = rotationTimerOf(exporter);

      exporter.setConfig({ rotationInterval: 30_000 });
      const after = rotationTimerOf(exporter);
      expect(after).not.toBeNull();
      expect(after).not.toBe(before);

      exporter.dispose();
      expect(rotationTimerOf(exporter)).toBeNull();
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('MemoryIntegrationService 定时器生命周期', () => {
  it('initialize 幂等；dispose 释放同步定时器', async () => {
    let initCalls = 0;
    const memdirStub = {
      initialize: async () => {
        initCalls++;
      },
    };
    const service = new MemoryIntegrationService(
      memdirStub as never,
      {} as never,
      {} as never,
      {
        enableMemdir: true,
        enableDatabase: false,
        autoSync: true,
        syncInterval: 60_000,
      }
    );

    await service.initialize();
    await service.initialize();

    // BUG-3：重复初始化不重复扫描
    expect(initCalls).toBe(1);
    expect(syncTimerOf(service)).not.toBeNull();

    service.dispose();
    expect(syncTimerOf(service)).toBeNull();
    // dispose 幂等
    service.dispose();
  });
});
