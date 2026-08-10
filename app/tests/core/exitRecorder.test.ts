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
  isAbnormalExit,
  readLastExit,
  recordExit,
} from '../../src/core/exit/ExitRecorder';

let tmpDir: string;
const originalDataDir = process.env.LIRI_DATA_DIR;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-recorder-test-'));
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

describe('ExitRecorder — 根因 C 退出信息记录', () => {
  test('recordExit 写入后 readLastExit 可读取完整字段', () => {
    recordExit('uncaughtException', 1, 'boom');
    const record = readLastExit();
    expect(record).not.toBeNull();
    expect(record!.reason).toBe('uncaughtException');
    expect(record!.code).toBe(1);
    expect(record!.message).toBe('boom');
    expect(record!.exitAt).toBeDefined();
    expect(record!.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  test('后一次记录覆盖前一次', () => {
    recordExit('uncaughtException', 1, 'boom');
    recordExit('graceful', 0, 'SIGTERM');
    const record = readLastExit();
    expect(record!.reason).toBe('graceful');
    expect(record!.code).toBe(0);
    expect(record!.message).toBe('SIGTERM');
  });

  test('isAbnormalExit 判定：非零退出码为异常', () => {
    expect(isAbnormalExit({ code: 1, reason: 'unknown', exitAt: '', pid: 0, uptimeMs: 0 })).toBe(true);
    expect(isAbnormalExit({ code: 0, reason: 'normal', exitAt: '', pid: 0, uptimeMs: 0 })).toBe(false);
  });

  test('isAbnormalExit 判定：uncaughtException / unhandledRejection 为异常，graceful 正常', () => {
    expect(
      isAbnormalExit({ code: 0, reason: 'uncaughtException', exitAt: '', pid: 0, uptimeMs: 0 })
    ).toBe(true);
    expect(
      isAbnormalExit({ code: 0, reason: 'unhandledRejection', exitAt: '', pid: 0, uptimeMs: 0 })
    ).toBe(true);
    expect(
      isAbnormalExit({ code: 0, reason: 'graceful', exitAt: '', pid: 0, uptimeMs: 0 })
    ).toBe(false);
  });

  test('无记录时 readLastExit 返回 null（文件不存在或损坏）', () => {
    fs.rmSync(path.join(tmpDir, 'last-exit.json'), { force: true });
    expect(readLastExit()).toBeNull();
  });
});
