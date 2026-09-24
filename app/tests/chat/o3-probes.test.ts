/**
 * 三期 O3-1 / O3-2 / O3-3（2026-09-24「会话暴露问题分析与优化方案」§五）：
 *  - O3-1：压缩失败的**归因**（`exception` vs `no_effect`）可分辨且文案同源；
 *  - O3-2：工具耗时告警阈值解析（env 覆盖 + 非法值兜底）；
 *  - O3-3：空结果**可执行诊断**（含已搜路径 / 递归前缀 / 正则写法提示）。
 */

import { describe, it, expect } from 'bun:test';
import { resolveCompactionFailureAttribution } from '../../src/chat/orchestrator/streamMessageFlow.js';
import {
  resolveSlowToolWarnMs,
  DEFAULT_SLOW_TOOL_WARN_MS,
} from '../../src/chat/services/ToolExecutionService.js';
import { buildEmptyResultDiagnostic } from '../../src/tools/GrepTool/GrepTool.js';

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
