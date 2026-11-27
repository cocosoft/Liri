/**
 * REPL 真实 spawn 集成测试（P3-1 完成标记协议回归）
 *
 * 覆盖根因场景：交互式 REPL（python -i）执行代码后进程不退出，
 * 标记协议应让 executeCode 在超时前返回真实输出并保留会话。
 * 无 python 环境时自动跳过（CI 安全）。
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { REPLToolImpl } from '@openliri/tool-code/repl/REPLToolImpl';
import { replSessionManager } from '@openliri/tool-code/repl/REPLSessionManager';
import type { REPLSession } from '@openliri/tool-code/repl/types/REPLTool';

/** 探测 python 可用性 */
const pythonAvailable = (() => {
  try {
    const r = spawnSync('python', ['--version'], { stdio: 'pipe' });
    return r.status === 0;
  } catch {
    return false;
  }
})();

/**
 * 执行超时（P0-8，2026-10-04）：全量并行（140+ 文件同进程抢 CPU）下 python REPL 的启动/应答
 * 会明显变慢，固定 4000ms 会偶发"假红"（台账 2026-09-24：全量并行下本文件**必现 1 例失败**、
 * 单跑却 5/5 通过）。改为**可按环境变量放宽**（`REPL_TEST_TIMEOUT_MS`，默认 8000ms）。
 */
const EXEC_TIMEOUT_MS = Number(process.env.REPL_TEST_TIMEOUT_MS) || 8000;

describe('REPLToolImpl 真实 spawn（P3-1 完成标记协议）', () => {
  const tool = new REPLToolImpl();
  let session: REPLSession | undefined;
  // SG-1（2026-11-27）：REPL 现在会按平台进写隔离（Windows 需给"可写目录"临时降完整性标签）。
  // 用临时目录当工作区，避免测试跑一次就去改**仓库根**的 ACL（真机上那是整棵树）。
  let testCwd: string;

  beforeAll(async () => {
    testCwd = mkdtempSync(join(tmpdir(), 'repl-it-'));
    if (!pythonAvailable) return;
    session = await tool.startREPL('python', {
      cwd: testCwd,
      timeout: EXEC_TIMEOUT_MS,
    });
  });
  // 注（P0-8）：bun 的 per-test timeout **不覆盖钩子/加载期**，而 `beforeAll` 的类型不接受超时参数
  //（传第二参会 `TS2554`）⇒ 钩子期若挂死仍无法靠超时兜底（属 P0-8 死锁的已知边界，另行专项）。

  afterAll(async () => {
    if (session) await tool.stopREPL(session);
    // `stopREPL` 只把会话置 STOPPED（保留在进程级单例里），不在本文件清理 ⇒ 后续文件的
    // 会话计数会被带偏（`notebook.test.ts` 的「无会话时新建」实测 1 → 2）。
    replSessionManager.clearSessions();
    rmSync(testCwd, { recursive: true, force: true });
  });

  test.skipIf(!pythonAvailable)(
    '正常执行返回真实输出，不等满超时（根因回归）',
    async () => {
      const start = Date.now();
      const r = await tool.executeCode(session!, 'print("repl-ok-123")');
      const elapsed = Date.now() - start;
      expect(r.success).toBe(true);
      expect(r.output).toContain('repl-ok-123');
      expect(r.error).toBeUndefined();
      // 完成标记协议应在超时前**明显提前**返回（与超时之差留 1s 余量，避免慢机误判）
      expect(elapsed).toBeLessThan(EXEC_TIMEOUT_MS - 1000);
    }
  );

  test.skipIf(!pythonAvailable)(
    '错误执行返回 Traceback 且 success=false',
    async () => {
      const r = await tool.executeCode(session!, '1/0');
      expect(r.success).toBe(false);
      expect(r.error).toContain('ZeroDivisionError');
    }
  );

  test.skipIf(!pythonAvailable)(
    '会话状态跨执行保留（REPL 非一次性）',
    async () => {
      await tool.executeCode(session!, 'x = 21 * 2');
      const r = await tool.executeCode(session!, 'print(x)');
      expect(r.success).toBe(true);
      expect(r.output).toContain('42');
    }
  );

  test.skipIf(!pythonAvailable)('无输出代码也正常返回成功', async () => {
    const r = await tool.executeCode(session!, 'y = 1 + 1');
    expect(r.success).toBe(true);
    expect(r.error).toBeUndefined();
  });

  test.skipIf(!pythonAvailable)(
    '阻塞代码超时后返回超时结果而非永久挂起（U-1 根因回归）',
    async () => {
      // U-1 修复前：executeCode 无超时（等进程退出）→ 永久挂起 → 会话锁泄漏。
      // 修复后：session.options.timeout 无条件生效，超时 kill 进程 + resolve 超时结果。
      const s = await tool.startREPL('python', {
        cwd: testCwd,
        timeout: 1000,
      });
      try {
        const start = Date.now();
        const r = await tool.executeCode(s, 'import time; time.sleep(10)');
        const elapsed = Date.now() - start;
        expect(r.success).toBe(false);
        expect(r.error).toContain('timed out');
        // 超时应在 1s 附近返回，而非等满 sleep(10)；留足余量避免慢机误判
        expect(elapsed).toBeLessThan(5000);
      } finally {
        await tool.stopREPL(s);
      }
    },
    15000 // 真实 spawn 集成测试，全量并行时给足余量
  );

  /**
   * SG-1（2026-11-27）：真写隔离的**双向**断言。
   *
   * 只在"本机确实施加了隔离"时跑（无 helper 的 CI / 关闭总开关的环境会降级为 `none`，
   * 那样的环境里"写不出去"不成立，属预期，不该假红）。
   */
  test.skipIf(!pythonAvailable)(
    '沙箱生效时：可写工作区，且工作区外写入被拒',
    async () => {
      if (session?.sandbox?.mode === 'none' || !session?.sandbox) return;
      // ① 工作区（授权目录）内可写
      const ok = await tool.executeCode(
        session,
        'open("repl-sbx-write-ok.txt", "w").write("ok")'
      );
      expect(ok.success).toBe(true);
      // ② 工作区外（用户家目录根，任何平台都不在白名单内）写入被拒
      const denied = await tool.executeCode(
        session,
        'import os\n' +
          'open(os.path.join(os.path.expanduser("~"), "liri-repl-sbx-denied.txt"), "w").write("x")'
      );
      expect(denied.success).toBe(false);
      expect(denied.error).toBeTruthy();
    },
    15000
  );
});

