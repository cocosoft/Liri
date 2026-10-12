/**
 * G-1 / G-2 —— MCP 凭据脱敏与显式 env 审计（2026-10-12）。
 *
 * 背景（回仓取证）：
 * - **G-1**：`mcp__*` 工具的模型可见路径是 `McpToolWrapper`（由 `MCPToolBridge` 注册进工具端口），
 *   其 `execute` 原实现**直接回传未脱敏文本** ⇒ 远端 server 回传的 API key / token 可原样进入
 *   模型上下文。带脱敏的 `MCPServerManager.callTool` 仅被 CLI（`cli/mcpCommand.ts`）调用 ⇒ 两条
 *   路径脱敏不一致。修复：在 wrapper 返回前统一套 `filterMCPToolResult` / `redactMcpPayload`。
 * - **G-2**：`StdioTransport` 原构造 `{ ...buildSafeEnv(Object.keys(options.env)), ...options.env }`
 *   把显式配置键喂给 `buildSafeEnv`（触发 `env_blocked` 告警）却又被尾部展开原样透传 ⇒
 *   **语义自相矛盾**。修复：宿主只取白名单基线；显式配置经 `auditExplicitEnv()` 审计后合并。
 *
 * 本文件把上述两条修复变成可执行断言（离线、确定；不 spawn 子进程）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpToolWrapper } from '../../src/services/mcp/McpToolWrapper.js';
import { StdioTransport } from '../../src/services/mcp/transports/StdioTransport.js';
import {
  auditExplicitEnv,
  redactMcpPayload,
  stripCredentials,
} from '../../src/services/mcp/MCPSecurityFilter.js';

/** OpenAI 风格密钥（命中 `/sk-(?:ant|proj)-[A-Za-z0-9_-]{32,}/`） */
const OPENAI_KEY = `sk-proj-${'A'.repeat(40)}`;
/** AWS 访问密钥（命中 `/AKIA[0-9A-Z]{16}/`） */
const AWS_KEY = `AKIA${'B'.repeat(16)}`;

/** 最小可用上下文（仅取 abortController） */
function ctx(controller: AbortController) {
  return { abortController: controller, toolUseId: 'tc-1' } as never;
}

function wrapperReturning(result: unknown): McpToolWrapper {
  const fakeClient = {
    callTool: async () => result,
  } as unknown as Client;
  return new McpToolWrapper(
    'srv',
    { name: 't', description: 'd' } as never,
    () => fakeClient
  );
}

const TOUCHED_ENV: string[] = [];
afterEach(() => {
  for (const key of TOUCHED_ENV.splice(0)) delete process.env[key];
});

describe('G-1 MCP 工具结果凭据脱敏（模型可见路径）', () => {
  it('McpToolWrapper：文本输出中的密钥被剥离并附加 System note', async () => {
    const wrapper = wrapperReturning({
      content: [{ type: 'text', text: `token=${OPENAI_KEY}` }],
      isError: false,
    });

    const r = await wrapper.execute({}, ctx(new AbortController()));

    expect(r.success).toBe(true);
    expect(String(r.output)).not.toContain(OPENAI_KEY);
    expect(String(r.output)).toContain('[REDACTED:api_key]');
    expect(String(r.output)).toContain('credential(s) were redacted');
  });

  it('McpToolWrapper：结构化 `data` 同步脱敏（JSON 往返）', async () => {
    const wrapper = wrapperReturning({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { aws: AWS_KEY },
      isError: false,
    });

    const r = await wrapper.execute({}, ctx(new AbortController()));

    expect(JSON.stringify(r.data)).not.toContain(AWS_KEY);
    expect(JSON.stringify(r.data)).toContain('[REDACTED:aws_key]');
  });

  it('McpToolWrapper：无密钥时输出原样回传（零行为变更）', async () => {
    const wrapper = wrapperReturning({
      content: [{ type: 'text', text: 'plain result' }],
      isError: false,
    });

    const r = await wrapper.execute({}, ctx(new AbortController()));

    expect(r.output).toBe('plain result');
  });

  it('redactMcpPayload：仅替换凭据子串，非凭据字段不变', () => {
    const out = redactMcpPayload({
      name: 'demo',
      token: AWS_KEY,
    }) as Record<string, string>;

    expect(out.name).toBe('demo');
    expect(out.token).not.toContain(AWS_KEY);
  });

  it('stripCredentials（基线自证）：命中已知模式才计数', () => {
    expect(stripCredentials('nothing here').redactedCount).toBe(0);
    expect(stripCredentials(`x ${OPENAI_KEY} y`).redactedCount).toBe(1);
  });
});

describe('G-2 显式配置 env 与宿主白名单分离', () => {
  it('auditExplicitEnv：按设计放行（返回值与入参一致），空值返回 {}', () => {
    const env = { MCP_OWN_TOKEN: 'own-value', SAFE_KEY: '1' };
    expect(auditExplicitEnv(env)).toEqual(env);
    expect(auditExplicitEnv(undefined)).toEqual({});
  });

  it('StdioTransport：显式配置 env 放行；宿主**非白名单**变量不被隐式继承', () => {
    const hostOnly = 'LIRI_TEST_HOST_NON_WHITELISTED';
    process.env[hostOnly] = 'host-value';
    TOUCHED_ENV.push(hostOnly);

    const transport = new StdioTransport({
      command: 'noop',
      args: [],
      env: { MCP_OWN_TOKEN: 'own-value' },
    });
    const env = (transport as unknown as { env: Record<string, string> }).env;

    // 显式配置（server 自身凭据）按设计合并
    expect(env.MCP_OWN_TOKEN).toBe('own-value');
    // 宿主非白名单变量不得被隐式继承
    expect(env[hostOnly]).toBeUndefined();
    // 宿主**白名单**内变量照常继承（PATH 在 SAFE_ENV_KEYS 内）
    if (process.env.PATH !== undefined) {
      expect(env.PATH).toBe(process.env.PATH);
    }
  });
});
