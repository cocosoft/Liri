/**
 * 三期 O3-1 / O3-2 / O3-3（2026-09-24「会话暴露问题分析与优化方案」§五）：
 *  - O3-1：压缩失败的**归因**（`exception` vs `no_effect`）可分辨且文案同源；
 *  - O3-2：工具耗时告警阈值解析（env 覆盖 + 非法值兜底）；
 *  - O3-3：空结果**可执行诊断**（含已搜路径 / 递归前缀 / 正则写法提示）。
 */

import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveCompactionFailureAttribution } from '../../src/chat/orchestrator/streamMessageFlow.js';
import {
  resolveSlowToolWarnMs,
  DEFAULT_SLOW_TOOL_WARN_MS,
  summarizeToolScope,
  summarizeToolScale,
  resolveToolReportedMs,
} from '../../src/chat/services/ToolExecutionService.js';
import { buildEmptyResultDiagnostic } from '../../src/tools/GrepTool/GrepTool.js';
import { grepAsync } from '../../src/tools/GrepTool/grep.js';

describe('O3-1 压缩失败归因', () => {
  it('有 failure ⇒ reason=exception，文案带原始错误信息（修复前合并成一句，无法分辨）', () => {
    const a = resolveCompactionFailureAttribution({
      reason: 'exception',
      message: 'EISDIR: illegal operation on a directory',
    });
    expect(a.reason).toBe('exception');
    expect(a.failureMessage).toContain('EISDIR');
    expect(a.message).toContain('压缩异常');
    expect(a.message).toContain('EISDIR');
  });

  it('无 failure ⇒ reason=no_effect（"压不动"），与异常路径文案不同', () => {
    const a = resolveCompactionFailureAttribution(undefined);
    expect(a.reason).toBe('no_effect');
    expect(a.failureMessage).toBeUndefined();
    expect(a.message).toContain('未降体积');
    // 修复前：两者共用"未降体积或异常"一句 ⇒ 事件溯源无法区分
    expect(a.message).not.toContain('压缩异常');
  });
});

describe('O3-2 工具耗时告警阈值', () => {
  it('env 合法 ⇒ 采用 env 值', () => {
    expect(resolveSlowToolWarnMs('1000')).toBe(1000);
    expect(resolveSlowToolWarnMs('25000')).toBe(25000);
  });

  it('env 缺失/非法 ⇒ 默认 15s（不静默当 0）', () => {
    expect(resolveSlowToolWarnMs(undefined)).toBe(DEFAULT_SLOW_TOOL_WARN_MS);
    expect(resolveSlowToolWarnMs('')).toBe(DEFAULT_SLOW_TOOL_WARN_MS);
    expect(resolveSlowToolWarnMs('abc')).toBe(DEFAULT_SLOW_TOOL_WARN_MS);
    expect(resolveSlowToolWarnMs('-1')).toBe(DEFAULT_SLOW_TOOL_WARN_MS);
    expect(resolveSlowToolWarnMs('0')).toBe(DEFAULT_SLOW_TOOL_WARN_MS);
  });

  it('未传参 ⇒ 经 configManager.env() 统一入口读取（R05-012，非直读 process.env）', () => {
    const prev = process.env.TOOL_SLOW_WARN_MS;
    process.env.TOOL_SLOW_WARN_MS = '4242';
    try {
      expect(resolveSlowToolWarnMs()).toBe(4242);
    } finally {
      if (prev === undefined) delete process.env.TOOL_SLOW_WARN_MS;
      else process.env.TOOL_SLOW_WARN_MS = prev;
    }
  });
});

