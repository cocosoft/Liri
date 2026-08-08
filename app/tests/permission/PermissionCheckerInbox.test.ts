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
 * 工具执行审批链路 P1-2 — 统一 Inbox 提交归属测试
 *
 * 覆盖（P1-2 验收）：
 * - ask 决策 → 统一提交 Inbox（卡片含 sessionId + commandHash），返回 submittedToInbox:true
 * - 配置开关 PERMISSION_INBOX_APPROVAL_ENABLED=0 → 不提交，返回纯 ask 决策
 * - 无规则（默认 allow）→ 不触发提交（危险命令由 BashTool 7 层兜底拦截）
 * - 无 sessionId → 不提交（submittedToInbox:false）
 * - 无人值守模式 ask → 仍提交 Inbox（行为不变）
 *
 * 打桩 inboxManager 单例 submit + unattendedMode 单例方法（不打桩整个模块，
 * 避免破坏 src/runtime/__tests__/ 下的 InboxManager/UnattendedModeManager 测试）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { createPermissionManager } from '../../src/permission/PermissionManager.js';
import {
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
} from '../../src/permission/types/PermissionRule.js';
import {
  RuleManager,
  deduplicateRules,
} from '../../src/permission/RuleManager.js';
import { inboxManager } from '../../src/runtime/InboxManager.js';
import { unattendedMode } from '../../src/runtime/UnattendedModeManager.js';
import { hashCommandForExecution } from '../../src/permission/ApprovedCommandRegistry.js';
import { configManager } from '../../src/config/index.js';
import { resolvePermissionsDir } from '../../src/core/paths.js';

/** 权限规则持久化文件（addRule 会写入磁盘，测试前后备份/恢复隔离） */
const RULE_FILE = join(resolvePermissionsDir(), 'tool_rules.json');
let rulesBackup: string | null = null;

interface SubmittedItem {
  sessionId: string;
  type: string;
  title: string;
  metadata?: Record<string, unknown>;
  options?: string[];
}

const submittedItems: SubmittedItem[] = [];
let originalSubmit: typeof inboxManager.submit;
let originalIsUnattended: typeof unattendedMode.isUnattended;
let originalShouldAutoApprove: typeof unattendedMode.shouldAutoApprove;

beforeEach(() => {
  // 备份并清空权限规则文件（隔离 addRule 持久化污染）
  if (existsSync(RULE_FILE)) {
    rulesBackup = readFileSync(RULE_FILE, 'utf8');
    rmSync(RULE_FILE);
  } else {
    rulesBackup = null;
  }
  submittedItems.length = 0;
  originalSubmit = inboxManager.submit;
  inboxManager.submit = (async (item: SubmittedItem) => {
    submittedItems.push(item);
    return { id: 'mock-approval', status: 'pending' };
  }) as typeof inboxManager.submit;
  originalIsUnattended = unattendedMode.isUnattended;
  originalShouldAutoApprove = unattendedMode.shouldAutoApprove;
  // 默认交互模式（非无人值守）
  unattendedMode.isUnattended = () => false;
  unattendedMode.shouldAutoApprove = () => false;
});

afterEach(() => {
  // 恢复权限规则文件
  if (rulesBackup === null) {
    if (existsSync(RULE_FILE)) rmSync(RULE_FILE);
  } else {
    mkdirSync(dirname(RULE_FILE), { recursive: true });
    writeFileSync(RULE_FILE, rulesBackup);
  }
  inboxManager.submit = originalSubmit;
  unattendedMode.isUnattended = originalIsUnattended;
  unattendedMode.shouldAutoApprove = originalShouldAutoApprove;
});

