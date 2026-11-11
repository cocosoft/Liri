// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-11（P5 第二步）：auto 模式硬拦令牌表的**收敛守卫**。
 *
 * 背景：该表已从 `permission/classifiers` 迁入 `security/patterns`，并由
 * `dangerousCommands` 统一导出。后续若按方案收敛「普通命令」，本用例保证
 * 真危险令牌与复合命令分隔符**不会被顺手删掉**。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTO_MODE_APPROVAL_TOKENS,
  AUTO_MODE_HARD_DENY_TOKENS,
} from '@openliri/infra/security/patterns/dangerousCommands';
import { AutoModeClassifier } from '@openliri/infra/permission/classifiers/AutoModeClassifier';
import {
  detectEncodedPathTraversal,
  detectPathTraversal,
} from '@openliri/infra/permission/classifiers/vector-rules';
import { PermissionMode } from '@openliri/infra/permission';
import { PermissionManager } from '@openliri/infra/permission/PermissionManager';
import { createPermissionContext } from '@openliri/infra/permission/types/PermissionContext';
import type { PermissionContext } from '@openliri/infra/permission/types/PermissionContext';

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
  // 2026-11-11：以下由硬拦降为审批（危险子形态仍在硬拦表）
  'rm ',
  'ln ',
  'find ',
  'chmod ',
  // 路径类令牌：已收敛到 SENSITIVE_PATH_PATTERNS / detectPathTraversal（单一来源）
  '/etc/',
  '/root/',
  '/tmp/',
  '/home/',
  '/var/',
  'C:\\',
  '../',
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

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
});

/** 隔离规则文件，避免用例读到本机 `tool_rules.json` */
function createIsolatedManager(): PermissionManager {
  const dir = mkdtempSync(join(tmpdir(), 'perm-approval-test-'));
  tmpDirs.push(dir);
  const ruleFile = join(dir, 'tool_rules.json');
  writeFileSync(ruleFile, '[]');
  const pm = new PermissionManager();
  pm.getRuleManager().setRuleSource(ruleFile);
  pm.resetRules();
  return pm;
}

describe('auto 模式审批档：cp / mv 转 ask（P5-approval）', () => {
  const classifier = new AutoModeClassifier();

  it('审批表覆盖各平台的等价写法（复制 / 移动 / 删除 / 链接 / 权限位 / 写盘 / git）', () => {
    expect([...AUTO_MODE_APPROVAL_TOKENS].sort()).toEqual([
      'add-content',
      'attrib ',
      'chmod ',
      'clear-content',
      'copy ',
      'copy-item',
      'cp ',
      'cpi ',
      'find ',
      'git mv',
      'git rm',
      'icacls ',
      'ln ',
      'mi ',
      'mklink ',
      'move ',
      'move-item',
      'mv ',
      'out-file',
      'ren ',
      'rm ',
      'robocopy ',
      'set-acl',
      'set-content',
      'tee ',
      'xcopy ',
    ]);
    for (const token of AUTO_MODE_APPROVAL_TOKENS) {
      expect(AUTO_MODE_HARD_DENY_TOKENS).not.toContain(token);
    }
  });

  it('分类器标记 requiresApproval（不是 shouldBlock）', async () => {
    for (const command of [
      'cp a.txt b.txt',
      'mv ws/a.txt ws/b.txt',
      'copy a.txt b.txt',
      'move a.txt b.txt',
      'cpi a.txt b.txt',
      'mi a.txt b.txt',
      'xcopy a.txt b.txt /E',
      'robocopy a.txt b.txt /E',
      'ren a.txt b.txt',
      'powershell -NoProfile -Command "Copy-Item a.txt b.txt"',
      'powershell -NoProfile -Command "Move-Item a.txt b.txt"',
      'rm notes.txt',
      'ln -s a.txt link.txt',
      'mklink link.txt a.txt',
      'find . -name "*.tmp" -delete',
      'chmod 644 run.sh',
      'icacls a.txt /grant Everyone:R',
      'attrib +h a.txt',
      'powershell -NoProfile -Command "Set-Acl a.txt b"',
      'git rm a.txt',
      'git mv a.txt b.txt',
      'Set-Content a.txt hello',
      'Add-Content a.txt hello',
      'Clear-Content a.txt',
      'Out-File a.txt',
      'tee a.txt',
    ]) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(false);
      expect(decision.requiresApproval).toBe(true);
    }
  });

  it('明确危险形态仍硬拦（不因降级而放开）', async () => {
    for (const command of [
      'rm -rf /',
      'chmod 777 secret.txt',
      'chown -R me /opt/x',
      'sed -i s/a/b/ file.txt',
    ]) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(true);
      expect(decision.requiresApproval).toBeUndefined();
    }
  });

  it('dot-source 只在命令位命中（`. ./env.sh` 拦，含「点 + 空格」的正常命令不误伤）', async () => {
    for (const command of ['. ./env.sh', 'bash -lc ". ./env.sh"']) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(true);
    }
    const normal = await classifier.classify(
      'bash',
      { command: 'echo done . ' },
      []
    );
    expect(normal.shouldBlock).toBe(false);
  });

  it('硬拦优先：同时命中硬拦表时仍是 deny，不降级为审批', async () => {
    const decision = await classifier.classify(
      'bash',
      { command: 'sudo cp a b' },
      []
    );
    expect(decision.shouldBlock).toBe(true);
    expect(decision.requiresApproval).toBeUndefined();
  });

  it('PermissionManager（auto 档）把 requiresApproval 落成 ask', async () => {
    const pm = createIsolatedManager();
    const input = { command: 'mv ws/a.txt ws/b.txt' };
    const decision = await pm.checkPermission(
      'bash',
      input,
      createPermissionContext({
        toolName: 'bash',
        input,
        permissionMode: PermissionMode.AUTO,
        sessionId: 'sess-approval',
      }) as PermissionContext
    );
    expect(decision.type).toBe('ask');
  });

  it('PermissionManager（auto 档）：PowerShell 等价写法同样转 ask', async () => {
    const pm = createIsolatedManager();
    for (const command of ['Copy-Item a.txt b.txt', 'Move-Item a.txt b.txt']) {
      const input = { command };
      const decision = await pm.checkPermission(
        'powershell',
        input,
        createPermissionContext({
          toolName: 'powershell',
          input,
          permissionMode: PermissionMode.AUTO,
          sessionId: 'sess-approval-ps',
        }) as PermissionContext
      );
      expect(decision.type).toBe('ask');
    }
  });

  it('PermissionManager（auto 档）：rm / chmod / find 走审批，危险形态仍 deny', async () => {
    const pm = createIsolatedManager();
    const cases: Array<[string, 'ask' | 'deny']> = [
      ['rm notes.txt', 'ask'],
      ['chmod +x run.sh', 'ask'],
      ['find . -name "*.tmp" -delete', 'ask'],
      ['git rm notes.txt', 'ask'],
      ['xcopy a b /E', 'ask'],
      ['icacls a /grant Everyone:R', 'ask'],
      ['Set-Content a.txt hi', 'ask'],
      ['Out-File a.txt', 'ask'],
      ['tee a.txt', 'ask'],
      ['rm -rf build', 'deny'],
      ['chmod 777 secret.txt', 'deny'],
    ];
    for (const [command, expected] of cases) {
      const input = { command };
      const decision = await pm.checkPermission(
        'bash',
        input,
        createPermissionContext({
          toolName: 'bash',
          input,
          permissionMode: PermissionMode.AUTO,
          sessionId: 'sess-approval-destructive',
        }) as PermissionContext
      );
      expect(decision.type).toBe(expected);
    }
  });

  it('审批档不再被路径令牌抢先拒绝（/tmp、/home 等普通目录）', async () => {
    const pm = createIsolatedManager();
    for (const command of [
      'mv a.txt /tmp/b.txt',
      'cp a.txt /tmp/backup.txt',
      'cp a.txt /home/me/b.txt',
    ]) {
      const input = { command };
      const decision = await pm.checkPermission(
        'bash',
        input,
        createPermissionContext({
          toolName: 'bash',
          input,
          permissionMode: PermissionMode.AUTO,
          sessionId: 'sess-approval-path',
        }) as PermissionContext
      );
      expect(decision.type).toBe('ask');
    }
  });

  it('路径敏感度仍由单一来源拦截（敏感目录 / 路径遍历）', async () => {
    for (const command of [
      'cp a.txt /etc/passwd',
      'mv a.txt /root/secret',
      'cp ../../etc/passwd out.txt',
    ]) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(true);
    }
  });
});

