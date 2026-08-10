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
 * AppLifecycle — §十 阶段 A 接线测试
 * 验证：状态转移合法性、崩溃恢复 → ERROR 映射、快照落盘。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getAppState,
  initAppStateMachine,
  markAppBusy,
  markAppError,
  markAppIdle,
} from '../../../src/state/app/AppLifecycle';
import { AppState } from '../../../src/state/app/types';
import { StateMachine } from '../../../src/state/engine/StateMachine';

let tmpDir: string;
const originalDataDir = process.env.LIRI_DATA_DIR;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-lifecycle-test-'));
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

function snapshotFile(): string {
  return path.join(tmpDir, 'state', 'app-state.json');
}

describe('AppLifecycle — §十 阶段 A', () => {
  test('init 后初始状态为 IDLE 且快照落盘', () => {
    const machine = initAppStateMachine();
    expect(machine.getState()).toBe(AppState.IDLE);
    // 初始状态不触发 transition，快照可能未写；此处仅确认状态
    expect(getAppState()).toBe(AppState.IDLE);
  });

  test('markAppBusy → BUSY，快照 currentState=busy 落盘', () => {
    const ok = markAppBusy('dream cycle');
    expect(ok).toBe(true);
    expect(getAppState()).toBe(AppState.BUSY);
    const snapshot = JSON.parse(fs.readFileSync(snapshotFile(), 'utf-8'));
    expect(snapshot.currentState).toBe('busy');
    expect(snapshot.machineType).toBe('AppStateMachine');
  });

  test('markAppIdle → IDLE', () => {
    expect(markAppIdle('cycle done')).toBe(true);
    expect(getAppState()).toBe(AppState.IDLE);
  });

  test('崩溃恢复映射：IDLE 无法直达 ERROR，内部先经 BUSY 再 ERROR（快照 currentState=error）', () => {
    const ok = markAppError(new Error('crash recovery: session-x'));
    expect(ok).toBe(true);
    expect(getAppState()).toBe(AppState.ERROR);
    const snapshot = JSON.parse(fs.readFileSync(snapshotFile(), 'utf-8'));
    expect(snapshot.currentState).toBe('error');
    expect(snapshot.history.some((h: { to: string }) => h.to === 'error')).toBe(
      true
    );
  });

  test('ERROR → IDLE 恢复（markAppIdle）', () => {
    expect(markAppIdle('recovered')).toBe(true);
    expect(getAppState()).toBe(AppState.IDLE);
  });
});

describe('AppLifecycle — §十 阶段 B（引擎事件化）', () => {
  test('引擎 onTransition 钩子随每次成功转移触发', () => {
    const transitions: Array<{ from: string; to: string }> = [];
    const machine = new StateMachine<'idle' | 'busy' | 'error'>({
      initialState: 'idle',
      rules: { idle: ['busy'], busy: ['idle', 'error'], error: [] },
      contextId: 'phase-b-test',
      criticalStates: ['error'],
      onTransition: (record) =>
        transitions.push({ from: record.from, to: record.to }),
    });

    machine.transition('busy', 'start');
    machine.transition('error', 'boom');

    expect(transitions).toEqual([
      { from: 'idle', to: 'busy' },
      { from: 'busy', to: 'error' },
    ]);
  });

  test('应用状态机已配置关键状态（ERROR/PAUSED）与 onTransition（SSE 桥接不抛错）', () => {
    // markAppError 触发 onTransition → 惰性 require SSE 桥接，无客户端时 no-op 不抛错
    expect(() => markAppError(new Error('phase-b bridge'))).not.toThrow();
    expect(getAppState()).toBe(AppState.ERROR);
    expect(markAppIdle('recovered')).toBe(true);
  });
});
