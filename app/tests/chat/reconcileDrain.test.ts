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
 * TB-10 回归：待对账队列**必须有消费者**。
 *
 * 修复前的缺陷（2026-09-23 取证）：`ChatManager._requestReconcile()` 在事件 append 失败时会把
 * 会话加入 `_pendingReconcileSessions`，但唯一消费者 `runPendingReconciles()` **在全仓没有任何
 * 调用点**（grep 仅 4 处：定义 / 私有入队 / 入队调用 / 日志 action 字符串）⇒ 队列只入不出、
 * `ReconcileService`（5 类漂移检测 + 修复计划）运行时从不执行、`pendingRepair` 标记无消费方。
 *
 * 本文件锁定修复后的**接线行为**：
 * 1. 入队后经去抖窗口**自动执行一次**对账；
 * 2. 同一窗口内多次入队**合并为一次**（去抖）；
 * 3. 熔断期入队被跳过 ⇒ **不调度**对账（防失败风暴）；
 * 4. 消费进行中**新入队的会话不被丢弃**（修复前用 `clear()` 会静默丢掉）。
 *
 * 说明：本仓 app 侧无 fake-timer 基建（全仓无 `useFakeTimers`），故用 `ChatManagerImpl
 * .reconcileDrainDelayMs` 这个 **static 测试缝**把去抖窗口缩短到 30ms。
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { ChatManagerImpl } from '../../src/chat/ChatManager.js';

/** 私有成员访问（TS `private` 仅编译期约束；此处为回归内部语义所必需） */
type ChatManagerInternals = {
  _requestReconcile(
    sessionId: string,
    eventLog: { isAppendCircuitOpen(): boolean }
  ): void;
  _pendingReconcileSessions: Set<string>;
};

const internals = (cm: ChatManagerImpl): ChatManagerInternals =>
  cm as unknown as ChatManagerInternals;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const openCircuit = { isAppendCircuitOpen: (): boolean => false };
const closedCircuit = { isAppendCircuitOpen: (): boolean => true };

describe('ChatManager 待对账队列消费（TB-10 回归）', () => {
  const originalDelay = ChatManagerImpl.reconcileDrainDelayMs;

  beforeEach(() => {
    // 缩短去抖窗口，避免测试真等 3s（仅本文件生效，afterAll 还原）
    ChatManagerImpl.reconcileDrainDelayMs = 30;
  });

  afterAll(() => {
    ChatManagerImpl.reconcileDrainDelayMs = originalDelay;
  });

  it('入队后经去抖窗口自动执行一次对账（队列有了消费者）', async () => {
    const cm = new ChatManagerImpl();
    let drains = 0;
    cm.runPendingReconciles = async (): Promise<void> => {
      drains += 1;
    };

    internals(cm)._requestReconcile('sess-tb10-a', openCircuit);
    // 未到窗口 ⇒ 尚未消费（证明不是同步调用，而是延迟调度）
    expect(drains).toBe(0);

    await sleep(150);
    expect(drains).toBe(1);
  });

  it('同一窗口内多次入队只消费一次（去抖合并，避免失败风暴放大）', async () => {
    const cm = new ChatManagerImpl();
    let drains = 0;
    cm.runPendingReconciles = async (): Promise<void> => {
      drains += 1;
    };

    internals(cm)._requestReconcile('sess-tb10-b1', openCircuit);
    internals(cm)._requestReconcile('sess-tb10-b2', openCircuit);
    internals(cm)._requestReconcile('sess-tb10-b3', openCircuit);

    await sleep(150);
    expect(drains).toBe(1);
  });

  it('熔断期入队被跳过 ⇒ 不入队也不调度对账（防风暴）', async () => {
    const cm = new ChatManagerImpl();
    let drains = 0;
    cm.runPendingReconciles = async (): Promise<void> => {
      drains += 1;
    };

    internals(cm)._requestReconcile('sess-tb10-c', closedCircuit);

    await sleep(150);
    expect(drains).toBe(0);
    expect(internals(cm)._pendingReconcileSessions.size).toBe(0);
  });

  it('消费进行中新入队的会话不被丢弃（只删已处理项，不再 clear）', async () => {
    const cm = new ChatManagerImpl();
    const queue = internals(cm)._pendingReconcileSessions;
    queue.add('sess-tb10-d1');
    queue.add('sess-tb10-d2');

    // 走真实消费路径：内部会尝试读取这两个（不存在的）会话，异常由 handleError 逐会话吞掉
    const running = cm.runPendingReconciles();
    // 消费进行中又有一个会话入队（同一次故障风暴的场景）
    queue.add('sess-tb10-d3');
    await running;

    expect(queue.has('sess-tb10-d1')).toBe(false);
    expect(queue.has('sess-tb10-d2')).toBe(false);
    // 修复前这里是 `clear()` ⇒ d3 会被静默丢弃
    expect(queue.has('sess-tb10-d3')).toBe(true);
  });
});
