// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 共享会话网关（CombinedSessionGateway）**接线与懒引导**回归测试
//
// 契约（两层，缺一不可）：
//   ① 懒引导：`ModuleInitializer` 只把实例注册进 DI，**不**在启动期 initialize()
//      —— 启动期不多起第二个 `SessionGateway`（自带 storage / FTS 索引 / 崩溃恢复扫描）；
//   ② 首次用到即自引导：任何入口（如 sendMessage/getMessages）无需调用方先 initialize()，
//      否则写端会抛「No active gateway found for session: shared-context」（被 catch 吞成
//      warning）、读端 `getMessages` 静默返回空 —— 共享上下文特性整体失效且不可见。

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
    // 关掉（若已懒引导出的）默认网关的 FTS 持久化定时器
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
  it('注册后**不**引导（懒初始化：启动期不起第二个 SessionGateway）', async () => {
    const gw = await registerViaInitializer();

    expect(gw.isInitialized()).toBe(false);
    expect(gw.getActiveAgentIds()).toEqual([]);
  });

  it('首次写入即自引导：shared-context 可写入并读回（调用方无需先 initialize）', async () => {
    const gw = await registerViaInitializer();

    await gw.sendMessage('shared-context', {
      id: 'msg-1',
      sessionId: 'shared-context',
      type: MessageType.USER,
      role: MessageRole.USER,
      content: 'hi',
      timestamp: Date.now(),
    });

    expect(gw.getActiveAgentIds()).toEqual([DEFAULT_AGENT_ID]);

    const messages = await gw.getMessages('shared-context', { limit: 10 });
    expect(messages.map((m) => m.content)).toContain('hi');
  });
});
