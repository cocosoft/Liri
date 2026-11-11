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
import {
  COMMAND_ALIASES,
  expandTokenAliases,
} from '@openliri/infra/security/patterns/commandAliases';
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
      'git fetch origin',
      'git add .',
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
      ' -force',
      '-itemtype symboliclink',
      '-outfile',
      'add-content',
      'attrib ',
      'bun add ',
      'bun install',
      'chmod ',
      'clear-content',
      'clear-itemproperty',
      'compress-archive',
      'copy ',
      'copy-item',
      'cp ',
      'cpi ',
      'docker cp',
      'docker exec',
      'docker push',
      'docker rm',
      'docker rmi',
      'docker run',
      'docker system prune',
      'expand-archive',
      'export-csv',
      'find ',
      'gh pr merge',
      'gh release delete',
      'gh repo delete',
      'git am ',
      'git apply ',
      'git checkout',
      'git cherry-pick',
      'git commit',
      'git config ',
      'git merge ',
      'git mv',
      'git reset ',
      'git revert ',
      'git rm',
      'git stash apply',
      'git stash pop',
      'git switch',
      'git tag ',
      'git worktree add',
      'icacls ',
      'kubectl apply',
      'kubectl cordon',
      'kubectl create',
      'kubectl delete',
      'kubectl drain',
      'kubectl edit',
      'kubectl exec',
      'kubectl patch',
      'kubectl replace',
      'kubectl rollout',
      'kubectl scale',
      'ln ',
      'mi ',
      'mklink ',
      'move ',
      'move-item',
      'mv ',
      'new-itemproperty',
      'new-psdrive',
      'npm add ',
      'npm ci',
      'out-file',
      'pnpm add ',
      'remove-itemproperty',
      'ren ',
      'rm ',
      'robocopy ',
      'set-acl',
      'set-content',
      'set-itemproperty',
      'spps',
      'stop-process',
      'tee ',
      'tee-object',
      'xcopy ',
      'yarn add ',
    ]);
    for (const token of AUTO_MODE_APPROVAL_TOKENS) {
      expect(AUTO_MODE_HARD_DENY_TOKENS).not.toContain(token);
    }
  });

  it('别名归一表：别名可由规范名令牌展开，且端到端生效', async () => {
    for (const [alias, canonical] of COMMAND_ALIASES) {
      expect(expandTokenAliases(canonical)).toContain(alias);
    }
    // 写盘别名 ⇒ 由 add-content / set-content / clear-content 令牌判为审批
    for (const command of ['ac a.txt hi', 'sc a.txt hi', 'clc a.txt']) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.requiresApproval).toBe(true);
    }
    // `ri` ⇒ remove-item 令牌 ⇒ 硬拦
    const ri = await classifier.classify('bash', { command: 'ri a.txt' }, []);
    expect(ri.shouldBlock).toBe(true);
    // `ni` 只归一成 new-item（无该令牌）⇒ 建目录仍放行
    const niDir = await classifier.classify(
      'bash',
      { command: 'ni -ItemType Directory -Path ws' },
      []
    );
    expect(niDir.shouldBlock).toBe(false);
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
      'New-Item -ItemType SymbolicLink -Path link -Target target',
      'Set-ItemProperty -Path x -Name y -Value z',
      'ac a.txt hi',
      'sc a.txt hi',
      'clc a.txt',
      // git 写操作（会改工作区 / 历史）
      'git checkout main',
      'git switch main',
      'git reset HEAD~1',
      'git merge feature',
      'git cherry-pick abc123',
      'git revert HEAD',
      'git commit -m "x"',
      'git stash pop',
      'git stash apply',
      'git apply patch.diff',
      'git am 0001.patch',
      'git tag v1.0.0',
      'git worktree add ../wt main',
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
      'git config core.hooksPath .hooks',
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

  it('Windows 持久化 / 服务 / 提权等价命令硬拦，只读子命令仍放行', async () => {
    for (const command of [
      'schtasks /create /tn x /tr calc /sc once /st 00:00',
      'reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v x /d calc',
      'sc create evil binPath= calc',
      'wmic process call create calc',
      'takeown /f secret.txt',
    ]) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(true);
    }
    for (const command of [
      'schtasks /query /tn x',
      'reg query HKCU\\Software',
      'New-Item -ItemType Directory -Path ws',
    ]) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(false);
    }
    // `sc` 与 PowerShell 写盘别名同名 ⇒ 只读 `sc query` 也转审批（`sc create` 仍硬拦）。
    const scQuery = await classifier.classify(
      'bash',
      { command: 'sc query evil' },
      []
    );
    expect(scQuery.shouldBlock).toBe(false);
    expect(scQuery.requiresApproval).toBe(true);
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

  /**
   * 2026-11-11（P0，复查缺口）：Windows 账户 / 提权 / 系统加固 / 持久化 cmdlet
   * 此前**全部放行**（探针实测 `ALLOW`）⇒ 与 Linux 侧 `useradd` / `chown` /
   * `crontab` / `systemctl` 的硬拦口径对齐。
   */
  it('P0：账户 / 提权 / 系统加固 / 持久化等价写法硬拦', async () => {
    for (const command of [
      'net user hacker P@ss /add',
      'net localgroup administrators hacker /add',
      'Add-LocalGroupMember -Group Administrators -Member hacker',
      'Set-LocalUser -Name x -Password y',
      'Set-ExecutionPolicy Bypass -Scope Process',
      'Set-MpPreference -DisableRealtimeMonitoring $true',
      'Disable-WindowsOptionalFeature -Online -FeatureName x',
      'bcdedit /set testsigning on',
      'netsh advfirewall set allprofiles state off',
      'Format-Volume -DriveLetter D',
      'Initialize-Disk -Number 1',
      'Register-ScheduledTask -TaskName x -Action y',
      'New-Service -Name x -BinaryPathName y',
      'certutil -decode a.txt a.exe',
      'wsl rm -rf /',
      'Enter-PSSession -ComputerName h',
      'Invoke-Expression $cmd',
      'iex $cmd',
      'Start-Process cmd.exe',
      'saps cmd.exe',
      'scp a user@host:/tmp',
      'mknod a b c',
      'setcap cap_setuid+ep ./a',
      'docker run --privileged alpine',
      'docker run -v /:/h alpine',
    ]) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(true);
    }
  });

  it('P0：一次性远端执行器 / 全局安装硬拦', async () => {
    for (const command of [
      'npx some-cli',
      'bunx some-cli',
      'npm i -g x',
      'bun add -g x',
      'yarn global add x',
      'winget install x',
      'Install-Module -Name x',
    ]) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(true);
    }
  });

  /**
   * 2026-11-11（P1）：等价组内各写法必须**同档**（此前 `ren` 已 ask 而
   * `Rename-Item` 放行、`sc create` 已拦而 `New-Service` 放行）。
   */
  it('P1：等价组内各写法判定一致', async () => {
    const cases: Array<[readonly string[], 'deny' | 'ask']> = [
      [
        ['del a.txt', 'erase a.txt', 'rd a.txt', 'rmdir a.txt', 'ri a.txt'],
        'deny',
      ],
      [
        [
          'ren a.txt b.txt',
          'rni a.txt b.txt',
          'Rename-Item a.txt b.txt',
          'mv a.txt b.txt',
          'Move-Item a.txt b.txt',
        ],
        'ask',
      ],
      [
        [
          'Set-Item HKCU:\\x y',
          'si HKCU:\\x y',
          'Set-ItemProperty -Path x -Name y -Value z',
          'New-ItemProperty -Path HKCU:\\x -Name y -Value z',
          'Remove-ItemProperty -Path HKCU:\\x -Name y',
        ],
        'ask',
      ],
      [['tee a.txt', 'Tee-Object a.txt'], 'ask'],
      [['Expand-Archive a.zip .', 'Compress-Archive a b.zip'], 'ask'],
    ];
    for (const [commands, expected] of cases) {
      for (const command of commands) {
        const decision = await classifier.classify('bash', { command }, []);
        if (expected === 'deny') {
          expect(decision.shouldBlock).toBe(true);
          expect(decision.requiresApproval).toBeUndefined();
        } else {
          expect(decision.shouldBlock).toBe(false);
          expect(decision.requiresApproval).toBe(true);
        }
      }
    }
  });

  it('P2：容器 / 集群 / 代码托管只收写子命令，只读查询仍放行', async () => {
    for (const command of [
      'docker run alpine',
      'kubectl delete pod x',
      'kubectl apply -f x.yaml',
      'gh pr merge 1',
      'gh release delete v1',
    ]) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(false);
      expect(decision.requiresApproval).toBe(true);
    }
    for (const command of ['docker ps', 'kubectl get pods', 'kubectl logs x']) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(false);
      expect(decision.requiresApproval).toBeUndefined();
    }
  });

  /**
   * 2026-11-11（P3）：`delete` / `update` 与 shell 子命令同形，曾把
   * `kubectl delete pod` / `gh release delete` 记成「SQL 注入」（归因错误）。
   */
  it('P3：`delete` / `update` 在子命令位不再记成 SQL 注入', async () => {
    for (const command of [
      'kubectl delete pod x',
      'gh release delete v1',
      'git commit -m "update readme"',
    ]) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.reason ?? '').not.toContain('SQL injection');
    }
    // 命令位的真 SQL 形态仍拦
    const sql = await classifier.classify(
      'bash',
      { command: 'delete from users where 1=1' },
      []
    );
    expect(sql.shouldBlock).toBe(true);
  });

  it('P3：外壳命令 + 内层 shell 参数不再整条放行', async () => {
    // 曾因"串里含 `sh -c`"被当成内层只读整条放行
    const outer = await classifier.classify(
      'bash',
      { command: 'git config --global core.sshCommand "sh -c id"' },
      []
    );
    expect(outer.shouldBlock).toBe(false);
    expect(outer.requiresApproval).toBe(true);
    // 纯 shell 包装 + 只读内层仍放行（原优化意图不变）
    const wrapped = await classifier.classify(
      'bash',
      { command: 'powershell -NoProfile -Command "Get-Content a.txt"' },
      []
    );
    expect(wrapped.shouldBlock).toBe(false);
    expect(wrapped.requiresApproval).toBeUndefined();
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
