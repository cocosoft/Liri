// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Q-18（2026-10-23）：`mcp_auth` rewrite 接线的回归锁。
 *
 * 锁定五点：
 * ① `MCP_OAUTH` 关门 ⇒ 明确失败（不做任何认证动作）；
 * ② `list` / `status` 与 `mcpAuthManager.hasToken()` 同源；
 * ③ `login` 走 `initiateAuth()` 并返回**授权 URL**（不假装已登录）；
 * ④ `logout` 走 `revokeToken()`；`refresh` 走 `getAccessToken()` 且**绝不回传 token**；
 * ⑤ 声明面：风险 `external`（对外部系统可见影响）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  McpAuthTool,
  type McpAuthManagerLike,
  type McpServerManagerLike,
} from '../../src/tools/McpAuthTool/McpAuthTool';
import { deriveOAuthConfig } from '../../src/services/mcp/auth/deriveOAuthConfig';
import { deriveToolRiskClass } from '../../src/tools/toolRiskClass';
import type { MCPServerConfig } from '../../src/services/mcp/types';
import type { MCPOAuthConfig } from '../../src/services/mcp/auth/types';

const OAUTH_SERVER: MCPServerConfig = {
  name: 'octo',
  url: 'https://mcp.example.com/sse',
  oauth: { clientId: 'cid-1' },
} as unknown as MCPServerConfig;

const PLAIN_SERVER: MCPServerConfig = {
  name: 'plain',
  url: 'https://plain.example.com/sse',
} as unknown as MCPServerConfig;

function makeDeps(initialTokens: string[] = []): {
  manager: McpServerManagerLike;
  auth: McpAuthManagerLike;
  calls: { initiate: MCPOAuthConfig[]; revoke: string[]; access: string[] };
  tokens: Set<string>;
} {
  const configs = new Map<string, MCPServerConfig>([
    ['octo', OAUTH_SERVER],
    ['plain', PLAIN_SERVER],
  ]);
  const tokens = new Set(initialTokens);
  const calls = {
    initiate: [] as MCPOAuthConfig[],
    revoke: [] as string[],
    access: [] as string[],
  };

  const manager: McpServerManagerLike = {
    listServers: () => Array.from(configs.keys()),
    getServer: (name) => {
      const cfg = configs.get(name);
      return cfg ? { getConfig: () => cfg } : undefined;
    },
  };

  const auth: McpAuthManagerLike = {
    hasToken: (serverKey) => tokens.has(serverKey),
    initiateAuth: async (cfg) => {
      calls.initiate.push(cfg);
      return { authUrl: `${cfg.authUrl}?state=st-1`, state: 'st-1' };
    },
    getAccessToken: async (serverKey) => {
      calls.access.push(serverKey);
      return 'secret-token-value';
    },
    revokeToken: async (serverKey) => {
      calls.revoke.push(serverKey);
      tokens.delete(serverKey);
    },
  };

  return { manager, auth, calls, tokens };
}

let prevFlag: string | undefined;
beforeAll(() => {
  prevFlag = process.env.FEATURE_MCP_OAUTH;
  process.env.FEATURE_MCP_OAUTH = 'true';
});
afterAll(() => {
  if (prevFlag === undefined) delete process.env.FEATURE_MCP_OAUTH;
  else process.env.FEATURE_MCP_OAUTH = prevFlag;
});

describe('mcp_auth：门控', () => {
  it('FEATURE_MCP_OAUTH 关闭 ⇒ 明确失败（不调用任何认证方法）', async () => {
    const { manager, auth, calls } = makeDeps();
    process.env.FEATURE_MCP_OAUTH = 'false';
    try {
      const tool = new McpAuthTool({ manager, auth });
      const result = await tool.execute(
        { action: 'login', serverName: 'octo' },
        {} as never
      );
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain('FEATURE_MCP_OAUTH');
      expect(calls.initiate).toHaveLength(0);
    } finally {
      process.env.FEATURE_MCP_OAUTH = 'true';
    }
  });
});

