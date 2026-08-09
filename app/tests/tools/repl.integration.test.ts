/**
 * REPL 真实 spawn 集成测试（P3-1 完成标记协议回归）
 *
 * 覆盖根因场景：交互式 REPL（python -i）执行代码后进程不退出，
 * 标记协议应让 executeCode 在超时前返回真实输出并保留会话。
 * 无 python 环境时自动跳过（CI 安全）。
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'child_process';
import { REPLToolImpl } from '../../src/tools/repl/REPLToolImpl.js';
import type { REPLSession } from '../../src/tools/repl/types/REPLTool.js';

/** 探测 python 可用性 */
const pythonAvailable = (() => {
  try {
    const r = spawnSync('python', ['--version'], { stdio: 'pipe' });
    return r.status === 0;
  } catch {
    return false;
  }
})();

describe('REPLToolImpl 真实 spawn（P3-1 完成标记协议）', () => {
  const tool = new REPLToolImpl();
  let session: REPLSession | undefined;

  beforeAll(async () => {
    if (!pythonAvailable) return;
    session = await tool.startREPL('python', { timeout: 4000 });
  });

  afterAll(async () => {
    if (session) await tool.stopREPL(session);
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
      // 完成标记协议应在 4s 超时前返回；留足余量避免慢机误判
      expect(elapsed).toBeLessThan(3000);
    }
  );

  test.skipIf(!pythonAvailable)('错误执行返回 Traceback 且 success=false', async () => {
    const r = await tool.executeCode(session!, '1/0');
    expect(r.success).toBe(false);
    expect(r.error).toContain('ZeroDivisionError');
  });

  test.skipIf(!pythonAvailable)('会话状态跨执行保留（REPL 非一次性）', async () => {
    await tool.executeCode(session!, 'x = 21 * 2');
    const r = await tool.executeCode(session!, 'print(x)');
    expect(r.success).toBe(true);
    expect(r.output).toContain('42');
  });

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
      const s = await tool.startREPL('python', { timeout: 1000 });
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
});
