// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-11（P5 第二步）：auto 模式硬拦令牌表的**收敛守卫**。
 *
 * 背景：该表已从 `permission/classifiers` 迁入 `security/patterns`，并由
 * `dangerousCommands` 统一导出。后续若按方案收敛「普通命令」，本用例保证
 * 真危险令牌与复合命令分隔符**不会被顺手删掉**。
 */
import { describe, expect, it } from 'bun:test';
import { AUTO_MODE_HARD_DENY_TOKENS } from '@openliri/infra/security/patterns/dangerousCommands';
import { AutoModeClassifier } from '@openliri/infra/permission/classifiers/AutoModeClassifier';

/** 破坏性 / 提权令牌：删除它们等于削弱 auto 档兜底 */
const MUST_DENY = [
  'rm -rf',
  'mkfs',
  'format',
  'chmod 777',
  'dd if=',
  'shutdown',
  'remove-item',
  'sudo',
];

/** 普通只读 / 导航命令：留在硬拦表里就是 auto 档误杀（P5 第二步移除） */
const MUST_NOT_DENY = [
  'ls ',
  'dir ',
  'pwd ',
  'cd ',
  'cat ',
  'head ',
  'tail ',
  'less ',
  'more ',
  'grep ',
  'egrep ',
  'fgrep ',
  'diff ',
  'cmp ',
  'cut ',
  'paste ',
  'uniq ',
  'tr ',
  'wc ',
  'echo -n',
  'echo -e',
  'printf ',
  'ps ',
  'top ',
  'htop ',
  'df ',
  'du ',
  'free ',
  'uname ',
  'whoami ',
  'id ',
  'groups ',
  'mkdir ',
  'touch ',
  'cp ',
  'mv ',
  'git ',
];

describe('AUTO_MODE_HARD_DENY_TOKENS：真危险令牌必须保留', () => {
  it('破坏性 / 提权令牌全部在表内', () => {
    for (const token of MUST_DENY) {
      expect(AUTO_MODE_HARD_DENY_TOKENS).toContain(token);
    }
  });

  it('管道 / 逻辑与仍按硬拦处理（复合命令不得放行）', () => {
    expect(AUTO_MODE_HARD_DENY_TOKENS).toContain(' | ');
    expect(AUTO_MODE_HARD_DENY_TOKENS).toContain(' && ');
  });
});

describe('AUTO_MODE_HARD_DENY_TOKENS：普通命令不得回流（P5 第二步）', () => {
  it('只读 / 导航 / 系统信息命令不在硬拦表内', () => {
    for (const token of MUST_NOT_DENY) {
      expect(AUTO_MODE_HARD_DENY_TOKENS).not.toContain(token);
    }
  });

  it('git 由整词令牌收敛为写操作子命令（不整体硬拦，也不放开 push/reset）', () => {
    expect(AUTO_MODE_HARD_DENY_TOKENS).toContain('git push');
    expect(AUTO_MODE_HARD_DENY_TOKENS).toContain('git reset --hard');
    expect(AUTO_MODE_HARD_DENY_TOKENS).toContain('git restore ');
  });
});

describe('AutoModeClassifier：收敛前后的允许 / 拦截对照', () => {
  const classifier = new AutoModeClassifier();

  it('普通命令放行（此前被 ls / cat / ps 等令牌误杀）', async () => {
    for (const command of [
      'ls -la',
      'cat README.md',
      'ps aux',
      'echo -n hello',
      'git status',
      'mkdir -p ws/out',
    ]) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(false);
    }
  });

  it('危险命令与 git 写操作仍拦（安全面不削弱）', async () => {
    for (const command of [
      'rm -rf /tmp/x',
      'sudo ls',
      'chmod 777 secret.txt',
      'mkfs.ext4 /dev/sda',
      'git push origin main',
      'git reset --hard HEAD~1',
      'powershell -Command "Remove-Item C:/x -Recurse"',
    ]) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(true);
    }
  });
});
