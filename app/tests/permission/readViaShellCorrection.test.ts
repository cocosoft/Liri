/**
 * B1（2026-11-18）：「单读类动词 + 单路径」的 shell 调用 ⇒ 纠正为专用工具（纯函数判定）。
 *
 * 口径（用户裁定）：仅 default 档 / 严格最小集动词 / 仅工作区内 / 默认关灰度。
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

import {
  buildReadViaShellCorrection,
  suggestReadToolForShellCommand,
} from '../../../packages/infra/src/permission/classifiers/read-via-shell-correction';
import { checkAstAndAnalyzer } from '../../src/tools/bash/bashSecurityGate';
import { buildPowerShellSecurityBlock } from '../../src/tools/PowerShellTool/PowerShellTool';

const ROOT = resolve('/repo/ws');

const base = {
  shell: 'bash' as const,
  cwd: ROOT,
  workspaceRoots: [ROOT],
};

const ENV_KEY = 'PERMISSION_READ_VIA_SHELL_CORRECTION';
const envBefore = process.env[ENV_KEY];

beforeEach(() => {
  delete process.env[ENV_KEY];
});

afterAll(() => {
  if (envBefore === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = envBefore;
});

describe('suggestReadToolForShellCommand：读文件', () => {
  it('cat / type / Get-Content + 单路径 ⇒ file_read', () => {
    for (const verb of ['cat', 'type', 'Get-Content']) {
      const s = suggestReadToolForShellCommand({
        ...base,
        command: `${verb} src/app.ts`,
      });
      expect(s?.tool).toBe('file_read');
      expect(s?.path).toBe(resolve(ROOT, 'src/app.ts'));
      expect(s?.message).toContain('file_read');
    }
  });
});

describe('suggestReadToolForShellCommand：检索', () => {
  it('grep / findstr / Select-String + pattern + 单路径 ⇒ grep', () => {
    for (const verb of ['grep', 'findstr', 'Select-String']) {
      const s = suggestReadToolForShellCommand({
        ...base,
        command: `${verb} TODO src/app.ts`,
      });
      expect(s?.tool).toBe('grep');
      expect(s?.pattern).toBe('TODO');
      expect(s?.path).toBe(resolve(ROOT, 'src/app.ts'));
      expect(s?.message).toContain('grep');
    }
  });
});

describe('suggestReadToolForShellCommand：列目录', () => {
  it('ls / dir / find / Get-ChildItem + 单路径 ⇒ glob', () => {
    for (const verb of ['ls', 'dir', 'find', 'Get-ChildItem']) {
      const s = suggestReadToolForShellCommand({
        ...base,
        command: `${verb} src`,
      });
      expect(s?.tool).toBe('glob');
      expect(s?.message).toContain('glob');
    }
  });
});

describe('suggestReadToolForShellCommand：不纠正的形态', () => {
  it('管道 / 分隔 / 重定向 / 变量 / 通配符 / 引号 ⇒ null', () => {
    const commands = [
      'cat a.ts | head',
      'cat a.ts && rm b.ts',
      'cat a.ts > out.txt',
      'cat $HOME/a.ts',
      'cat *.ts',
      'cat "a.ts"',
      "cat 'a.ts'",
      'cat a.ts; ls',
    ];
    for (const command of commands) {
      expect(suggestReadToolForShellCommand({ ...base, command })).toBeNull();
    }
  });

  it('参数前缀（-n）/ 参数个数不符 / 未收录动词 / 空命令 ⇒ null', () => {
    const commands = [
      'cat -n a.ts',
      'cat a.ts b.ts',
      'grep TODO',
      'grep TODO a.ts b.ts',
      'head a.ts',
      'tail a.ts',
      'awk x a.ts',
      'sed -n 1p a.ts',
      'cat',
      '',
    ];
    for (const command of commands) {
      expect(suggestReadToolForShellCommand({ ...base, command })).toBeNull();
    }
  });

  it('工作区外路径（相对 ../ 与绝对路径）⇒ null；无工作区根 ⇒ null', () => {
    expect(
      suggestReadToolForShellCommand({ ...base, command: 'cat ../outside.txt' })
    ).toBeNull();
    const outside = resolve(ROOT, '..', 'other', 'x.ts');
    expect(
      suggestReadToolForShellCommand({ ...base, command: `cat ${outside}` })
    ).toBeNull();
    expect(
      suggestReadToolForShellCommand({
        ...base,
        command: 'cat a.ts',
        workspaceRoots: [],
      })
    ).toBeNull();
  });

  it('相对路径按 cwd 解析（cwd 在工作区子目录时仍判定为界内）', () => {
    const sub = resolve(ROOT, 'src');
    const s = suggestReadToolForShellCommand({
      command: 'cat app.ts',
      shell: 'bash',
      cwd: sub,
      workspaceRoots: [ROOT],
    });
    expect(s?.path).toBe(resolve(sub, 'app.ts'));
  });
});

describe('suggestReadToolForShellCommand：Get-Content 只读参数（2026-11-18）', () => {
  it('白名单内的只读参数 ⇒ 仍判 file_read', () => {
    const cases: Array<[string, string]> = [
      ['Get-Content package.json -Raw', 'package.json'],
      ['Get-Content STATUS.md -TotalCount 30', 'STATUS.md'],
      ['Get-Content a.ts -First 5', 'a.ts'],
      ['Get-Content log.txt -Tail 20', 'log.txt'],
      ['Get-Content a.ts -Encoding utf8 -TotalCount 40', 'a.ts'],
    ];
    for (const [command, rel] of cases) {
      const s = suggestReadToolForShellCommand({ ...base, command });
      expect(s?.tool).toBe('file_read');
      expect(s?.path).toBe(resolve(ROOT, rel));
    }
  });

  it('白名单外的参数前缀 / 缺参数值 ⇒ null（不猜形态）', () => {
    const commands = [
      'Get-Content a.ts -Wait',
      'Get-Content -Path a.ts',
      'Get-Content a.ts -TotalCount',
      'Get-Content a.ts b.ts',
    ];
    for (const command of commands) {
      expect(suggestReadToolForShellCommand({ ...base, command })).toBeNull();
    }
  });
});

describe('suggestReadToolForShellCommand：PowerShell 包裹（2026-11-18 真机）', () => {
  it('powershell [-NoProfile] -Command "Get-Content …" ⇒ file_read', () => {
    const cases: Array<[string, string]> = [
      ['powershell -Command "Get-Content package.json -Raw"', 'package.json'],
      [
        'powershell -NoProfile -Command "Get-Content STATUS.md -TotalCount 30"',
        'STATUS.md',
      ],
      [
        'powershell -NoProfile -Command "Get-Content app\\package.json -Encoding utf8 -TotalCount 40"',
        'app/package.json',
      ],
      ['pwsh -c "Get-Content a.ts"', 'a.ts'],
    ];
    for (const [command, rel] of cases) {
      const s = suggestReadToolForShellCommand({ ...base, command });
      expect(s?.tool).toBe('file_read');
      expect(s?.path).toBe(resolve(ROOT, rel));
      expect(s?.message).toContain('file_read');
    }
  });

  it('包裹内出现分隔符 / 变量 / 多对引号 / 未知动词 / 界外路径 ⇒ null', () => {
    const commands = [
      'powershell -Command "Get-Content a.ts; Remove-Item b.ts"',
      'powershell -Command "Get-Content $env:TEMP\\a.ts"',
      'powershell -Command "Get-Content a.ts" -Command "Get-Content b.ts"',
      "powershell -Command 'Get-Content a.ts'",
      'powershell -Command "Invoke-WebRequest https://example.com"',
      'powershell -Command "Get-Content ../outside.txt"',
      'powershell -ExecutionPolicy Bypass -Command "Get-Content a.ts"',
      'powershell -Command "Get-Content a.ts" | Out-Null',
    ];
    for (const command of commands) {
      expect(suggestReadToolForShellCommand({ ...base, command })).toBeNull();
    }
  });
});

describe('buildReadViaShellCorrection：权限层口径', () => {
  const input = { command: 'cat src/app.ts' };

  it('开关关 / 非 default 档 / 非命令工具 ⇒ null', () => {
    expect(
      buildReadViaShellCorrection({
        enabled: false,
        toolName: 'bash',
        input,
        workspaceRoots: [ROOT],
      })
    ).toBeNull();
    for (const mode of ['auto', 'plan', 'dontAsk', 'bypass']) {
      expect(
        buildReadViaShellCorrection({
          enabled: true,
          toolName: 'bash',
          input,
          permissionMode: mode,
          workspaceRoots: [ROOT],
        })
      ).toBeNull();
    }
    expect(
      buildReadViaShellCorrection({
        enabled: true,
        toolName: 'file_read',
        input: { path: 'a.ts' },
        workspaceRoots: [ROOT],
      })
    ).toBeNull();
  });

  it('default 档（含缺省）+ 工作区 ⇒ 返回带 reasonCode 的纠正', () => {
    const s = buildReadViaShellCorrection({
      enabled: true,
      toolName: 'bash',
      input,
      workspaceRoots: [ROOT],
    });
    expect(s?.reasonCode).toBe('read_via_shell_corrected');
    expect(s?.tool).toBe('file_read');
    expect(s?.message).toContain('未弹出审批');
  });

  it('缺省 workspaceRoots 时回落到 workspacePath；两者都无 ⇒ null', () => {
    expect(
      buildReadViaShellCorrection({
        enabled: true,
        toolName: 'bash',
        input,
        workspacePath: ROOT,
      })?.tool
    ).toBe('file_read');
    expect(
      buildReadViaShellCorrection({ enabled: true, toolName: 'bash', input })
    ).toBeNull();
  });
});

describe('接线：bash 安全闸 / PowerShell 安全块（开关 + default 档）', () => {
  const askAnalyzer = {
    analyze: () => ({
      behavior: 'ask' as const,
      readOnly: false,
      message: '未知命令需确认',
    }),
  };
  const approval = {
    scope: { platform: process.platform, cwd: ROOT },
    snapshot: { originalCommand: '', normalizedCommand: '', rewrites: [] },
  };

  it('开关关 ⇒ 仍返回 requireApproval（零行为变更）', () => {
    const block = checkAstAndAnalyzer({
      command: 'cat a.ts',
      bypassAsk: false,
      approvalScope: approval.scope as never,
      approvalSnapshot: approval.snapshot as never,
      analyzer: askAnalyzer as never,
      cwd: ROOT,
    });
    expect((block as { requireApproval?: boolean })?.requireApproval).toBe(
      true
    );
  });

  it('开关开 + default 档 + 命中原语 ⇒ 直接纠正（无 requireApproval）', () => {
    process.env[ENV_KEY] = 'true';
    const block = checkAstAndAnalyzer({
      command: 'cat a.ts',
      bypassAsk: false,
      approvalScope: approval.scope as never,
      approvalSnapshot: approval.snapshot as never,
      analyzer: askAnalyzer as never,
      cwd: ROOT,
      permissionMode: 'default',
    });
    expect(
      (block as { requireApproval?: boolean })?.requireApproval
    ).toBeUndefined();
    expect(
      (block as { metadata?: Record<string, unknown> })?.metadata?.['reason']
    ).toBe('read_via_shell_corrected');
    expect(JSON.stringify(block)).toContain('file_read');
  });

  it('开关开但非 default 档 ⇒ 仍弹卡', () => {
    process.env[ENV_KEY] = 'true';
    const block = checkAstAndAnalyzer({
      command: 'cat a.ts',
      bypassAsk: false,
      approvalScope: approval.scope as never,
      approvalSnapshot: approval.snapshot as never,
      analyzer: askAnalyzer as never,
      cwd: ROOT,
      permissionMode: 'auto',
    });
    expect((block as { requireApproval?: boolean })?.requireApproval).toBe(
      true
    );
  });

  it('PowerShell 安全块：命中 ⇒ 纠正；未命中原语 ⇒ 仍 requireApproval', () => {
    process.env[ENV_KEY] = 'true';
    const decision = {
      allowed: false,
      behavior: 'ask' as const,
      message: '需确认',
    };
    const ok = buildPowerShellSecurityBlock(decision as never, {
      preApproved: false,
      approval: approval as never,
      startTime: Date.now(),
      command: 'Get-Content a.ps1',
      cwd: ROOT,
      permissionMode: 'default',
    });
    expect(
      (ok as { requireApproval?: boolean })?.requireApproval
    ).toBeUndefined();
    expect(JSON.stringify(ok)).toContain('file_read');

    const fallback = buildPowerShellSecurityBlock(decision as never, {
      preApproved: false,
      approval: approval as never,
      startTime: Date.now(),
      command: 'Get-Process',
      cwd: ROOT,
      permissionMode: 'default',
    });
    expect((fallback as { requireApproval?: boolean })?.requireApproval).toBe(
      true
    );
  });
});
