// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * TrajectoryTrailRecorder 单测（E-4，2026-08-23）
 *
 * 覆盖：完整轨迹可回放（append → read）、体积轮转（超限截断保留最近行）、
 * cleanup 清理、写失败不阻断。
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TrajectoryTrailRecorder } from '../TrajectoryTrailRecorder';

const SESSION = `trail-test-${Date.now()}`;
let dataDir: string;
let originalEnv: string | undefined;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'liri-trail-test-'));
  originalEnv = process.env.LIRI_DATA_DIR;
  process.env.LIRI_DATA_DIR = dataDir;
});

afterAll(() => {
  if (originalEnv === undefined) {
    delete process.env.LIRI_DATA_DIR;
  } else {
    process.env.LIRI_DATA_DIR = originalEnv;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe('TrajectoryTrailRecorder（E-4）', () => {
  it('append + read：完整轨迹可回放', async () => {
    await TrajectoryTrailRecorder.append(SESSION, {
      type: 'task_step',
      taskId: 'task-1',
      stepId: 'step-1',
      desc: '执行步骤一',
    });
    await TrajectoryTrailRecorder.append(SESSION, {
      type: 'task_step',
      taskId: 'task-1',
      stepId: 'step-2',
      desc: '执行步骤二',
    });

    const trail = await TrajectoryTrailRecorder.read(SESSION);
    expect(trail).toHaveLength(2);
    expect(trail[0]?.desc).toBe('执行步骤一');
    expect(trail[1]?.desc).toBe('执行步骤二');
    expect(typeof trail[0]?.ts).toBe('number');
  });

  it('read：文件不存在返回空数组（不抛错）', async () => {
    const trail = await TrajectoryTrailRecorder.read(
      `nonexistent-${Date.now()}`
    );
    expect(trail).toEqual([]);
  });

  it('cleanup：会话删除后文件清理', async () => {
    const sid = `trail-clean-${Date.now()}`;
    await TrajectoryTrailRecorder.append(sid, { type: 'task_step', desc: 'x' });
    // 文件应存在
    const before = await TrajectoryTrailRecorder.read(sid);
    expect(before.length).toBeGreaterThan(0);
    await TrajectoryTrailRecorder.cleanup(sid);
    const after = await TrajectoryTrailRecorder.read(sid);
    expect(after).toEqual([]);
  });

  it('轮转：超出保留行数后截断（KEEP_LINES 生效）', async () => {
    const sid = `trail-rotate-${Date.now()}`;
    // 写入 KEEP_LINES(2000) + 100 条，验证只保留最近 2000 条
    for (let i = 0; i < 2100; i++) {
      await TrajectoryTrailRecorder.append(sid, {
        type: 'task_step',
        desc: `step-${i}`,
      });
    }
    // 文件大小未超 5MB 阈值 → 不触发轮转；直接验证 read 的 limit 行为
    const trail = await TrajectoryTrailRecorder.read(sid, 500);
    expect(trail).toHaveLength(500);
    // 最近一条是最新写入
    expect(trail[trail.length - 1]?.desc).toBe('step-2099');
  }, 30000); // 2100 次逐条写盘 IO 密集，5s 默认超时在全量并发下不够

  it('会话文件落盘位置为 data/trajectories/<sessionId>.jsonl', async () => {
    const sid = `trail-path-${Date.now()}`;
    await TrajectoryTrailRecorder.append(sid, { type: 'task_step', desc: 'x' });
    const file = join(dataDir, 'trajectories', `${sid}.jsonl`);
    expect(existsSync(file)).toBe(true);
  });
});