describe('路径遍历：执行面不再误判明文 ../（数据面仍严格）', () => {
  const classifier = new AutoModeClassifier();

  it('detectEncodedPathTraversal 只认编码形态', () => {
    expect(detectEncodedPathTraversal('%2e%2e/secret')).not.toBeNull();
    expect(detectEncodedPathTraversal('%252e%252e/secret')).not.toBeNull();
    expect(detectEncodedPathTraversal('../a')).toBeNull();
    // 数据面严格判定不变（明文也算遍历）
    expect(detectPathTraversal('../a')).not.toBeNull();
  });

  it('执行面：cp / mv 的 ../ 转审批（不再 deny）', async () => {
    for (const command of ['cp ../a.txt b.txt', 'mv ../a.txt b.txt']) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(false);
      expect(decision.requiresApproval).toBe(true);
    }
  });

  it('执行面：编码形态的遍历仍拦', async () => {
    const decision = await classifier.classify(
      'bash',
      { command: 'cat %252e%252e/secret' },
      []
    );
    expect(decision.shouldBlock).toBe(true);
  });

  it('数据面：文件写工具的 ../ 仍按遍历拦截', async () => {
    // 注：`file_read` 命中分类器的安全工具白名单（名字含 `read`）⇒ 不参与内容判定，
    // 故用 `file_write` 验证数据面口径。
    const write = await classifier.classify(
      'file_write',
      { file_path: '../secret.txt', content: 'x' },
      []
    );
    expect(write.shouldBlock).toBe(true);

    const nested = await classifier.classify(
      'file_write',
      { file_path: '../../secret.txt', content: 'x' },
      []
    );
    expect(nested.shouldBlock).toBe(true);
  });

  it('PermissionManager（auto 档）：cp ../ ⇒ ask', async () => {
    const pm = createIsolatedManager();
    const input = { command: 'cp ../a.txt b.txt' };
    const decision = await pm.checkPermission(
      'bash',
      input,
      createPermissionContext({
        toolName: 'bash',
        input,
        permissionMode: PermissionMode.AUTO,
        sessionId: 'sess-approval-updir',
      }) as PermissionContext
    );
    expect(decision.type).toBe('ask');
  });
});
