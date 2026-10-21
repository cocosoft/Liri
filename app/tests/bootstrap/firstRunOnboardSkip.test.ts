/**
 * 首次运行引导不得阻塞「应用就绪」（回归锁）
 *
 * 实证事故（2026-10-21）：后台 `bun run --watch src/main.ts` 首启时，
 * `checkFirstRunAndOnboard()` 进入**交互式向导**并等待 stdin：
 *   - 无 TTY（后台/headless/管道）⇒ 永久挂起；
 *   - HTTP 已启动（桌面/前端接入）⇒ 终端里没人回答同样挂起。
 * 两种情况下 `launch()` 尾部（含 `LocalHTTPService._appReady = true`）都不会执行
 * ⇒ 除 `/v1/health/report` 外的业务接口永久 503，前端表现为"连不上后端"。
 *
 * 本用例锁住：HTTP 已启动 / 无 TTY 时函数必须**立即返回**，且不伪造 `.onboarded`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  setUserDataDirOverride,
  resolveDataDir,
  resolveOnboardedFlagPath,
} from '../../src/core/paths.js';
import { checkFirstRunAndOnboard } from '../../src/bootstrap/preflight.js';

let root: string;
const previousHttpStarted = process.env.LIRI_HTTP_STARTED;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-onboard-skip-'));
  setUserDataDirOverride(root);
  mkdirSync(resolveDataDir(), { recursive: true });
  process.env.LIRI_HTTP_STARTED = '1';
});

afterEach(() => {
  setUserDataDirOverride(null);
  if (previousHttpStarted === undefined) {
    delete process.env.LIRI_HTTP_STARTED;
  } else {
    process.env.LIRI_HTTP_STARTED = previousHttpStarted;
  }
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // 句柄未释放 ⇒ 交给系统回收临时目录
  }
});

describe('首次运行引导（不得阻塞就绪）', () => {
  it('HTTP 已启动时立即返回，不进入交互式向导、也不伪造已引导标记', async () => {
    const outcome = await Promise.race([
      checkFirstRunAndOnboard().then(() => 'returned' as const),
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 1500)
      ),
    ]);

    expect(outcome).toBe('returned');
    expect(existsSync(resolveOnboardedFlagPath())).toBe(false);
  });
});
