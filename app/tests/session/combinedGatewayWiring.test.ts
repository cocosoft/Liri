// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 共享会话网关（CombinedSessionGateway）**接线**回归测试
//
// 覆盖：`ModuleInitializer` 把 `combinedSessionGateway` 注册进 DI 容器后，必须**已 initialize()**。
// 修前遗漏该调用 ⇒ `agents` 恒空 ⇒ `sendMessage('shared-context', …)` 抛
// 「No active gateway found for session: shared-context」——写端被 try/catch 吞成 warning、
// 读端 `getMessages` 静默返回空，故「共享上下文」特性整体失效且故障不可见。

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ModuleInitializer } from '../../src/modules/ModuleInitializer';
import { getDIContainer } from '../../src/core/DIContainer';
import {
  CombinedSessionGateway,
  DEFAULT_AGENT_ID,
} from '../../src/session/gateway/CombinedSessionGateway';
import {
  MessageType,
  MessageRole,
} from '../../src/session/types/UnifiedMessage';

const KEY = 'combinedSessionGateway';

let dataDir: string;

beforeEach(() => {
  // 隔离默认 SessionGateway 的存储目录（resolveSessionsDir() 实时读 LIRI_DATA_DIR）
  dataDir = mkdtempSync(join(tmpdir(), 'combined-gw-'));
  process.env.LIRI_DATA_DIR = dataDir;
  getDIContainer().clear(KEY);
});

afterEach(async () => {
  const container = getDIContainer();
  if (container.has(KEY)) {
    const gw = container.resolve<CombinedSessionGateway>(KEY);
    // 关掉默认网关的 FTS 持久化定时器
    await gw.getAgent(DEFAULT_AGENT_ID)?.close();
    container.clear(KEY);
  }
  delete process.env.LIRI_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

/** 走与启动期同一条注册路径（私有方法，测试内以结构类型取用） */
async function registerViaInitializer(): Promise<CombinedSessionGateway> {
  const init = ModuleInitializer.getInstance() as unknown as {
    _registerCombinedGateway(): Promise<void>;
  };
  await init._registerCombinedGateway();
  return getDIContainer().resolve<CombinedSessionGateway>(KEY);
}

describe('ModuleInitializer 注册共享会话网关', () => {
  it('注册后默认 Agent 已登记（agents 非空）', async () => {
    const gw = await registerViaInitializer();

    expect(gw.getActiveAgentIds()).toEqual([DEFAULT_AGENT_ID]);
  });

  it('注册后写入 + 读回 shared-context 不再抛「No active gateway found」', async () => {
    const gw = await registerViaInitializer();

    await gw.sendMessage('shared-context', {
      id: 'msg-1',
      sessionId: 'shared-context',
      type: MessageType.USER,
      role: MessageRole.USER,
      content: 'hi',
      timestamp: Date.now(),
    });

    const messages = await gw.getMessages('shared-context', { limit: 10 });
    expect(messages.map((m) => m.content)).toContain('hi');
  });
});