describe('mcp_auth：状态投影（与 hasToken 同源）', () => {
  it('list：逐服务器给出 oauthConfigured / hasToken', async () => {
    const { manager, auth } = makeDeps(['octo']);
    const tool = new McpAuthTool({ manager, auth });

    const result = await tool.execute({ action: 'list' }, {} as never);
    const data = result.data as {
      servers: Array<{
        serverName: string;
        oauthConfigured: boolean;
        hasToken: boolean;
      }>;
      total: number;
      oauthConfigured: number;
    };

    expect(data.total).toBe(2);
    expect(data.oauthConfigured).toBe(1);
    expect(data.servers).toEqual([
      { serverName: 'octo', oauthConfigured: true, hasToken: true },
      { serverName: 'plain', oauthConfigured: false, hasToken: false },
    ]);
  });

  it('status：未注册服务器 ⇒ oauthConfigured=false（不抛错）', async () => {
    const { manager, auth } = makeDeps();
    const tool = new McpAuthTool({ manager, auth });

    const result = await tool.execute(
      { action: 'status', serverName: 'ghost' },
      {} as never
    );
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      serverName: 'ghost',
      oauthConfigured: false,
      hasToken: false,
    });
  });
});

describe('mcp_auth：login / logout / refresh', () => {
  it('login：返回授权 URL（由用户浏览器打开），不自称已登录', async () => {
    const { manager, auth, calls } = makeDeps();
    const tool = new McpAuthTool({ manager, auth });

    const result = await tool.execute(
      { action: 'login', serverName: 'octo' },
      {} as never
    );

    expect(result.success).toBe(true);
    expect(calls.initiate).toHaveLength(1);
    expect(calls.initiate[0]).toEqual(
      deriveOAuthConfig(OAUTH_SERVER) as MCPOAuthConfig
    );
    expect(result.data).toMatchObject({
      authUrl: expect.stringContaining('https://mcp.example.com/authorize'),
      state: 'st-1',
      hasToken: false,
    });
  });

  it('login：服务器未配置 OAuth ⇒ 失败并给出所需字段', async () => {
    const { manager, auth } = makeDeps();
    const tool = new McpAuthTool({ manager, auth });

    const result = await tool.execute(
      { action: 'login', serverName: 'plain' },
      {} as never
    );
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('oauth.clientId');
  });

  it('logout：调用 revokeToken 并回报 token 已清除', async () => {
    const { manager, auth, calls, tokens } = makeDeps(['octo']);
    const tool = new McpAuthTool({ manager, auth });

    const result = await tool.execute(
      { action: 'logout', serverName: 'octo' },
      {} as never
    );

    expect(result.success).toBe(true);
    expect(calls.revoke).toEqual(['octo']);
    expect(tokens.has('octo')).toBe(false);
    expect(result.data).toMatchObject({ hasToken: false });
  });

  it('refresh：确保有效 token，但**不回传** token 明文', async () => {
    const { manager, auth, calls } = makeDeps(['octo']);
    const tool = new McpAuthTool({ manager, auth });

    const result = await tool.execute(
      { action: 'refresh', serverName: 'octo' },
      {} as never
    );

    expect(result.success).toBe(true);
    expect(calls.access).toEqual(['octo']);
    expect(result.data).toMatchObject({ tokenValid: true });
    expect(JSON.stringify(result)).not.toContain('secret-token-value');
  });
});

describe('mcp_auth：声明面', () => {
  it('对外部系统有可见影响 ⇒ 风险 external（需审批）', () => {
    const { manager, auth } = makeDeps();
    const tool = new McpAuthTool({ manager, auth });

    expect(deriveToolRiskClass(tool, {})).toBe('external');
    expect(tool.getInfo().riskClass).toBe('external');
    expect(tool.params.map((p) => p.name)).toEqual(['action', 'serverName']);
  });
});