/**
 * C-2（2026-11-27）：`typescript` 语言的**离线** e2e。
 *
 * `typescript` 映射为 `npx ts-node -i`，而 CI 无网络（`npx` 首次要联网装 ts-node）⇒
 * 用一个假的 `npx`（Windows = `npx.cmd`，POSIX = 可执行 shell 脚本）忽略参数、直接起 `node -i`。
 * 因此本组验证的是**typescript 路径的启动链**（`npx` 解析 → `.cmd` 转交 / 沙箱包裹 → 交互与跨执行状态），
 * **不是** ts-node 本身 —— ts-node 的真实行为需联网环境，属 C-2 的如实边界。
 */
const nodeAvailable = (() => {
  try {
    return spawnSync('node', ['--version'], { stdio: 'pipe' }).status === 0;
  } catch {
    return false;
  }
})();

describe('REPLToolImpl：typescript（离线 npx fixture，C-2）', () => {
  const tool = new REPLToolImpl();
  let fixtureDir = '';
  let originalPath = '';
  let session: REPLSession | undefined;

  beforeAll(async () => {
    if (!nodeAvailable) return;
    fixtureDir = mkdtempSync(join(tmpdir(), 'repl-npx-fixture-'));
    const isWin = process.platform === 'win32';
    const shim = join(fixtureDir, isWin ? 'npx.cmd' : 'npx');
    writeFileSync(
      shim,
      isWin ? '@echo off\r\nnode -i\r\n' : '#!/bin/sh\nexec node -i\n',
      'utf8'
    );
    if (!isWin) chmodSync(shim, 0o755);
    // Windows 的 `where.exe` 解析读的是 `process.env`（不看 options.env）⇒ 必须改全局 PATH；
    // 非 Windows 只影响子进程 PATH，同样走这里以保持两侧一致。
    originalPath = process.env.PATH ?? '';
    process.env.PATH = `${fixtureDir}${delimiter}${originalPath}`;
    session = await tool.startREPL('typescript', {
      cwd: fixtureDir,
      timeout: EXEC_TIMEOUT_MS,
    });
  });

  afterAll(async () => {
    if (session) await tool.stopREPL(session);
    replSessionManager.clearSessions();
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
    if (originalPath) process.env.PATH = originalPath;
  });

  test.skipIf(!nodeAvailable)(
    '启动后可执行（npx → 解释器的转交链通）',
    async () => {
      const r = await tool.executeCode(session!, '1+1');
      expect(r.success).toBe(true);
      expect(r.output).toContain('2');
    },
    15000
  );

  test.skipIf(!nodeAvailable)(
    '跨执行保留状态（同一进程）',
    async () => {
      await tool.executeCode(session!, 'const z = 21 * 2');
      const r = await tool.executeCode(session!, 'z');
      expect(r.success).toBe(true);
      expect(r.output).toContain('42');
    },
    15000
  );
});
