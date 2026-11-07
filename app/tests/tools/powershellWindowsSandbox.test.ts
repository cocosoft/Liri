/**
 * PowerShell 工具的 Windows 写隔离接入（方案 §10.5 遗留项）
 *
 * 覆盖：
 *  ① 门控判据与 bash 同口径（仅 win32 + `enabled` + `bashEnabled`）；
 *  ② 调用构建（`-EncodedCommand` 可还原、`commandLine` 与原 `exec` 形态一致）；
 *  ③ 沙箱路径的成功 / helper 缺失 / 授权失败 / helper 自身失败（126）四类结果。
 *
 * 全部用注入的 `run` / `runIcacls`，**不碰真实 ACL**、不真起 helper。
 */
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTempDir } from '@openliri/infra/environment';
import {
  buildPowerShellInvocation,
  runPowerShellInWindowsSandbox,
  shouldSandboxPowerShell,
  type PowerShellRunInput,
} from '../../src/tools/PowerShellTool/powershellWindowsSandbox';
import {
  isWindowsAccessDenied,
  resetWindowsBashGrantsForTest,
} from '../../src/tools/bash/bashWindowsSandbox';
import type {
  IcaclsResult,
  IcaclsRunner,
} from '../../src/tools/bash/bashWindowsSandbox';
import type {
  WinSandboxRunInput,
  WinSandboxRunResult,
} from '../../src/sandbox';

const workDir = mkdtempSync(join(tmpdir(), 'pwsh-win-sandbox-'));

function okIcacls(): IcaclsRunner {
  return async (): Promise<IcaclsResult> => ({
    ok: true,
    stdout: '',
    stderr: '',
  });
}

function sandboxRunResult(
  patch: Partial<WinSandboxRunResult> = {}
): WinSandboxRunResult {
  return {
    stdout: 'ok-output',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    helperFailed: false,
    ...patch,
  };
}

function makeInput(
  env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows' }
): PowerShellRunInput {
  return {
    invocation: buildPowerShellInvocation('Get-ChildItem .', 'Bypass'),
    cwd: workDir,
    timeoutMs: 5000,
    env,
  };
}

const baseDeps = {
  journalPath: join(workDir, 'grants.json'),
  pathExists: () => true,
  resolveUserSid: async () => 'S-1-5-21-0-0-0-1001',
  runIcacls: okIcacls(),
};

beforeEach(() => {
  resetWindowsBashGrantsForTest();
});

afterAll(() => {
  resetWindowsBashGrantsForTest();
  rmSync(workDir, { recursive: true, force: true });
});

describe('shouldSandboxPowerShell（门控判据）', () => {
  test('仅 Windows + 总开关 + bashEnabled 同时开启才走沙箱', () => {
    expect(
      shouldSandboxPowerShell({
        platform: 'win32',
        enabled: true,
        bashEnabled: true,
      })
    ).toBe(true);
  });

  test('非 Windows / 总开关关闭 / bashEnabled 关闭 ⇒ 维持原 exec', () => {
    const cases: Array<Parameters<typeof shouldSandboxPowerShell>[0]> = [
      { platform: 'linux', enabled: true, bashEnabled: true },
      { platform: 'win32', enabled: false, bashEnabled: true },
      { platform: 'win32', enabled: true, bashEnabled: false },
    ];
    for (const gate of cases) {
      expect(shouldSandboxPowerShell(gate)).toBe(false);
    }
  });
});

describe('buildPowerShellInvocation', () => {
  test('EncodedCommand 可还原原脚本，命令行与原实现逐字一致', () => {
    const invocation = buildPowerShellInvocation(
      'Get-ChildItem "C:\\a b"',
      'Bypass'
    );

    expect(invocation.program).toBe('pwsh');
    const encodedIndex = invocation.args.indexOf('-EncodedCommand');
    expect(encodedIndex).toBeGreaterThan(0);
    const decoded = Buffer.from(
      invocation.args[encodedIndex + 1],
      'base64'
    ).toString('utf16le');
    expect(decoded).toBe('Get-ChildItem "C:\\a b"');
    expect(invocation.commandLine).toBe(`pwsh ${invocation.args.join(' ')}`);
    expect(
      invocation.commandLine.startsWith(
        'pwsh -NoProfile -ExecutionPolicy Bypass -EncodedCommand '
      )
    ).toBe(true);
  });

  test('depth / exclude 追加在脚本尾部（与旧实现同序）', () => {
    const invocation = buildPowerShellInvocation(
      'Get-ChildItem',
      'Bypass',
      5,
      "a'b"
    );
    const encodedIndex = invocation.args.indexOf('-EncodedCommand');
    const decoded = Buffer.from(
      invocation.args[encodedIndex + 1],
      'base64'
    ).toString('utf16le');
    expect(decoded).toBe(
      "Get-ChildItem | Select-Object -First 5 | Select-String -NotMatch -SimpleMatch 'a''b'"
    );
  });
});