describe('O3-3 空结果可执行诊断', () => {
  it('给出已搜路径 / include / 递归前缀 / 正则写法 / 去重短路提示', () => {
    const text = buildEmptyResultDiagnostic({
      pattern: 'kvCache',
      searchPath: 'e:/proj/app/src',
      include: '*.ts',
    });
    // 修复前：返回体只有"匹配 0 处，分布在 0 个文件"⇒ 模型换关键词空转
    expect(text).toContain('无匹配');
    expect(text).toContain('kvCache');
    expect(text).toContain('e:/proj/app/src');
    expect(text).toContain('*.ts');
    expect(text).toContain('**/*.ts');
    expect(text).toContain('[\\u4e00-\\u9fa5]');
    expect(text).toContain('去重短路');
  });

  it('未给 include ⇒ 标注"(未限制)"而非空字符串', () => {
    const text = buildEmptyResultDiagnostic({
      pattern: 'x',
      searchPath: 'p',
    });
    expect(text).toContain('(未限制)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * #5（2026-09-24）耗时构成分解：原 O3-2 只回答"多慢"，本组回答"慢在哪"
 * ══════════════════════════════════════════════════════════════════════════ */

const statsDir = mkdtempSync(join(tmpdir(), 'grep-stats-'));

afterAll(() => {
  rmSync(statsDir, { recursive: true, force: true });
});

describe('#5 入参范围摘要（summarizeToolScope）', () => {
  it('只取白名单键（路径/pattern/include），非白名单键不入日志', () => {
    const scope = summarizeToolScope({
      searchPath: 'e:/proj/app/src',
      pattern: 'kvCache',
      include: '*.ts',
      // 以下都不得出现在摘要里（避免把正文/敏感值写进日志）
      content: 'SECRET-BODY',
      apiKey: 'sk-xxx',
      nested: { a: 1 },
    });
    expect(scope).toEqual({
      searchPath: 'e:/proj/app/src',
      pattern: 'kvCache',
      include: '*.ts',
    });
    expect(JSON.stringify(scope)).not.toContain('SECRET-BODY');
    expect(JSON.stringify(scope)).not.toContain('sk-xxx');
  });

  it('超长值截断并标注原长（防日志被单值撑爆）', () => {
    const long = 'x'.repeat(300);
    const scope = summarizeToolScope({ pattern: long });
    expect(scope!.pattern.length).toBeLessThan(160);
    expect(scope!.pattern).toContain('共 300 字');
  });

  it('无白名单键 / 非对象 ⇒ undefined（不产出空摘要）', () => {
    expect(summarizeToolScope({ foo: 'bar' })).toBeUndefined();
    expect(summarizeToolScope('not-an-object')).toBeUndefined();
    expect(summarizeToolScope(undefined)).toBeUndefined();
  });
});

describe('#5 结果规模摘要（summarizeToolScale）', () => {
  it('取工具自报的计数，并把 grep 的 stats 摊平为 scannedEntries/scannedFiles', () => {
    const scale = summarizeToolScale({
      matchCount: 3,
      fileCount: 2,
      truncated: false,
      durationMs: 1234,
      stats: { entries: 9876, files: 4321 },
    });
    expect(scale).toEqual({
      matchCount: 3,
      fileCount: 2,
      truncated: false,
      durationMs: 1234,
      scannedEntries: 9876,
      scannedFiles: 4321,
    });
  });

  it('payload 无可用计数 ⇒ undefined（不臆造）；非对象同样 undefined', () => {
    expect(summarizeToolScale({ matches: ['a'] })).toBeUndefined();
    expect(summarizeToolScale(null)).toBeUndefined();
    expect(summarizeToolScale('x')).toBeUndefined();
    expect(summarizeToolScale(undefined)).toBeUndefined();
  });

  it('工具自报耗时缺失/非有限数 ⇒ undefined（不据此臆测开销）', () => {
    expect(resolveToolReportedMs({ durationMs: 42 })).toBe(42);
    expect(resolveToolReportedMs({ durationMs: Number.NaN })).toBeUndefined();
    expect(resolveToolReportedMs({})).toBeUndefined();
    expect(resolveToolReportedMs(undefined)).toBeUndefined();
  });
});

describe('#5 grep 遍历规模计数（grepAsync.stats）', () => {
  it('统计遍历条目与进入匹配的文件数，并跳过 VCS / 点目录', async () => {
    writeFileSync(join(statsDir, 'a.ts'), 'const kvCache = 1;\n');
    writeFileSync(join(statsDir, 'b.ts'), 'const kvCache = 2;\n');
    writeFileSync(join(statsDir, 'c.md'), 'no match here\n');
    writeFileSync(join(statsDir, '.hidden.ts'), 'const kvCache = 3;\n');
    mkdirSync(join(statsDir, '.git'), { recursive: true });
    writeFileSync(join(statsDir, '.git', 'skip.ts'), 'const kvCache = 4;\n');

    const result = await grepAsync({
      pattern: 'kvCache',
      searchPath: statsDir,
      outputMode: 'count',
    });

    expect(result.matchCount).toBe(2);
    expect(result.fileCount).toBe(2);
    // 3 个可见文件进入匹配；`.git` 与 `.hidden.ts` 被跳过（不计入）
    expect(result.stats).toEqual({ entries: 3, files: 3 });
  });

  it('单文件搜索路径同样计数（files=1）', async () => {
    const result = await grepAsync({
      pattern: 'kvCache',
      searchPath: join(statsDir, 'a.ts'),
    });
    expect(result.stats).toEqual({ entries: 0, files: 1 });
  });

  it('链路：真实 grep 产出 → 探针规模提取（scannedFiles/scannedEntries 可见）', async () => {
    const result = await grepAsync({
      pattern: 'kvCache',
      searchPath: statsDir,
      outputMode: 'count',
    });
    // 模拟 GrepTool 组装进 data 的形态（含 stats）
    const payload = {
      matches: result.matches,
      matchCount: result.matchCount,
      fileCount: result.fileCount,
      truncated: result.truncated,
      durationMs: result.durationMs,
      ...(result.stats ? { stats: result.stats } : {}),
    };

    const scale = summarizeToolScale(payload);
    expect(scale).toMatchObject({
      matchCount: 2,
      fileCount: 2,
      scannedEntries: 3,
      scannedFiles: 3,
    });
    expect(resolveToolReportedMs(payload)).toBe(result.durationMs);
  });
});