describe('PermissionManager 统一 Inbox 提交（P1-2）', () => {
  it('ask 决策 → 统一提交 Inbox（卡片含 commandHash）', async () => {
    const pm = createPermissionManager();
    pm.addRule(PermissionBehavior.ASK, 'bash');
    const result = await pm.checkPermissionForTool(
      'bash',
      { command: 'rm -rf /tmp/abc' },
      { sessionId: 'session-1' }
    );
    expect(result.allowed).toBe(false);
    expect(result.decision?.behavior).toBe('ask');
    expect(result.submittedToInbox).toBe(true);
    // 卡片已提交，携带 sessionId + commandHash（供批准后写放行缓存）
    expect(submittedItems.length).toBe(1);
    expect(submittedItems[0].sessionId).toBe('session-1');
    expect(submittedItems[0].type).toBe('approval');
    expect(submittedItems[0].metadata?.commandHash).toBe(
      hashCommandForExecution('rm -rf /tmp/abc')
    );
  });

  it('配置开关关闭 → 不提交，返回纯 ask 决策', async () => {
    process.env.PERMISSION_INBOX_APPROVAL_ENABLED = '0';
    try {
      const pm = createPermissionManager();
      pm.addRule(PermissionBehavior.ASK, 'bash');
      const result = await pm.checkPermissionForTool(
        'bash',
        { command: 'rm -rf /tmp/abc' },
        { sessionId: 'session-1' }
      );
      expect(result.decision?.behavior).toBe('ask');
      expect(result.submittedToInbox).toBe(false);
      expect(submittedItems.length).toBe(0);
    } finally {
      delete process.env.PERMISSION_INBOX_APPROVAL_ENABLED;
    }
  });

  it('无规则（默认 allow）→ 不触发提交（BashTool 7 层兜底）', async () => {
    const pm = createPermissionManager();
    const result = await pm.checkPermissionForTool(
      'bash',
      { command: 'rm -rf /tmp/abc' },
      { sessionId: 'session-1' }
    );
    expect(result.allowed).toBe(true);
    expect(submittedItems.length).toBe(0);
  });

  it('无 sessionId → 不提交（submittedToInbox:false）', async () => {
    const pm = createPermissionManager();
    pm.addRule(PermissionBehavior.ASK, 'bash');
    const result = await pm.checkPermissionForTool('bash', {
      command: 'rm -rf /tmp/abc',
    });
    expect(result.decision?.behavior).toBe('ask');
    expect(result.submittedToInbox).toBe(false);
    expect(submittedItems.length).toBe(0);
  });

  it('无人值守模式 ask → 仍提交 Inbox（行为不变）', async () => {
    unattendedMode.isUnattended = () => true;
    unattendedMode.shouldAutoApprove = () => false;
    const pm = createPermissionManager();
    pm.addRule(PermissionBehavior.ASK, 'bash');
    const result = await pm.checkPermissionForTool(
      'bash',
      { command: 'rm -rf /tmp/abc' },
      { sessionId: 'session-1' }
    );
    expect(result.submittedToInbox).toBe(true);
    expect(submittedItems.length).toBe(1);
  });
});

