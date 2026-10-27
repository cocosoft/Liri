/**
 * FIX-13（2026-10-27）：`SessionsTool` 初始化**不创建**任何硬编码会话。
 *
 * 真机背景：旧实现在首次使用时 `getSession('sess_001')` + `createSession({id:'sess_001',
 * title:'默认会话'})` —— 生产代码凭空写入一条 CS04 禁止的固定数据；该会话没有事件与
 * 消息文件，于是每次启动崩溃恢复都报「重算结果为空，疑消息文件丢失」（08:54:47）。
 */
import { describe, expect, it } from 'bun:test';
import { SessionsTool } from '../../src/tools/SessionsTool/SessionsTool';

interface GatewayRecorder {
  initialized: number;
  created: unknown[];
  queried: string[];
}

function makeTool(): { tool: SessionsTool; rec: GatewayRecorder } {
  const rec: GatewayRecorder = { initialized: 0, created: [], queried: [] };
  const gateway = {
    initialize: async () => {
      rec.initialized += 1;
    },
    getSession: async (id: string) => {
      rec.queried.push(id);
      return null;
    },
    createSession: async (input: unknown) => {
      rec.created.push(input);
      return input;
    },
  };
  return { tool: new SessionsTool(gateway as never), rec };
}

describe('FIX-13 SessionsTool 初始化不得造数据', () => {
  it('初始化只拉起 gateway，不查询/创建任何会话', async () => {
    const { tool, rec } = makeTool();
    const priv = tool as unknown as {
      ensureGatewayInitialized: () => Promise<void>;
    };
    await priv.ensureGatewayInitialized();

    expect(rec.initialized).toBe(1);
    expect(rec.queried).toEqual([]);
    expect(rec.created).toEqual([]);
  });

  it('重复调用只初始化一次', async () => {
    const { tool, rec } = makeTool();
    const priv = tool as unknown as {
      ensureGatewayInitialized: () => Promise<void>;
    };
    await priv.ensureGatewayInitialized();
    await priv.ensureGatewayInitialized();
    expect(rec.initialized).toBe(1);
  });
});
