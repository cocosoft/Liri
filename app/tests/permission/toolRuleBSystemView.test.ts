// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * R1.5（2026-11-17，外部评审 P0-2）：把 B 体系命令规则纳入治理视图（**只读**）。
 *
 * 锁三件事：
 * 1. `readCommandRulesConfig()` 的只读视图形状（未配置 ⇒ null，不臆造空列表）；
 * 2. `GET /v1/permissions/rules` 响应带 `commandRules`，且标 `readOnly/source=commandRules`；
 * 3. `simulate` 的 `customRuleVerdict` 与判定链**同一读取点**（`checkCommandCustomRules`），
 *    能区分"被 A 体系规则拦"与"被命令级黑白名单拦"。
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type http from 'http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configManager, getConfigManager } from '@openliri/infra/config';
import { PermissionManager } from '@openliri/infra/permission/PermissionManager';

import {
  buildCommandRulesView,
  handleListPermissionRules,
} from '../../src/infrastructure/http/handlers/permission-handlers';

const COMMAND_RULES = {
  customRules: {
    commandRules: {
      mode: 'blacklist',
      blacklist: [{ pattern: 'node', matchType: 'prefix' }],
      whitelist: [{ pattern: 'git', matchType: 'prefix' }],
    },
  },
};

let configSpy: ReturnType<typeof spyOn> | undefined;

/**
 * 让 `permission` 配置段返回固定值（其余键回落 undefined）。
 *
 * 注意：必须 spy **实例**（`getConfigManager()`），不能 spy 导出的 `configManager`
 * —— 后者是 Proxy，`spyOn` 写不到被代理的实例上（会静默失效）。
 */
function stubPermissionConfig(value: unknown): void {
  configSpy = spyOn(getConfigManager(), 'getConfigValue').mockImplementation(((
    key: string
  ) =>
    key === 'permission'
      ? value
      : undefined) as unknown as typeof configManager.getConfigValue);
}

function captureRes(): {
  res: http.ServerResponse;
  captured: { status: number; body: string };
} {
  const captured = { status: 0, body: '' };
  const res = {
    writeHead(status: number) {
      captured.status = status;
    },
    end(body?: string) {
      captured.body = body ?? '';
    },
  } as unknown as http.ServerResponse;
  return { res, captured };
}

afterEach(() => {
  configSpy?.mockRestore();
  configSpy = undefined;
});

describe('R1.5：B 体系命令规则只读视图（纯函数）', () => {
  it('未配置 ⇒ null（空即空，不臆造空列表）', () => {
    expect(buildCommandRulesView(undefined)).toBeNull();
  });

  it('已配置 ⇒ 带 readOnly/source/mode 与原始列表', () => {
    const view = buildCommandRulesView({
      mode: 'blacklist',
      blacklist: [{ pattern: 'node', matchType: 'prefix' }],
      whitelist: [],
    });
    expect(view).not.toBeNull();
    expect(view!['readOnly']).toBe(true);
    expect(view!['source']).toBe('commandRules');
    expect(view!['mode']).toBe('blacklist');
    expect(view!['blacklist']).toEqual([
      { pattern: 'node', matchType: 'prefix' },
    ]);
    expect(String(view!['note'])).toContain('只读');
  });
});

describe('R1.5：GET /v1/permissions/rules 的 commandRules 块', () => {
  it('响应带只读 commandRules（来源 commandRules）', async () => {
    stubPermissionConfig(COMMAND_RULES);
    const { res, captured } = captureRes();

    await handleListPermissionRules({} as http.IncomingMessage, res);

    expect(captured.status).toBe(200);
    const body = JSON.parse(captured.body) as {
      rules: unknown[];
      commandRules: Record<string, unknown> | null;
    };
    expect(Array.isArray(body.rules)).toBe(true);
    expect(body.commandRules).not.toBeNull();
    expect(body.commandRules!['readOnly']).toBe(true);
    expect(body.commandRules!['source']).toBe('commandRules');
    expect(body.commandRules!['blacklist']).toEqual([
      { pattern: 'node', matchType: 'prefix' },
    ]);
  });

  it('未配置 ⇒ commandRules 为 null（不伪造空策略）', async () => {
    stubPermissionConfig({});
    const { res, captured } = captureRes();

    await handleListPermissionRules({} as http.IncomingMessage, res);

    const body = JSON.parse(captured.body) as { commandRules: unknown };
    expect(body.commandRules).toBeNull();
  });
});

describe('R1.5：simulate 的 customRuleVerdict 与判定链同源', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-b-system-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** 隔离实例：规则源指向临时文件、settings 上下文清空（避免读到本机配置） */
  function isolatedManager(): PermissionManager {
    const manager = new PermissionManager();
    manager.getRuleManager().setRuleSource(join(dir, 'tool_rules.json'));
    manager.getRuleManager().loadRules();
    manager.setToolPermissionContext({
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    });
    manager.setMode('auto');
    return manager;
  }

  it('黑名单命中 ⇒ 最终 deny 且 customRuleVerdict=deny（原因同链）', async () => {
    stubPermissionConfig(COMMAND_RULES);
    const manager = isolatedManager();

    const result = await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'node a.js' },
    });

    expect(result.decision).toBe('deny');
    expect(result.customRuleVerdict).toEqual({
      behavior: 'deny',
      reason: '命令命中自定义黑名单',
    });
  });

  it('白名单模式命中 ⇒ allow；未配置 ⇒ null', async () => {
    stubPermissionConfig({
      customRules: {
        commandRules: {
          mode: 'whitelist',
          blacklist: [],
          whitelist: [{ pattern: 'git', matchType: 'prefix' }],
        },
      },
    });
    const manager = isolatedManager();

    const hit = await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'git status' },
    });
    expect(hit.decision).toBe('allow');
    expect(hit.customRuleVerdict?.behavior).toBe('allow');

    configSpy?.mockRestore();
    stubPermissionConfig({});
    const none = await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'git status' },
    });
    expect(none.customRuleVerdict).toBeNull();
  });

  it('非命令工具 ⇒ null（不把命令策略套到别的工具上）', async () => {
    stubPermissionConfig(COMMAND_RULES);
    const manager = isolatedManager();

    const result = await manager.simulatePermission({
      toolName: 'nonexistent_tool',
      input: { command: 'node a.js' },
    });

    expect(result.customRuleVerdict).toBeNull();
  });
});