describe('P1-2 命令内容级黑白名单（设置→自定义规则 commandRules）', () => {
  const originalGetConfigValue = configManager.getConfigValue;

  /** 打桩 configManager.getConfigValue：仅拦截 permission 键返回 commandRules 配置 */
  function stubCommandRules(cfg: {
    blacklist?: string[];
    whitelist?: string[];
    mode?: 'whitelist' | 'blacklist';
  }): void {
    configManager.getConfigValue = ((key: string) => {
      if (key === 'permission') {
        return {
          customRules: {
            commandRules: {
              blacklist: (cfg.blacklist || []).map((p) => ({ pattern: p })),
              whitelist: (cfg.whitelist || []).map((p) => ({ pattern: p })),
              mode: cfg.mode || 'blacklist',
            },
          },
        };
      }
      return undefined;
    }) as typeof configManager.getConfigValue;
  }

  afterEach(() => {
    configManager.getConfigValue = originalGetConfigValue;
  });

  it('whitelist 模式命中 → 即使存在工具级 ask 规则也直接 allow（免审批）', async () => {
    stubCommandRules({ whitelist: ['dir'], mode: 'whitelist' });
    const pm = createPermissionManager();
    pm.addRule(PermissionBehavior.ASK, 'bash');
    const result = await pm.checkPermissionForTool(
      'bash',
      { command: 'dir /b x' },
      { sessionId: 'session-1' }
    );
    expect(result.allowed).toBe(true);
    expect(result.decision?.behavior).toBe('allow');
    expect(submittedItems.length).toBe(0);
  });

  it('黑名单命中 → deny，不提交 Inbox', async () => {
    stubCommandRules({ blacklist: ['format'], mode: 'blacklist' });
    const pm = createPermissionManager();
    const result = await pm.checkPermissionForTool(
      'bash',
      { command: 'format c:' },
      { sessionId: 'session-1' }
    );
    expect(result.allowed).toBe(false);
    expect(result.decision?.behavior).toBe('deny');
    expect(submittedItems.length).toBe(0);
  });

  it('whitelist 模式未命中 → deny（严格白名单）', async () => {
    stubCommandRules({ whitelist: ['dir'], mode: 'whitelist' });
    const pm = createPermissionManager();
    const result = await pm.checkPermissionForTool(
      'bash',
      { command: 'whoami' },
      { sessionId: 'session-1' }
    );
    expect(result.allowed).toBe(false);
    expect(result.decision?.behavior).toBe('deny');
  });

  it('blacklist 模式未命中 → 不阻断（交回工具级决策，默认 allow）', async () => {
    stubCommandRules({ blacklist: ['format'], mode: 'blacklist' });
    const pm = createPermissionManager();
    const result = await pm.checkPermissionForTool(
      'bash',
      { command: 'echo hi' },
      { sessionId: 'session-1' }
    );
    expect(result.allowed).toBe(true);
    expect(submittedItems.length).toBe(0);
  });
});

describe('deduplicateRules（P1-1 规则去重）', () => {
  it('同 (source+behavior+toolName+contentPattern) 合并为 1 条，保留最早创建', () => {
    const early = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      source: PermissionRuleSource.USER_SETTINGS,
    });
    early.createdAt = new Date(1000);
    const late = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      source: PermissionRuleSource.USER_SETTINGS,
    });
    late.createdAt = new Date(2000);
    const askOther = createPermissionRule({
      behavior: PermissionBehavior.ASK,
      toolName: 'bash',
      source: PermissionRuleSource.USER_SETTINGS,
    });
    askOther.createdAt = new Date(1500);

    const out = deduplicateRules([early, late, askOther]);
    expect(out).toHaveLength(2); // allow 合并 + ask 保留
    expect(out.find((r) => r.behavior === PermissionBehavior.ALLOW)?.id).toBe(
      early.id
    );
  });

  it('contentPattern 不同 → 不去重', () => {
    const a = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: 'dir.*',
    });
    const b = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: 'net.*',
    });
    expect(deduplicateRules([a, b])).toHaveLength(2);
  });
});

describe('RuleManager.addRule 幂等去重（P1-1）', () => {
  it('连续添加相同规则仅保留 1 条（updatedAt 刷新）', () => {
    const rm = new RuleManager();
    rm.loadRules();
    const rule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      source: PermissionRuleSource.USER_SETTINGS,
    });
    rm.addRule(rule);
    rm.addRule(rule);
    const matches = rm
      .getRules()
      .filter(
        (r) =>
          r.toolName === 'bash' && r.behavior === PermissionBehavior.ALLOW
      );
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(rule.id);
  });

  it('loadRules 清理历史重复项并回写', () => {
    const rm = new RuleManager();
    const rule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      source: PermissionRuleSource.USER_SETTINGS,
    });
    // 先构造 2 条完全重复的规则（手动改 id 模拟历史重复文件）
    const dup1 = { ...rule, id: 'dup-1' };
    const dup2 = { ...rule, id: 'dup-2' };
    rm.addRule(dup1);
    rm.addRule(dup2);
    expect(rm.getRules().length).toBe(1); // addRule 已幂等

    // 直接写入重复文件模拟历史数据 → loadRules 应清理
    writeFileSync(RULE_FILE, JSON.stringify([dup1, dup2], null, 2));
    const rm2 = new RuleManager();
    rm2.loadRules();
    expect(rm2.getRules()).toHaveLength(1);
    const onDisk = JSON.parse(readFileSync(RULE_FILE, 'utf8'));
    expect(onDisk).toHaveLength(1); // 已回写
  });
});

