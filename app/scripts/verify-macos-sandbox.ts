#!/usr/bin/env bun
/**
 * macOS 兜底沙箱**自证脚本**（2026-10-26，方案 `.trae/specs/macos-sandbox-exec.md` §5）
 *
 * 为什么要它：CI 没有 macOS 矩阵，真机验证只能人工做；本脚本把"人工看两条命令"变成
 * **一条命令给结论**，并且用的是生产同一套模块（探测器 / SBPL 生成器 / 执行器），
 * 因此它通过 = 接线本身可用，而不只是 profile 字符串长得对。
 *
 * 用法：`cd app && bun run verify:sandbox-macos`
 *
 * 退出码：0 = 全部通过；1 = 有断言失败；2 = 环境不支持（非 macOS / 缺 sandbox-exec）。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MACOS_SANDBOX_EXEC_PATH,
  clearMacOSSandboxCapabilityCache,
  detectMacOSSandboxCapability,
} from '@modules/sandbox/darwin/MacOSSandboxDetector';
import {
  buildMacOSSandboxProfile,
  toKernelPath,
} from '@modules/sandbox/darwin/MacOSSandboxPolicy';
import { runWithSandboxExec } from '@modules/sandbox/darwin/runWithSandboxExec';

interface ProbeResult {
  name: string;
  pass: boolean;
  detail: string;
}

const TIMEOUT_MS = 15_000;
const MAX_BUFFER_CHARS = 64_000;

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    console.error(
      `[verify-macos-sandbox] 仅 macOS 可运行（当前 platform=${process.platform}）。`
    );
    process.exit(2);
  }

  clearMacOSSandboxCapabilityCache();
  const capability = detectMacOSSandboxCapability();
  if (!capability.available) {
    console.error(
      `[verify-macos-sandbox] 不可用：${capability.reason ?? '未知'}（期望 ${MACOS_SANDBOX_EXEC_PATH}）`
    );
    process.exit(2);
  }

  // 两个独立临时目录：allow 进白名单，deny 只在"本不该可写"的用例里用
  const allowDir = mkdtempSync(join(tmpdir(), 'vms-allow-'));
  const denyDir = mkdtempSync(join(tmpdir(), 'vms-deny-'));
  // 故意**最小化**白名单（只有 allowDir + /dev），不套用生产默认路径 —— 否则"外部被拒"测不出来。
  // `/dev` 与生产同口径（shell 常规重定向 `>/dev/null`；见 `buildBashLandlockPolicy` 的 `/dev` 注释）。
  const profile = buildMacOSSandboxProfile({
    writablePaths: [allowDir, '/dev'],
    allowNetwork: false,
  });
  // 诊断行：macOS 上 `tmpdir()` 是 `/var/folders/…`（符号链接），而 SBPL 按内核解析后的
  // `/private/var/folders/…` 匹配 ⇒ 失败时这一行能直接看出"白名单归一到了哪"
  console.log(
    `[verify-macos-sandbox] tmpdir=${tmpdir()} allow=${toKernelPath(allowDir)} deny=${toKernelPath(denyDir)}`
  );
  const run = (command: string) =>
    runWithSandboxExec({
      profile,
      command,
      timeoutMs: TIMEOUT_MS,
      maxBufferChars: MAX_BUFFER_CHARS,
    });

  const results: ProbeResult[] = [];

  // ① 白名单内可写：证明"确实在跑命令"，不是一律拒绝
  const allowedFile = join(allowDir, 'allowed.txt');
  const writeAllowed = await run(
    `echo ok > "${allowedFile}" && cat "${allowedFile}"`
  );
  results.push({
    name: '白名单内可写',
    pass: writeAllowed.exitCode === 0 && writeAllowed.stdout.includes('ok'),
    detail: `exit=${writeAllowed.exitCode} stderr=${writeAllowed.stderr.slice(0, 120)}`,
  });

  // ② 白名单外被拒：断言"命令非 0"且"文件确实没落盘"（不依赖本地化文案）
  const deniedFile = join(denyDir, 'denied.txt');
  const writeDenied = await run(`echo no > "${deniedFile}"`);
  const deniedFileExists = existsSync(deniedFile);
  results.push({
    name: '白名单外写入被拒',
    pass: (writeDenied.exitCode ?? 0) !== 0 && !deniedFileExists,
    detail: `exit=${writeDenied.exitCode} 文件存在=${deniedFileExists} stderr=${writeDenied.stderr.slice(0, 120)}`,
  });

  // ③ 系统文件可读：证明 `(allow file-read*)` 放行了 dyld / shell 启动所需读取
  const readSystem = await run('cat /etc/hosts > /dev/null');
  results.push({
    name: '系统文件可读（shell 能启动）',
    pass: readSystem.exitCode === 0,
    detail: `exit=${readSystem.exitCode} stderr=${readSystem.stderr.slice(0, 120)}`,
  });

  // ④ 用户命令退出 125 不得被当成"沙箱初始化失败"（防回退 plain 逃逸）
  const exit125 = await run('exit 125');
  results.push({
    name: '用户命令 exit 125 原样透传',
    pass: exit125.exitCode === 125 && exit125.sandboxInitFailed === false,
    detail: `exit=${exit125.exitCode} sandboxInitFailed=${exit125.sandboxInitFailed}`,
  });

  // ────────────────────────────────────────────────────────────────
  // ⑤ **非阻断诊断**（2026-11-27）：限制登记见 `macos-sandbox-exec.md` §3.6 ——
  //    生产 profile 下 `bun -e` 被沙箱终止（`exec_error: 未取到退出码`），而 `node --version` 正常。
  //    本段用**生产同口径**的白名单（allowDir + tmpdir + /dev + 网络开），逐个追加候选能力，
  //    打印哪种组合能让内联运行时跑通 —— 只为拿证据，**不参与判定、不改退出码**。
  // ────────────────────────────────────────────────────────────────
  const diagBase = buildMacOSSandboxProfile({
    writablePaths: [allowDir, tmpdir(), '/dev'],
  });
  const cands: Array<{ name: string; extra: string }> = [
    { name: 'base', extra: '' },
    { name: '+mach-lookup', extra: '(allow mach-lookup)' },
    { name: '+sysctl-read', extra: '(allow sysctl-read)' },
    { name: '+ipc-posix-shm', extra: '(allow ipc-posix-shm)' },
    { name: '+all3', extra: '(allow mach-lookup)\n(allow sysctl-read)\n(allow ipc-posix-shm)' },
  ];
  for (const c of cands) {
    try {
      const r = await runWithSandboxExec({
        profile: c.extra ? `${diagBase}\n${c.extra}` : diagBase,
        command: `bun -e "console.log('diag-ok')"`,
        timeoutMs: TIMEOUT_MS,
        maxBufferChars: MAX_BUFFER_CHARS,
      });
      console.log(
        `[diag] bun -e ${c.name} => exit=${r.exitCode} initFailed=${r.sandboxInitFailed} ` +
          `stdout=${r.stdout.trim().slice(0, 40) || '—'} stderr=${r.stderr.trim().slice(0, 160) || '—'}`
      );
    } catch (err) {
      // @ignore-catch — 诊断段失败不得影响自证结论
      console.log(`[diag] bun -e ${c.name} => 抛错 ${String(err).slice(0, 160)}`);
    }
  }

  rmSync(allowDir, { recursive: true, force: true });
  rmSync(denyDir, { recursive: true, force: true });

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? '✅' : '❌'} ${r.name} — ${r.detail}`);
  }
  if (failed.length === 0) {
    console.log(
      `\n✅ macOS 兜底沙箱自证通过（${results.length}/${results.length}）`
    );
    process.exit(0);
  }
  console.error(`\n❌ 失败 ${failed.length}/${results.length} 项`);
  process.exit(1);
}

void main();
