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
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
// SG-1（2026-11-27）：REPL / notebook 执行面也进同一套 Seatbelt —— 用**生产同一条路径**自证
import { REPLToolImpl } from '@openliri/tool-code/repl/REPLToolImpl';

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

  // ⑤ 内联运行时可在沙箱内执行（2026-11-27）：生产 profile 曾缺 `(allow sysctl-read)`，
  //    导致 `bun -e` 被内核终止（工具层只看到 `exec_error: 未取到退出码`）。
  //    CI 逐项二分结论：`mach-lookup` / `ipc-posix-shm` 无效，**只有 `sysctl-read` 生效**。
  //    这里用生产同口径白名单（allowDir + tmpdir + /dev，网络开）钉住该修复。
  const diagProfile = buildMacOSSandboxProfile({
    writablePaths: [allowDir, tmpdir(), '/dev'],
  });
  const inlineRun = await runWithSandboxExec({
    profile: diagProfile,
    command: `bun -e "console.log('inline-ok')"`,
    timeoutMs: TIMEOUT_MS,
    maxBufferChars: MAX_BUFFER_CHARS,
  });
  results.push({
    name: '内联运行时可在沙箱内执行（bun -e）',
    pass: inlineRun.exitCode === 0 && inlineRun.stdout.includes('inline-ok'),
    detail: `exit=${inlineRun.exitCode} stdout=${inlineRun.stdout.trim().slice(0, 40) || '—'} stderr=${inlineRun.stderr.trim().slice(0, 120) || '—'}`,
  });

  // ⑥ SG-1（2026-11-27）：REPL / notebook 的执行面（`NotebookToolImpl` → `REPLToolImpl`）
  //    也必须落在同一套 Seatbelt 里：可写工作区、不可写白名单外。
  //    用 `javascript`（node 一定存在）避免依赖 macOS runner 是否有 `python`。
  //
  //    ⚠️ 判定必须看**文件系统事实**，不能看 `result.success`：node 的 REPL 把抛出的异常
  //    打到 **stdout**（`util.inspect`），而 `executeCode` 只用 stderr 判成败 ⇒ 越界写实际
  //    被拒时 `success` 仍为 `true`（2026-11-27 CI 实证）。
  const replWroteFile = join(allowDir, 'repl-ok.txt');
  const replDenied = join(denyDir, 'repl-denied.txt');
  try {
    const repl = new REPLToolImpl();
    const session = await repl.startREPL('javascript', {
      cwd: allowDir,
      timeout: TIMEOUT_MS,
    });
    try {
      const mode = session.sandbox?.mode;
      const wrote = await repl.executeCode(
        session,
        'require("fs").writeFileSync("repl-ok.txt", "ok")'
      );
      const denied = await repl.executeCode(
        session,
        `require("fs").writeFileSync(${JSON.stringify(replDenied)}, "x")`
      );
      const wroteOk = existsSync(replWroteFile);
      const deniedLanded = existsSync(replDenied);
      results.push({
        name: 'REPL 执行面进沙箱（可写工作区、越界被拒）',
        pass: mode === 'sandbox-exec' && wroteOk && !deniedLanded,
        detail:
          `mode=${mode} 工作区落盘=${wroteOk} 越界落盘=${deniedLanded}` +
          ` 越界输出=${(denied.output || denied.error || '—').trim().slice(0, 80)}` +
          ` 工作区写=${wrote.success}`,
      });
    } finally {
      await repl.stopREPL(session);
    }
  } catch (error) {
    results.push({
      name: 'REPL 执行面进沙箱（可写工作区、越界被拒）',
      pass: false,
      detail: `启动/执行异常：${String(error).slice(0, 200)}`,
    });
  }

  // ⑦ A-1（2026-11-27）：**读白名单候选诊断**（只打印，不参与退出码）。
  //
  // 目的：在 macOS 真机上验证"候选读白名单"是否足以让 shell / 解释器 / 工具链启动，
  // 为后续把生产 profile 从 `(allow file-read*)` 收紧到 `(file-read* (subpath …))` 提供数据。
  // 判据只打印：✅ = 该负载在"仅候选目录可读"下正常退出；❌ = 还需补目录（stderr 首行指向缺的路径）。
  try {
    const readCandidates = [
      '/usr',
      '/bin',
      '/sbin',
      '/etc',
      '/private/etc',
      '/System',
      '/Library',
      '/private/var/db',
      '/dev',
      '/private/tmp',
      tmpdir(),
      dirname(process.execPath),
      '/usr/local',
      '/opt/homebrew',
      join(homedir(), '.pyapp'),
      join(homedir(), '.config'),
      join(homedir(), '.cache'),
      allowDir,
    ];
    const readProfile = buildMacOSSandboxProfile({
      writablePaths: [allowDir, tmpdir(), '/dev'],
      readablePaths: readCandidates,
    });
    console.log(
      `[verify-macos-sandbox] 读白名单候选（${readCandidates.length} 条）: ${readCandidates.join(' ')}`
    );
    const probes: Array<{ name: string; command: string }> = [
      { name: 'shell 启动 + 系统读', command: 'cat /etc/hosts > /dev/null' },
      { name: 'bun -e', command: 'bun -e "1"' },
      { name: 'node -e', command: 'node -e "1"' },
      { name: 'git --version', command: 'git --version' },
      { name: 'python3 -c', command: 'python3 -c "1"' },
    ];
    for (const probe of probes) {
      const r = await runWithSandboxExec({
        profile: readProfile,
        command: probe.command,
        timeoutMs: TIMEOUT_MS,
        maxBufferChars: MAX_BUFFER_CHARS,
      });
      const detail =
        r.exitCode === 0
          ? 'ok'
          : `exit=${r.exitCode} stderr=${r.stderr.trim().slice(0, 200) || '—'}`;
      console.log(
        `[A-1 读白名单诊断] ${r.exitCode === 0 ? '✅' : '❌'} ${probe.name} — ${detail}`
      );
    }
  } catch (error) {
    console.log(
      `[A-1 读白名单诊断] ⚠️ 未执行：${String(error).slice(0, 200)}`
    );
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