describe('写隔离拒绝的真实报文形态', () => {
  test('PowerShell 的「Access to the path … is denied」也算写拒绝（与 cmd 的措辞不同）', () => {
    // 真机取证（2026-11-07）：pwsh 写 ~/.pyapp/data 被 MIC 拒绝时，
    // stderr 是 CLIXML，正文为 `New-Item: Access to the path '…' is denied.`
    expect(
      isWindowsAccessDenied(
        "New-Item: Access to the path 'C:\\Users\\x\\.pyapp\\data\\a.txt' is denied."
      )
    ).toBe(true);
    expect(isWindowsAccessDenied('Access is denied.')).toBe(true);
    expect(isWindowsAccessDenied('New-Item : 已创建文件')).toBe(false);
  });
});

describe('runPowerShellInWindowsSandbox', () => {
  test('helper 可用 ⇒ 以 pwsh 起 sandbox-run，TEMP 指向受管临时目录', async () => {
    const runs: WinSandboxRunInput[] = [];
    const attempt = await runPowerShellInWindowsSandbox(
      makeInput({
        PATH: 'C:\\Windows',
        TEMP: 'C:\\Users\\x\\AppData\\Local\\Temp',
      }),
      { failClosed: false, extraWritablePaths: [] },
      {
        ...baseDeps,
        detect: () => ({ available: true }),
        run: async (input) => {
          runs.push(input);
          return sandboxRunResult();
        },
      }
    );

    expect(attempt.kind).toBe('sandboxed');
    expect(runs).toHaveLength(1);
    expect(runs[0].program).toBe('pwsh');
    expect(runs[0].args).toContain('-EncodedCommand');
    // 系统 %TEMP% 不打标签 ⇒ 子进程 TEMP 改指受管目录（否则 Low IL 写临时文件会被拒）
    expect(runs[0].env?.TEMP).toBe(resolveTempDir());
    expect(runs[0].env?.TMP).toBe(resolveTempDir());
    expect(runs[0].env?.TMPDIR).toBe(resolveTempDir());
  });

  test('helper 缺失 + failClosed=false ⇒ 降级 plain', async () => {
    const attempt = await runPowerShellInWindowsSandbox(
      makeInput(),
      { failClosed: false, extraWritablePaths: [] },
      { ...baseDeps, detect: () => ({ available: false, reason: 'no helper' }) }
    );
    expect(attempt.kind).toBe('plain');
  });

  test('helper 缺失 + failClosed=true ⇒ 拒绝且可归因 init', async () => {
    const attempt = await runPowerShellInWindowsSandbox(
      makeInput(),
      { failClosed: true, extraWritablePaths: [] },
      { ...baseDeps, detect: () => ({ available: false, reason: 'no helper' }) }
    );
    expect(attempt.kind).toBe('refused');
    if (attempt.kind === 'refused') {
      expect(attempt.message).toContain('［sandbox_denied: init］');
      expect(attempt.message).toContain('no helper');
    }
  });

  test('完整性标签授权失败 + failClosed=true ⇒ 拒绝（不执行）', async () => {
    const attempt = await runPowerShellInWindowsSandbox(
      makeInput(),
      { failClosed: true, extraWritablePaths: [] },
      {
        ...baseDeps,
        detect: () => ({ available: true }),
        runIcacls: async () => ({
          ok: false,
          stdout: '',
          stderr: 'Access is denied',
        }),
        run: async () => sandboxRunResult(),
      }
    );
    expect(attempt.kind).toBe('refused');
    if (attempt.kind === 'refused') {
      expect(attempt.message).toContain('Access is denied');
      expect(attempt.message).toContain('［sandbox_denied: init］');
    }
  });

  test('helper 自身失败（exit 126）+ failClosed=true ⇒ 拒绝（不把 126 当命令失败）', async () => {
    const attempt = await runPowerShellInWindowsSandbox(
      makeInput(),
      { failClosed: true, extraWritablePaths: [] },
      {
        ...baseDeps,
        detect: () => ({ available: true }),
        run: async () =>
          sandboxRunResult({
            exitCode: 126,
            helperFailed: true,
            stderr: 'CreateProcessAsUser failed',
          }),
      }
    );
    expect(attempt.kind).toBe('refused');
    if (attempt.kind === 'refused') {
      expect(attempt.message).toContain('CreateProcessAsUser failed');
    }
  });
});
