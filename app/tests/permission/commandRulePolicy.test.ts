/**
 * 权限归一化 P0-2（2026-10-27）：命令级黑白名单（B 体系）接线守卫。
 *
 * 背景：`permission.customRules.commandRules` 与匹配器 `matchesCommandRule` 早已存在，
 * 但**运行时零消费者** ⇒ 用户按文档配置不生效（方案 §2 B3）。
 * 本组同时钉住两件事：
 * 1. 纯判定口径（黑名单优先 / 白名单命中放行 / 未命中拒绝 / 空白名单视为未配置）；
 * 2. 安全门接线（`checkAstAndAnalyzer` 在黑名单命中时 deny、白名单命中时跳过 ask）。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { configManager } from '@modules/config';
import {
  evaluateCommandRules,
  readCommandRulesConfig,
  type CommandRulesSettings,
} from '../../src/permission/commandRulePolicy.js';
import { checkAstAndAnalyzer } from '../../src/tools/bash/bashSecurityGate.js';
import type { CommandAnalyzer } from '../../src/tools/bash/bashSecurityGate.js';
import type { ApprovalScope, ApprovalSnapshot } from '@modules/permission';

const scope: ApprovalScope = {
  platform: process.platform,
  cwd: process.cwd(),
  envDigest: '',
};
const snapshot: ApprovalSnapshot = {
  originalCommand: '',
  normalizedCommand: '',
  rewrites: [],
};

/** 固定行为的安全分析器替身（只关心 ask/allow） */
function stubAnalyzer(behavior: 'allow' | 'deny' | 'ask'): CommandAnalyzer {
  return {
    analyze: () => ({
      behavior,
      message: behavior === 'ask' ? '命令不在已知安全列表' : undefined,
    }),
  };
}

function rules(patch: Partial<CommandRulesSettings>): CommandRulesSettings {
  return {
    blacklist: patch.blacklist ?? [],
    whitelist: patch.whitelist ?? [],
    mode: patch.mode ?? 'blacklist',
  };
}

let configSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  configSpy?.mockRestore();
  configSpy = undefined;
});

describe('命令级规则判定（evaluateCommandRules）', () => {
  it('空前缀/未配置 ⇒ 无意见（不拦）', () => {
    expect(evaluateCommandRules('node a.js', undefined)).toBeNull();
    expect(evaluateCommandRules('', rules({}))).toBeNull();
  });

  it('黑名单按前缀命中 ⇒ deny（带上命中规则）', () => {
    const verdict = evaluateCommandRules(
      'node _scan.js',
      rules({ blacklist: [{ pattern: 'node', label: '禁 node' }] })
    );
    expect(verdict?.behavior).toBe('deny');
    expect(
      verdict && verdict.behavior === 'deny' ? verdict.reasonCode : ''
    ).toBe('custom_blacklist');
  });

  it('黑名单按前缀不误伤：`echo node` 不被 `node` 命中', () => {
    const verdict = evaluateCommandRules(
      'echo node',
      rules({ blacklist: [{ pattern: 'node' }] })
    );
    expect(verdict).toBeNull();
  });

  it('黑名单优先于白名单（同一条命令两头都命中 ⇒ deny）', () => {
    const verdict = evaluateCommandRules(
      'node a.js',
      rules({
        blacklist: [{ pattern: 'node' }],
        whitelist: [{ pattern: 'node' }],
        mode: 'whitelist',
      })
    );
    expect(verdict?.behavior).toBe('deny');
  });

  it('白名单模式：命中放行、未命中拒绝', () => {
    const settings = rules({
      whitelist: [{ pattern: 'git' }],
      mode: 'whitelist',
    });
    expect(evaluateCommandRules('git status', settings)?.behavior).toBe(
      'allow'
    );
    const miss = evaluateCommandRules('node a.js', settings);
    expect(miss?.behavior).toBe('deny');
    expect(miss && miss.behavior === 'deny' ? miss.reasonCode : '').toBe(
      'custom_whitelist_miss'
    );
  });

  it('白名单模式但白名单为空 ⇒ 视为未配置（防误切换锁死 shell）', () => {
    expect(
      evaluateCommandRules('node a.js', rules({ mode: 'whitelist' }))
    ).toBeNull();
  });

  it('配置读取失败 ⇒ 未配置（不改变安全姿态）', () => {
    configSpy = spyOn(configManager, 'getConfigValue').mockImplementation(
      (() => {
        throw new Error('config not ready');
      }) as typeof configManager.getConfigValue
    );
    expect(readCommandRulesConfig()).toBeUndefined();
  });
});

describe('安全门接线（checkAstAndAnalyzer + 命令级规则）', () => {
  const base = {
    command: 'node a.js',
    bypassAsk: false,
    approvalScope: scope,
    approvalSnapshot: snapshot,
  };

  it('黑名单命中 ⇒ 拦截（metadata.reason=custom_blacklist）', () => {
    const result = checkAstAndAnalyzer({
      ...base,
      analyzer: stubAnalyzer('allow'),
      commandRules: rules({ blacklist: [{ pattern: 'node' }] }),
    });
    expect(result).not.toBeNull();
    expect(result?.success).toBe(false);
    expect(result?.metadata?.['reason']).toBe('custom_blacklist');
    expect(String(result?.error)).toContain('命中命令黑名单');
  });

  it('白名单命中 ⇒ 跳过 ask（返回 null，继续后续硬拦截）', () => {
    const result = checkAstAndAnalyzer({
      ...base,
      analyzer: stubAnalyzer('ask'),
      commandRules: rules({
        whitelist: [{ pattern: 'node' }],
        mode: 'whitelist',
      }),
    });
    expect(result).toBeNull();
  });

  it('白名单模式未命中 ⇒ 拦截（custom_whitelist_miss）', () => {
    const result = checkAstAndAnalyzer({
      ...base,
      analyzer: stubAnalyzer('allow'),
      commandRules: rules({
        whitelist: [{ pattern: 'git' }],
        mode: 'whitelist',
      }),
    });
    expect(result).not.toBeNull();
    expect(result?.metadata?.['reason']).toBe('custom_whitelist_miss');
  });

  it('P0-1：分析器 ask ⇒ 必须带 requireApproval（否则上层落成 success 且不入 Inbox）', () => {
    const result = checkAstAndAnalyzer({
      ...base,
      analyzer: stubAnalyzer('ask'),
      commandRules: null,
    });
    expect(result).not.toBeNull();
    expect((result as { requireApproval?: boolean }).requireApproval).toBe(
      true
    );
    expect((result as { approvalReason?: string }).approvalReason).toContain(
      '命令不在已知安全列表'
    );
    expect(result?.metadata?.['reason']).toBe('security_analyzer_ask');
  });

  it('P0-1 负向对照：allow 且无规则 ⇒ 不产生审批标记', () => {
    const result = checkAstAndAnalyzer({
      ...base,
      analyzer: stubAnalyzer('allow'),
      commandRules: null,
    });
    expect(result).toBeNull();
  });
});