describe('P2-4 白名单按钮（approval options）', () => {
  it('命令类工具审批卡片携带 allowlist_tool + allowlist_command 按钮', async () => {
    const pm = createPermissionManager();
    pm.addRule(PermissionBehavior.ASK, 'bash');
    const result = await pm.checkPermissionForTool(
      'bash',
      { command: 'net user %username%' },
      { sessionId: 'session-1' }
    );
    expect(result.decision?.behavior).toBe('ask');
    expect(submittedItems.length).toBe(1);
    expect(submittedItems[0].options).toContain('allowlist_tool');
    expect(submittedItems[0].options).toContain('allowlist_command');
  });

  it('非命令类工具审批卡片不含白名单按钮（保持原 options）', async () => {
    const pm = createPermissionManager();
    pm.addRule(PermissionBehavior.ASK, 'write_file');
    const result = await pm.checkPermissionForTool(
      'write_file',
      { path: '/tmp/x', content: 'hi' },
      { sessionId: 'session-1' }
    );
    expect(result.decision?.behavior).toBe('ask');
    const opts = submittedItems[0]?.options ?? [];
    expect(opts).not.toContain('allowlist_tool');
    expect(opts).not.toContain('allowlist_command');
    // 基础按钮仍在
    expect(opts).toContain('approve');
    expect(opts).toContain('deny');
  });
});

describe('P2-5 规则文件外部修改自动重载（hash 校验）', () => {
  /** 绕过 30s 轮询间隔，直接触发校验 */
  function forceCheck(rm: RuleManager): void {
    (rm as unknown as { lastHashCheckTime: number }).lastHashCheckTime = 0;
    rm.checkExternalChanges();
  }

  it('tool_rules.json 被外部修改后自动重载规则', () => {
    const initial = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      source: PermissionRuleSource.USER_SETTINGS,
    });
    writeFileSync(RULE_FILE, JSON.stringify([initial], null, 2));

    const rm = new RuleManager();
    rm.loadRules();
    expect(rm.getRules()).toHaveLength(1);

    // 模拟外部修改：直接写文件，绕过 RuleManager API
    const external = createPermissionRule({
      behavior: PermissionBehavior.DENY,
      toolName: 'bash',
      source: PermissionRuleSource.USER_SETTINGS,
    });
    writeFileSync(RULE_FILE, JSON.stringify([external], null, 2));

    forceCheck(rm);

    const after = rm.getRules();
    expect(after).toHaveLength(1);
    expect(after[0].behavior).toBe(PermissionBehavior.DENY);
  });

  it('自写（saveRules）后不误判为外部修改', () => {
    const rm = new RuleManager();
    rm.loadRules();
    const rule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      source: PermissionRuleSource.USER_SETTINGS,
    });
    rm.addRule(rule);

    // 绕过间隔后校验：hash 与自写一致，不应重载
    forceCheck(rm);

    const matches = rm
      .getRules()
      .filter(
        (r) =>
          r.toolName === 'bash' && r.behavior === PermissionBehavior.ALLOW
      );
    expect(matches).toHaveLength(1);
  });

  it('外部追加规则后保留现有规则并加载新增（增量感知）', () => {
    const initial = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      source: PermissionRuleSource.USER_SETTINGS,
    });
    writeFileSync(RULE_FILE, JSON.stringify([initial], null, 2));

    const rm = new RuleManager();
    rm.loadRules();
    expect(rm.getRules()).toHaveLength(1);

    // 外部追加一条 deny 规则（保留原 allow）
    const denied = createPermissionRule({
      behavior: PermissionBehavior.DENY,
      toolName: 'write_file',
      source: PermissionRuleSource.USER_SETTINGS,
    });
    writeFileSync(RULE_FILE, JSON.stringify([initial, denied], null, 2));

    forceCheck(rm);

    const after = rm.getRules();
    expect(after).toHaveLength(2);
    expect(after.some((r) => r.behavior === PermissionBehavior.DENY)).toBe(
      true
    );
  });
});
