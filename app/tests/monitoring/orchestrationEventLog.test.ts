/**
 * H-2（2026-10-18）编排事件持久化守卫。
 *
 * 判据：
 * - 订阅 `orch:*` 后追加为 JSONL（`{v,t,type,data}`），可被离线分析读取；
 * - **载荷脱敏**：长字符串截断、保留关联键（`planId` 等）；
 * - **可关闭**：`enabled:false`（或 `LIRI_ORCH_EVENT_LOG=0`）⇒ 不落盘；
 * - **有界增长**：超过 `maxBytes` 轮转为 `.1`。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OrchestrationEventType as E } from '@modules/types/orchestrationEvents';

import { globalEventBus } from '../../src/core/events/EventBus';
import {
  flushOrchestrationEventLog,
  orchestrationEventLogPath,
  startOrchestrationEventLog,
  stopOrchestrationEventLog,
} from '../../src/monitoring/orchestrationEventLog';

interface LogLine {
  v: number;
  t: number;
  type: string;
  data: { planId?: string; totalSteps?: number; content?: string };
}

let dir: string | null = null;

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'pyapp-orch-log-'));
  return dir;
}

function readLines(file: string): LogLine[] {
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LogLine);
}

afterEach(async () => {
  await stopOrchestrationEventLog();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('H-2 编排事件持久化', () => {
  it('订阅 orch:* 并追加 JSONL；长字符串截断、关联键保留', async () => {
    const d = tempDir();
    startOrchestrationEventLog({ dir: d });

    globalEventBus.publish(E.PLAN_START, {
      planId: 'p1',
      totalSteps: 2,
      content: 'x'.repeat(400),
    });
    globalEventBus.publish(E.PLAN_COMPLETED, { planId: 'p1' });
    await flushOrchestrationEventLog();

    const file = orchestrationEventLogPath(d);
    expect(existsSync(file)).toBe(true);
    const lines = readLines(file);
    expect(lines).toHaveLength(2);
    expect(lines[0].type).toBe(E.PLAN_START);
    expect(lines[1].type).toBe(E.PLAN_COMPLETED);
    expect(lines[0].v).toBe(1);
    expect(lines[0].t).toBeGreaterThan(0);
    expect(lines[0].data.planId).toBe('p1');
    expect(lines[0].data.totalSteps).toBe(2);
    // 400 字符 ⇒ 截断到 256 + 省略号
    expect(lines[0].data.content?.length).toBe(257);
    expect(lines[0].data.content?.endsWith('…')).toBe(true);
  });

  it('enabled:false ⇒ 不落盘（显式关闭）', async () => {
    const d = tempDir();
    startOrchestrationEventLog({ dir: d, enabled: false });

    globalEventBus.publish(E.PLAN_START, { planId: 'p1' });
    await flushOrchestrationEventLog();

    expect(existsSync(orchestrationEventLogPath(d))).toBe(false);
  });

  it('超过 maxBytes 轮转为 .1（保留一份备份，当前文件可继续写）', async () => {
    const d = tempDir();
    startOrchestrationEventLog({ dir: d, maxBytes: 120 });

    for (let i = 0; i < 3; i++) {
      globalEventBus.publish(E.PLAN_START, { planId: `p${i}` });
      await flushOrchestrationEventLog();
    }

    const file = orchestrationEventLogPath(d);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(readLines(file).length).toBeGreaterThanOrEqual(1);
    expect(readLines(`${file}.1`).length).toBeGreaterThanOrEqual(1);
  });
});
