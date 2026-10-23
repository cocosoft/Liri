/**
 * 用量历史归一化（2026-10-22）：模型名缺失时不得落 `unknown`
 *
 * 回归的是"照抄调用方占位值"：`ai/middleware/Pipeline` 在 `options.model` 缺失时
 * 传字面量 `'unknown'`，而响应体里其实有供应商回传的真实模型名。历史 2288 行
 * `model='unknown'` 即此成因，且 cost 用的是兜底价、事后无法还原（只能保留原样）。
 *
 * 本文件两层：
 *  ① 纯函数 `resolveUsageModelName`：声明优先 / 占位值回退响应体 / 双双缺失才 unknown；
 *  ② 接线级：真跑 `trackUsage()`，断言交给持久化层的是**真实模型名**而非 unknown。
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  setUserDataDirOverride,
  resolveDbPath,
} from '@openliri/kernel/paths.js';
import {
  resolveUsageModelName,
  trackUsage,
} from '../../src/ai/UsageTracker.js';
import { usageStatsService } from '../../src/ai/models/UsageStatsService.js';

describe('resolveUsageModelName：模型名解析', () => {
  it('调用方声明优先（不被响应体覆盖）', () => {
    expect(resolveUsageModelName('deepseek-v4-flash', 'deepseek-flash')).toBe(
      'deepseek-v4-flash'
    );
  });

  it("声明为占位 'unknown' ⇒ 回退响应体里的真实模型名", () => {
    expect(resolveUsageModelName('unknown', 'deepseek-flash')).toBe(
      'deepseek-flash'
    );
  });

  it('声明缺失 ⇒ 回退响应体', () => {
    expect(resolveUsageModelName(undefined, 'glm-5.2')).toBe('glm-5.2');
    expect(resolveUsageModelName('', 'glm-5.2')).toBe('glm-5.2');
  });

  it("两边都没有 / 都是占位 'unknown' ⇒ 才落 unknown（不猜具体模型）", () => {
    expect(resolveUsageModelName(undefined, undefined)).toBe('unknown');
    expect(resolveUsageModelName('unknown', 'unknown')).toBe('unknown');
    expect(resolveUsageModelName('', '')).toBe('unknown');
  });
});

describe('trackUsage：写入模型名接线', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'liri-usage-model-'));
    setUserDataDirOverride(root);
  });

  afterEach(() => {
    setUserDataDirOverride(null);
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // @ignore-catch — Windows 句柄延迟释放时清理失败不影响断言
    }
  });

  it("声明 'unknown' + 响应体带真实模型名 ⇒ 交给持久化层的是真实模型名", async () => {
    // 断言点放在**持久化边界**，不读库：
    //  `UsageStatsService` 是单例，dbPath 在首次 import 时固化 —— 全套件跑时可能已被别的用例
    //  绑到其它数据根，BUG-06 的第二道护栏会按设计跳过写入（本机单跑却会写）。
    //  这里把路径判据对齐到当前解析路径、并把 logUsage 换成探针，既验证接线又与环境无关。
    const pathSpy = spyOn(usageStatsService, 'getDatabasePath').mockReturnValue(
      resolveDbPath()
    );
    const logSpy = spyOn(usageStatsService, 'logUsage').mockResolvedValue(
      {} as never
    );

    try {
      await trackUsage(
        {
          content: 'ok',
          model: 'deepseek-v4-flash',
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        },
        { model: 'unknown', sessionId: 's-usage-model' }
      );

      expect(logSpy).toHaveBeenCalledTimes(1);
      const params = logSpy.mock.calls[0][0] as { model?: string };
      expect(params.model).toBe('deepseek-v4-flash');
    } finally {
      logSpy.mockRestore();
      pathSpy.mockRestore();
    }
  });
});
