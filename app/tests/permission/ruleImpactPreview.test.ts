// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * R5（2026-11-17）：保存前「规则影响预演」（治理方案 §11.6-④）。
 *
 * 锁四件事：
 * 1. 只在**变差**时判定（ask/allow → deny）；deny → allow 不算；
 * 2. 基准清单只覆盖命令类工具（bash / powershell / pwsh），其余工具返回 `null`；
 * 3. 预演**不写任何状态**：规则文件、命中统计、生产实例都不变；
 * 4. 写接口在变差且未显式确认时返回 409（`code: 'impact'`），且不落盘。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type http from 'http';
import { Readable } from 'node:stream';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PermissionManager } from '@openliri/infra/permission/PermissionManager';
import {
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';
import {
  baselineCommandsForTool,
  summarizeRuleImpact,
  resetRuleHitStatsForTest,
} from '@openliri/infra/permission';

import { handleAddPermissionRule } from '../../src/infrastructure/http/handlers/permission-handlers';

let dir: string;
const savedStatsPath = process.env.PERMISSION_RULE_HIT_STATS;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rule-impact-'));
  process.env.PERMISSION_RULE_HIT_STATS = join(dir, 'rule_hits.json');
  resetRuleHitStatsForTest();
});

afterEach(() => {
  resetRuleHitStatsForTest();
  if (savedStatsPath === undefined)
    delete process.env.PERMISSION_RULE_HIT_STATS;
  else process.env.PERMISSION_RULE_HIT_STATS = savedStatsPath;
  rmSync(dir, { recursive: true, force: true });
});

describe('R5：影响预演的纯函数口径', () => {
  it('只把 ask/allow → deny 视为变差', () => {
    const preview = summarizeRuleImpact('default', [
      { toolName: 'bash', command: 'a', before: 'ask', after: 'deny' },
      { toolName: 'bash', command: 'b', before: 'allow', after: 'deny' },
      { toolName: 'bash', command: 'c', before: 'deny', after: 'allow' },
      { toolName: 'bash', command: 'd', before: 'allow', after: 'ask' },
      { toolName: 'bash', command: 'e', before: 'allow', after: 'allow' },
    ]);
    expect(preview.degraded).toBe(true);
    expect(preview.degradedCommands).toEqual(['a', 'b']);
    expect(preview.cases.map((c) => c.degraded)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it('基准清单：命令类工具 3~5 条；非命令工具为空', () => {
    expect(baselineCommandsForTool('bash').length).toBeGreaterThanOrEqual(3);
    expect(baselineCommandsForTool('powershell').length).toBeGreaterThanOrEqual(
      3
    );
    expect(baselineCommandsForTool('pwsh')).toEqual(
      baselineCommandsForTool('powershell')
    );
    expect(baselineCommandsForTool('file_write')).toEqual([]);
  });
});

describe('R5：PermissionManager#previewRuleImpact（内存沙箱、不写状态）', () => {
  function buildManager(): { manager: PermissionManager; ruleFile: string } {
    const ruleFile = join(dir, 'tool_rules.json');
    const manager = new PermissionManager();
    manager.getRuleManager().setRuleSource(ruleFile);
    manager.getRuleManager().loadRules();
    manager.setToolPermissionContext({
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    });
    manager.setMode('default');
    return { manager, ruleFile };
  }

  it('工具级 deny ⇒ 基准全部变 deny（degraded=true）', async () => {
    const { manager } = buildManager();
    const preview = await manager.previewRuleImpact({
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
    });
    expect(preview).not.toBeNull();
    if (!preview) return;
    expect(preview.degraded).toBe(true);
    expect(preview.degradedCommands.length).toBe(
      baselineCommandsForTool('bash').length
    );
  });

  it('内容级 allow / ask 不造成变差；非命令工具 ⇒ null', async () => {
    const { manager } = buildManager();
    for (const behavior of [PermissionBehavior.ALLOW, PermissionBehavior.ASK]) {
      const preview = await manager.previewRuleImpact({
        behavior,
        toolName: 'bash',
        contentPattern: '^git status',
      });
      expect(preview?.degraded).toBe(false);
    }
    expect(
      await manager.previewRuleImpact({
        behavior: PermissionBehavior.DENY,
        toolName: 'file_write',
      })
    ).toBeNull();
  });

  it('预演不写规则文件、不写命中统计', async () => {
    const { manager, ruleFile } = buildManager();
    manager.getRuleManager().addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'file_read',
        source: PermissionRuleSource.RULE_STORE,
      })
    );
    const before = readFileSync(ruleFile, 'utf8');
    const beforeCount = manager.getRuleManager().getRules().length;

    await manager.previewRuleImpact({
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
    });

    expect(readFileSync(ruleFile, 'utf8')).toBe(before);
    expect(manager.getRuleManager().getRules()).toHaveLength(beforeCount);
    expect(existsSync(join(dir, 'rule_hits.json'))).toBe(false);
  });
});

describe('R5：写接口的影响确认闸（未确认 ⇒ 409，不落盘）', () => {
  function makeReq(body: unknown): http.IncomingMessage {
    return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
      headers: {},
    }) as unknown as http.IncomingMessage;
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

  it('新增工具级 deny 未带 confirmImpact ⇒ 409 code=impact；confirmImpact 非布尔 ⇒ 400', async () => {
    const { res, captured } = captureRes();
    await handleAddPermissionRule(
      makeReq({ behavior: 'deny', toolName: 'bash' }),
      res
    );
    expect(captured.status).toBe(409);
    const parsed = JSON.parse(captured.body) as {
      error: { code: string; impact: { degradedCommands: string[] } };
    };
    expect(parsed.error.code).toBe('impact');
    expect(parsed.error.impact.degradedCommands.length).toBeGreaterThan(0);

    const bad = captureRes();
    await handleAddPermissionRule(
      makeReq({ behavior: 'deny', toolName: 'bash', confirmImpact: 'yes' }),
      bad.res
    );
    expect(bad.captured.status).toBe(400);
  });
});
