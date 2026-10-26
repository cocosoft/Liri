#!/usr/bin/env bun
/**
 * Windows 兜底沙箱**自证脚本**（2026-10-26，方案 `.trae/specs/windows-sandbox.md` §5）
 *
 * 用生产同一套模块（探测器 / helper 路径 / `runWithWinSandbox`）验证 low-IL 写隔离，
 * 这样 CI windows job 与本机都能"一条命令给结论"。
 *
 * 用法：`cd app && bun run verify:win-sandbox`
 * 退出码：0 = 全通过；1 = 有断言失败；2 = 环境不支持（非 Windows / 缺 helper）。
 */
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  detectWindowsSandboxCapability,
  runWithWinSandbox,
} from '../src/sandbox/win';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 20_000;
const MAX_BUFFER_CHARS = 64_000;

interface ProbeResult {
  name: string;
  pass: boolean;
  detail: string;
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.error(
      `[verify-win-sandbox] 仅 Windows 可运行（当前 platform=${process.platform}）。`
    );
    process.exit(2);
  }
  const capability = detectWindowsSandboxCapability();
  if (!capability.available) {
    console.error(
      `[verify-win-sandbox] 不可用：${capability.reason ?? '未知'}（先跑 bun run build:win-sandbox）`
    );
    process.exit(2);
  }

  const lowDir = mkdtempSync(join(tmpdir(), 'vws-low-'));
  const mediumDir = mkdtempSync(join(tmpdir(), 'vws-med-'));

  /** 对自有目录打 Low 标签（与 WindowsSandboxRunner 同一命令） */
  const setLow = async (dir: string, level: 'Low' | 'Medium'): Promise<void> => {
    await execFileAsync('icacls.exe', [
      dir,
      '/setintegritylevel',
      `(OI)(CI)${level}`,
    ]);
  };
  await setLow(lowDir, 'Low');

  const run = (command: string) =>
    runWithWinSandbox({
      program: 'powershell.exe',
      args: ['-NoProfile', '-Command', command],
      timeoutMs: TIMEOUT_MS,
      maxBufferChars: MAX_BUFFER_CHARS,
    });

  const results: ProbeResult[] = [];

  // ① Low 标签目录内可写（证明命令真的在跑）
  const allowedFile = join(lowDir, 'allowed.txt');
  const w1 = await run(`Set-Content -Path '${allowedFile}' -Value ok`);
  results.push({
    name: 'Low 标签目录内可写',
    pass: w1.exitCode === 0 && existsSync(allowedFile),
    detail: `exit=${w1.exitCode} 文件存在=${existsSync(allowedFile)} stderr=${w1.stderr.slice(0, 120)}`,
  });

  // ② Medium 目录写入被拒（且文件未落盘）
  const deniedFile = join(mediumDir, 'denied.txt');
  const w2 = await run(`Set-Content -Path '${deniedFile}' -Value no`);
  results.push({
    name: 'Medium 目录写入被拒',
    pass: (w2.exitCode ?? 0) !== 0 && !existsSync(deniedFile),
    detail: `exit=${w2.exitCode} 文件存在=${existsSync(deniedFile)}`,
  });

  // ③ 用户命令 exit 125 原样透传（不得被当成 helper 失败）
  const e125 = await run('exit 125');
  results.push({
    name: '用户命令 exit 125 原样透传',
    pass: e125.exitCode === 125 && e125.helperFailed === false,
    detail: `exit=${e125.exitCode} helperFailed=${e125.helperFailed}`,
  });

  // ④ 读取不受限（MIC 默认允许 read-up，shell 能启动）
  const r4 = await run('Get-Content -Path "$env:WINDIR\\win.ini" | Out-Null');
  results.push({
    name: '系统文件可读（shell 能启动）',
    pass: r4.exitCode === 0,
    detail: `exit=${r4.exitCode} stderr=${r4.stderr.slice(0, 120)}`,
  });

  // 恢复标签并清理（目录是一次性的，失败仅提示）
  try {
    execFileSync('icacls.exe', [lowDir, '/setintegritylevel', '(OI)(CI)Medium']);
  } catch {
    // @ignore-catch 一次性临时目录，恢复失败不影响结论
  }
  rmSync(lowDir, { recursive: true, force: true });
  rmSync(mediumDir, { recursive: true, force: true });

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? '✅' : '❌'} ${r.name} — ${r.detail}`);
  }
  if (failed.length === 0) {
    console.log(`\n✅ Windows 兜底沙箱自证通过（${results.length}/${results.length}）`);
    process.exit(0);
  }
  console.error(`\n❌ 失败 ${failed.length}/${results.length} 项`);
  process.exit(1);
}

void main();
