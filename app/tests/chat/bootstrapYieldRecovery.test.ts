// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B1-4 验收：**回放脱离 `streamMessage`** —— 改由启动钩子触发（方案 P0-4 / §11 第 1 步）
 *
 * 验收原文：「**不发起任何会话请求，`pending` 行仍被回放**」。
 *
 * 修复前的失败面：装配（`_ensureYieldResumerInstalled`，内含 `replayPendingSettlements`）
 * 只在 `streamMessage` / `sendMessage` 入口发生 ⇒ 启动后**无人发消息时**
 * `agent_settlement_outbox` 的 `pending` 行永不回放；且等待集不落盘 ⇒ 即使回放也
 * 必然 `markFailed`（8 次后 `dropped`）。本文件锁定 `bootstrapYieldRecovery()` 的
 * 三步顺序在"零会话请求"下确实把 `pending` 行投递出去。
 *
 * 隔离手法（照抄既有同类测试，不另立新法）：
 * - 临时目录 DB：`YieldWaitingStore(dbPath)` / `SettlementOutbox(dbPath)`（`tmpdir()`，用后删）；
 * - 注入实例（`bootstrapYieldRecovery({ registry, store, outbox })`）——
 *   回放链路读的是**进程级单例**，若走单例就会污染真实 `~/.pyapp/data/app.db`。
 *   **本文件不触碰真实 DB**（用例中不给单例注入任何临时端口，见 afterEach 的显式还原）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'crypto';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ChatManagerImpl } from '../../src/chat/ChatManager.js';
import { SettlementOutbox } from '../../src/chat/yield/SettlementOutbox';
import {
  setYieldResumeHandler,
  // B4-1（2026-09-23）：恢复审计追加器 —— 本文件是**唯一会构造 ChatManagerImpl 的恢复用例**，
  // 其构造期会装配审计出口 ⇒ 若不卸下，恢复会往**真实** `~/.pyapp/data/sessions/**` 落
  // `agent/recovery` 事件（测试污染）。测试不验证该出口，故显式卸下（与 AgentRunStore 的
  // 测试隔离同口径：`tests/setupIsolateAgentStore.ts`）。
  setYieldRecoveryAuditSink,
  yieldSettlementListeners,
} from '../../src/chat/yield';
import {
  YieldRegistry,
  YieldWaitingStore,
  getYieldRegistry,
  resetYieldRegistry,
  setActiveSubagentRunProbe,
} from '../../src/session/yield';
import { setSelfWakeResumeHandler } from '../../src/tasks/selfwake/SelfWakeService';

/** Bun 运行时全局：tsc 类型面未声明 `gc`，按仓内既有约定就地声明（见 tests/tools/notebook.test.ts） */
declare const Bun: { gc(force: boolean): void };

const createdPaths: string[] = [];
const openedStores: YieldWaitingStore[] = [];
const openedOutboxes: SettlementOutbox[] = [];

function tempDbPath(prefix: string): string {
  const path = join(tmpdir(), `${prefix}-${randomUUID().slice(0, 8)}.db`);
  createdPaths.push(path);
  return path;
}

async function makeStore(): Promise<YieldWaitingStore> {
  const store = new YieldWaitingStore(tempDbPath('yield-waiting'));
  openedStores.push(store);
  await store.init();
  return store;
}

async function makeOutbox(): Promise<SettlementOutbox> {
  const outbox = new SettlementOutbox(tempDbPath('yield-outbox'));
  openedOutboxes.push(outbox);
  await outbox.init();
  return outbox;
}

/**
 * 用测试替身替换实例的**流式入口**（恢复执行器的最终落点）。
 *
 * 恢复执行器（`_resumeSessionInternally`）按设计会内部消费一次 `streamMessage`
 * 以续跑父会话；本替身把这次消费收敛为"立即成功返回空流"：
 * ① 满足验收前提「不发起任何会话请求」（无模型调用、无会话落盘）；
 * ② 使最强断言（台账落 `delivered`）可达 —— 恢复 handler 返回 ok 才可能被 ack。
 *
 * 注意：本文件**不调用** `streamMessage` / `sendMessage` 触发装配；替身只是证明
 * "回放确实推进到了恢复执行器"的观测点。
 */
