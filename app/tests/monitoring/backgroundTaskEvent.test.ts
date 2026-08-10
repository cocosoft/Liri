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

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  detectTaskAlerts,
  getBackgroundTaskLog,
  recordBackgroundTask,
} from '../../src/monitoring/BackgroundTaskEvent';

let tmpDir: string;
const originalDataDir = process.env.LIRI_DATA_DIR;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgtask-test-'));
  process.env.LIRI_DATA_DIR = tmpDir;
});

afterAll(() => {
  if (originalDataDir === undefined) {
    delete process.env.LIRI_DATA_DIR;
  } else {
    process.env.LIRI_DATA_DIR = originalDataDir;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('BackgroundTaskEvent — §9.3 统一后台任务事件', () => {
  test('recordBackgroundTask 写入 JSONL，getBackgroundTaskLog 按倒序读取', () => {
    recordBackgroundTask({ task: 'dream', phase: 'start', startedAt: 1000 });
    recordBackgroundTask({ task: 'dream', phase: 'complete', startedAt: 1000, endedAt: 2000, durationMs: 1000 });
    recordBackgroundTask({ task: 'knowledge-compile', phase: 'skip', startedAt: 3000, status: 'no change' });

    const log = getBackgroundTaskLog(10);
    expect(log.length).toBe(3);
    // 倒序：最新在前
    expect(log[0].task).toBe('knowledge-compile');
    expect(log[0].phase).toBe('skip');
    expect(log[0].status).toBe('no change');
    expect(log[1].phase).toBe('complete');
    expect(log[1].durationMs).toBe(1000);
    expect(log[2].phase).toBe('start');
  });

  test('limit 参数限制返回条数', () => {
    for (let i = 0; i < 5; i++) {
      recordBackgroundTask({ task: 'dream', phase: 'complete', startedAt: i });
    }
    const log = getBackgroundTaskLog(2);
    expect(log.length).toBe(2);
  });

  test('无日志文件时返回空数组', () => {
    fs.rmSync(path.join(tmpDir, 'background', 'tasks.jsonl'), { force: true });
    expect(getBackgroundTaskLog()).toEqual([]);
  });
});

describe('detectTaskAlerts — §9.3 阶段 2 关键任务失败提醒', () => {
  test('连续 fail 达阈值返回告警（含连续次数与最近原因）', () => {
    fs.rmSync(path.join(tmpDir, 'background', 'tasks.jsonl'), { force: true });
    for (let i = 0; i < 3; i++) {
      recordBackgroundTask({ task: 'dream', phase: 'fail', startedAt: 1000 + i, endedAt: 2000 + i, status: 'boom' });
    }
    const alerts = detectTaskAlerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0].task).toBe('dream');
    expect(alerts[0].phase).toBe('fail');
    expect(alerts[0].streak).toBe(3);
    expect(alerts[0].status).toBe('boom');
  });

  test('连续次数低于阈值不告警', () => {
    fs.rmSync(path.join(tmpDir, 'background', 'tasks.jsonl'), { force: true });
    recordBackgroundTask({ task: 'dream', phase: 'fail', startedAt: 1000, endedAt: 2000, status: 'once' });
    expect(detectTaskAlerts()).toEqual([]);
  });

  test('穿插 complete 重置连续计数', () => {
    fs.rmSync(path.join(tmpDir, 'background', 'tasks.jsonl'), { force: true });
    recordBackgroundTask({ task: 'dream', phase: 'fail', startedAt: 1000, endedAt: 2000, status: 'boom' });
    recordBackgroundTask({ task: 'dream', phase: 'complete', startedAt: 3000, endedAt: 4000, durationMs: 1000 });
    recordBackgroundTask({ task: 'dream', phase: 'fail', startedAt: 5000, endedAt: 6000, status: 'boom' });
    // 最新连续 1 次 fail，未达阈值
    expect(detectTaskAlerts()).toEqual([]);
  });

  test('skip 与 fail 合并计数（持续跳过也告警）', () => {
    fs.rmSync(path.join(tmpDir, 'background', 'tasks.jsonl'), { force: true });
    recordBackgroundTask({ task: 'knowledge-compile', phase: 'skip', startedAt: 1000, status: 'no change' });
    recordBackgroundTask({ task: 'knowledge-compile', phase: 'skip', startedAt: 2000, status: 'no change' });
    recordBackgroundTask({ task: 'knowledge-compile', phase: 'skip', startedAt: 3000, status: 'no change' });
    const alerts = detectTaskAlerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0].task).toBe('knowledge-compile');
    expect(alerts[0].phase).toBe('skip');
    expect(alerts[0].streak).toBe(3);
  });
});
