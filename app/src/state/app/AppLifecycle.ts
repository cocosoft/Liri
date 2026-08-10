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
 * AppLifecycle — AppStateMachine 接线（§十 阶段 A）
 *
 * 将成品 AppStateMachine 注册到 StateMachineRegistry，并在状态变更时
 * 快照落盘（~/.pyapp/data/state/app-state.json）、启动时从快照恢复。
 * 对外提供统一的 markAppBusy/markAppIdle/markAppError/markAppPaused 转移入口，
 * 供启动流程、崩溃恢复、后台任务等关键节点调用。
 */

import fs from 'fs';
import path from 'path';
import { resolveDataSubDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import { StateMachine } from '../engine/StateMachine';
import { StateMachineRegistry } from '../engine/StateMachineRegistry';
import type { StateSnapshot, TransitionRecord } from '../engine/types';
import { AppStateMachine } from './AppStateMachine';
import { AppState, APP_TRANSITIONS } from './types';

const logger = getLogger('state:app-lifecycle');

const MACHINE_ID = 'app';
const SNAPSHOT_DIR = 'state';
const SNAPSHOT_FILE = 'app-state.json';
const SCHEMA_VERSION = 1;

function snapshotPath(): string {
  return path.join(resolveDataSubDir(SNAPSHOT_DIR), SNAPSHOT_FILE);
}

function persistSnapshot(machine: StateMachine<AppState>): void {
  try {
    const dir = resolveDataSubDir(SNAPSHOT_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      snapshotPath(),
      JSON.stringify(machine.snapshot('AppStateMachine', SCHEMA_VERSION))
    );
  } catch (e) {
    // @ignore-catch — 快照落盘失败不影响运行
    logger.warn('应用状态快照落盘失败', { error: String(e) });
  }
}

function restoreFromSnapshot(): StateMachine<AppState> | null {
  try {
    const raw = fs.readFileSync(snapshotPath(), 'utf-8');
    const snapshot = JSON.parse(raw) as StateSnapshot<AppState>;
    return StateMachine.fromSnapshot<AppState>(snapshot, {
      initialState: AppState.IDLE,
      rules: APP_TRANSITIONS,
      contextId: MACHINE_ID,
      criticalStates: [AppState.ERROR, AppState.PAUSED],
      onTransition: createTransitionHook(),
    });
  } catch {
    return null;
  }
}

/**
 * §十 阶段 B：转移事件发布钩子 — 桥接 SSE `app:state`，前端可实时感知应用状态。
 * 惰性 require 规避 state → infrastructure 静态循环依赖。
 */
function createTransitionHook(): (record: TransitionRecord<AppState>) => void {
  return (record) => {
    logger.info(`应用状态转移事件: ${record.from} → ${record.to}`, {
      reason: record.reason,
    });
    try {
      const { broadcastEvent } = require('@modules/infrastructure/http/LocalHTTPServiceSSE') as typeof import('@modules/infrastructure/http/LocalHTTPServiceSSE');
      broadcastEvent('app:state', {
        state: record.to,
        from: record.from,
        reason: record.reason,
        timestamp: record.timestamp,
      });
    } catch (e) {
      // @ignore-catch — 早期启动/非 HTTP 模式下 SSE 桥接不可用，不影响状态机
      logger.debug('app:state SSE 桥接失败', { error: String(e) });
    }
  };
}

let machineCache: StateMachine<AppState> | null = null;

/**
 * 获取（并首次接线）应用全局状态机。
 * 首次调用时注册到 StateMachineRegistry；存在历史快照时恢复其状态。
 */
export function getAppStateMachine(): StateMachine<AppState> {
  if (machineCache) return machineCache;

  const registry = StateMachineRegistry.getInstance();
  const existing = registry.find<AppState>(MACHINE_ID);
  if (existing) {
    // registry 内部按 StateMachine<string> 存储，恢复时按已知类型断言
    machineCache = existing as unknown as StateMachine<AppState>;
    return machineCache;
  }

  const machine =
    restoreFromSnapshot() ??
    new AppStateMachine(MACHINE_ID, { onTransition: createTransitionHook() });
  registry.register(MACHINE_ID, machine as unknown as StateMachine<string>);
  machine.onStateChange((from, to, reason) => {
    logger.info(`应用状态变更: ${from} → ${to}`, { reason });
    persistSnapshot(machine);
  });
  machineCache = machine;
  return machine;
}

/**
 * 应用启动时接线（注册 + 快照恢复 + 记录初始状态）
 */
export function initAppStateMachine(): StateMachine<AppState> {
  const machine = getAppStateMachine();
  logger.info('应用状态机已接线', {
    initialState: machine.getState(),
  });
  return machine;
}

/** 获取当前应用状态 */
export function getAppState(): AppState {
  return getAppStateMachine().getState();
}

/** 标记应用忙碌（后台任务执行等） */
export function markAppBusy(reason?: string): boolean {
  return getAppStateMachine().transition(AppState.BUSY, reason);
}

/** 标记应用空闲（任务完成/启动就绪） */
export function markAppIdle(reason?: string): boolean {
  return getAppStateMachine().transition(AppState.IDLE, reason);
}

/** 标记应用暂停（用户主动） */
export function markAppPaused(reason?: string): boolean {
  return getAppStateMachine().transition(AppState.PAUSED, reason);
}

/** 标记应用全局错误（崩溃恢复等），合法转移失败时记录 warn 不抛错 */
export function markAppError(err: Error): boolean {
  const machine = getAppStateMachine();
  try {
    if (machine.canTransition(AppState.ERROR)) {
      return machine.transition(AppState.ERROR, err.message, {
        stack: err.stack,
        name: err.name,
      });
    }
    // IDLE/PAUSED 无法直接 ERROR：先经 BUSY 再 ERROR（崩溃恢复语义）
    machine.transition(AppState.BUSY, 'preparing app error');
    return machine.transition(AppState.ERROR, err.message, {
      stack: err.stack,
      name: err.name,
    });
  } catch (e) {
    // @ignore-catch — 非法转移不阻断调用方
    logger.warn('应用状态转移 ERROR 失败', { error: String(e) });
    return false;
  }
}