function installRecordingStream(cm: ChatManagerImpl, calls: string[]): void {
  // B4-1：`ChatManagerImpl` 构造期会装配恢复审计出口；本文件不验证该出口，
  // 且恢复会真的往 `~/.pyapp/data/sessions/**` 落事件（真实目录，测试污染）
  // ⇒ 构造后立即卸下（本文件的"让 ChatManagerImpl 变惰性"的统一入口）。
  setYieldRecoveryAuditSink(null);
  const stream = async function* (
    _content: string,
    options?: { sessionId?: string }
  ): AsyncGenerator<string, void, unknown> {
    calls.push(options?.sessionId ?? '');
  };
  (cm as unknown as { streamMessage: unknown }).streamMessage = stream;
}

/** 轮询等待台账行进入期望状态（回放为 fire-and-forget，需等其落地） */
async function waitForState(
  outbox: SettlementOutbox,
  id: number,
  expected: 'delivered' | 'failed',
  timeoutMs = 2000
): Promise<string | undefined> {
  const start = Date.now();
  let state = (await outbox.getRow(id))?.state;
  while (state !== expected && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    state = (await outbox.getRow(id))?.state;
  }
  return state;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 删除临时库（含 WAL 边车文件）。
 *
 * 句柄若尚未真正释放，Windows 上 `unlink` 会 `EBUSY: resource busy or locked`；
 * 故退避重试兜底（正常路径一次即成功）。
 */
async function removeTempDb(path: string): Promise<void> {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${path}${suffix}`;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!existsSync(file)) break;
      try {
        unlinkSync(file);
        break;
      } catch {
        // @ignore-catch — 句柄尚未释放：退避后重试
        await sleep(25);
      }
    }
  }
}

afterEach(async () => {
  // 显式还原模块级单例与全局装配（与既有 yield 测试同款），避免跨用例串味
  setYieldResumeHandler(null);
  setSelfWakeResumeHandler(null);
  setActiveSubagentRunProbe(null);
  // B4-1：卸下审计出口（构造 ChatManagerImpl 时被装配）⇒ 不往真实会话目录写 agent/recovery
  setYieldRecoveryAuditSink(null);
  yieldSettlementListeners.length = 0;
  // 先断开临时库端口再清空单例：否则 clear() 会对即将关闭的临时库发 clearAll
  getYieldRegistry().setPersistence(null);
  resetYieldRegistry();

  while (openedOutboxes.length > 0) openedOutboxes.pop()!.close();
  while (openedStores.length > 0) openedStores.pop()!.close();
  // 删文件前**必须强制 GC**：`core/external/sqlite3` 的 run/get/all 每次
  // `prepare()` 后即丢弃语句引用，而 `close()` 的错误被无回调的 catch 吞掉 ——
  // 预编译语句未被 GC 终结时 bun:sqlite 的 close 只是"僵尸化"连接，文件句柄
  // 继续被占（实测 EBUSY 可达数十次重试仍失败），临时库便删不掉。
  // （既有 tests/chat/settlementOutbox.test.ts 的同类临时库因此已泄漏上千个文件。）
  Bun.gc(true);
  while (createdPaths.length > 0) await removeTempDb(createdPaths.pop()!);
});

describe('B1-4：启动钩子触发回放（不发起任何会话请求）', () => {
  it('主用例：直接调 bootstrapYieldRecovery ⇒ pending 行被投递（attempting → delivered）', async () => {
    const store = await makeStore();
    const outbox = await makeOutbox();
    const sessionId = 's-boot-replay';
    const yieldedAt = 1000;
    const endedAt = 2000;

    // 预置崩溃重启现场：「谁在等」（等待集）+「结算信号」（台账 pending）
    await store.saveRecord({
      sessionId,
      turn: 5,
      toolCallId: 'c-boot',
      yieldedAt,
    });
    const rowId = await outbox.enqueue({ sessionId, endedAt });
    expect((await outbox.getRow(rowId))?.state).toBe('pending');

    // 回放链路（YieldResumer.handleYieldSettlement）读的正是这个进程级注册表
    const registry = getYieldRegistry();
    const cm = new ChatManagerImpl();
    const resumed: string[] = [];
    installRecordingStream(cm, resumed);

    // 关键：不调用 streamMessage / sendMessage 触发装配，只走启动钩子
    await cm.bootstrapYieldRecovery({ registry, store, outbox });

    // 修复前（装配只在 streamMessage 入口）此处恒为 pending：无人发消息 ⇒ 永不回放
    expect(await waitForState(outbox, rowId, 'delivered')).toBe('delivered');
    expect((await outbox.getRow(rowId))?.attempts).toBe(1);
    // 投递成功的前提是等待集已重建（否则 registry.get() 为 undefined ⇒ markFailed）
    expect(resumed).toEqual([sessionId]);
    // 恢复收敛：等待登记被 resolve（不再等待）
    expect(registry.isWaiting(sessionId)).toBe(false);
  });

  it('无 pending 行 ⇒ 回放不产生副作用（不误恢复、不写脏状态）', async () => {
    const store = await makeStore();
    const outbox = await makeOutbox();
    const sessionId = 's-boot-idle';
    await store.saveRecord({
      sessionId,
      turn: 5,
      toolCallId: 'c-idle',
      yieldedAt: 1000,
    });

    const registry = getYieldRegistry();
    const cm = new ChatManagerImpl();
    const resumed: string[] = [];
    installRecordingStream(cm, resumed);

    await cm.bootstrapYieldRecovery({ registry, store, outbox });
    await sleep(50); // 给 fire-and-forget 的回放留出窗口

    expect(await outbox.listAll()).toHaveLength(0); // 无候选 ⇒ 台账不被写脏
    expect(resumed).toEqual([]); // 无结算信号 ⇒ 不触发恢复
    // 等待集重建是"只恢复等待者"，不构成"自动收敛"：仍在等待中
    expect(registry.isWaiting(sessionId)).toBe(true);
  });

  it('等待集未被重建（回放读不到等待者）⇒ 同一 pending 行走 markFailed 路径', async () => {
    const store = await makeStore();
    const outbox = await makeOutbox();
    const sessionId = 's-boot-norebuild';
    await store.saveRecord({
      sessionId,
      turn: 5,
      toolCallId: 'c-nb',
      yieldedAt: 1000,
    });
    const rowId = await outbox.enqueue({ sessionId, endedAt: 2000 });

    // 注入**非进程级**的独立注册表：重建落在它身上，而恢复通路读的是
    // `getYieldRegistry()` ⇒ 等价于"等待集未被重建"。
    // 这条反例正是 `rebuildYieldWaitingSet` 必须前置的证据：顺序一错（或不重建）即逐行 markFailed。
    const orphanRegistry = new YieldRegistry();
    const cm = new ChatManagerImpl();
    const resumed: string[] = [];
    installRecordingStream(cm, resumed);

    await cm.bootstrapYieldRecovery({
      registry: orphanRegistry,
      store,
      outbox,
    });

    expect(await waitForState(outbox, rowId, 'failed')).toBe('failed');
    expect((await outbox.getRow(rowId))?.attempts).toBe(1);
    expect(resumed).toEqual([]); // 无等待者 ⇒ 恢复执行器根本不被调用
    expect(getYieldRegistry().isWaiting(sessionId)).toBe(false);
    // 重建本身确实执行了（记录落到了另一个注册表）—— 证明失败原因不是"没重建"而是"重建目标错"
    expect(orphanRegistry.isWaiting(sessionId)).toBe(true);
  });
});
