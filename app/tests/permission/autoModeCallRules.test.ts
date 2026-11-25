// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * auto 模式下的**call 级**规则（2026-11-25）。
 *
 * 现场（真机周报「23 个未收录命令导致 1344 次审批（最多：cargo）」）：
 * 用户在设置页/审批卡加的 `contentPattern` allow 规则（如 `^cargo build.*`）在 auto 档
 * **静默失效** —— 旧实现 auto 只查工具级规则（`toolMatchesRule` 明确排除内容模式），
 * 于是 `cargo build` / `cargo test` 每条都被分类器判"未收录 ⇒ ask"，规则形同虚设。
 *
 * 本文件锁住 auto 档与 default 档的规则顺序对齐（deny 先于 ask，ask 先于 allow）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PermissionMode, PermissionManager } from '@openliri/infra/permission';
import {
  createPermissionContext,
  type PermissionContext,
} from '@openliri/infra/permission/types/PermissionContext';
import {
  PermissionBehavior,
  createPermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

/** 隔离规则文件，避免用例读到本机 `tool_rules.json` */
function createIsolatedManager(): PermissionManager {
  const dir = mkdtempSync(join(tmpdir(), 'perm-auto-call-'));
  tmpDirs.push(dir);
  const ruleFile = join(dir, 'tool_rules.json');
  writeFileSync(ruleFile, '[]');
  const pm = new PermissionManager();
  pm.getRuleManager().setRuleSource(ruleFile);
  pm.resetRules();
  return pm;
}

function autoContext(input: Record<string, unknown>): PermissionContext {
  return createPermissionContext({
    toolName: 'bash',
    input,
    permissionMode: PermissionMode.AUTO,
    sessionId: 'sess-auto-call-rules',
  }) as PermissionContext;
}

async function decide(
  pm: PermissionManager,
  command: string
): Promise<{ type: string }> {
  const input = { command };
  return pm.checkPermission('bash', input, autoContext(input));
}

function addRule(
  pm: PermissionManager,
  behavior: PermissionBehavior,
  contentPattern: string
): void {
  pm.getRuleManager().addRule(
    createPermissionRule({ behavior, toolName: 'bash', contentPattern })
  );
}

describe('auto 模式：call 级规则生效（2026-11-25）', () => {
  it('内容级 allow（cargo build，禁止串联）⇒ 不再误弹审批', async () => {
    const pm = createIsolatedManager();
    addRule(pm, PermissionBehavior.ALLOW, '^cargo build(?: [^&|;<>`$]*)?$');

    expect((await decide(pm, 'cargo build')).type).toBe('allow');
    expect((await decide(pm, 'cargo build --release -p liri')).type).toBe(
      'allow'
    );
    // 未命中的命令仍走分类器（cargo 未收录 ⇒ ask）
    expect((await decide(pm, 'cargo run')).type).toBe('ask');
    // 串联命令**不得**被这条规则整段放行（`rm -rf` 仍走危险命令判定）
    expect((await decide(pm, 'cargo build && rm -rf .')).type).not.toBe(
      'allow'
    );
  });

  it('内容级 ask 规则 ⇒ ask（早于 allow）', async () => {
    const pm = createIsolatedManager();
    addRule(pm, PermissionBehavior.ASK, '^cargo fmt');

    expect((await decide(pm, 'cargo fmt --check')).type).toBe('ask');
  });

  it('内容级 deny 规则 ⇒ deny（deny 先于一切 ask/allow）', async () => {
    const pm = createIsolatedManager();
    addRule(pm, PermissionBehavior.ALLOW, '^cargo');
    addRule(pm, PermissionBehavior.DENY, '^cargo publish');

    expect((await decide(pm, 'cargo publish -p liri')).type).toBe('deny');
    expect((await decide(pm, 'cargo build')).type).toBe('allow');
  });
});
