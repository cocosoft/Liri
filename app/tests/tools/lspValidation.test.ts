/**
 * 2026-10-31（S6 第一步）：LSP 工具面的结构校验。
 *
 * 这组守卫原借用轨 B（`app/src/lsp` 的 zod schemas + 全局缓存），现下沉到
 * `tools/lsp/validation.ts` —— 轨 B 因此**零静态消费者**，可进入 CD05 观察期。
 * 本文件锁定与轨 B 逐条对齐的约束（Position/Range/Location/Diagnostic）。
 */
import { describe, expect, it } from 'bun:test';

import {
  validateDiagnostic,
  validateLocation,
  validatePosition,
  validateRange,
} from '../../src/tools/lsp/validation';

const pos = { line: 0, character: 3 };
const range = { start: pos, end: { line: 2, character: 0 } };
const uri = 'file:///e:/proj/src/a.ts';

describe('validatePosition', () => {
  it('接受 0 起的整数行/列', () => {
    expect(validatePosition({ line: 0, character: 0 })).toBe(true);
    expect(validatePosition({ line: 12, character: 240 })).toBe(true);
  });

  it('拒绝负数 / 小数 / 缺字段 / 非对象', () => {
    expect(validatePosition({ line: -1, character: 0 })).toBe(false);
    expect(validatePosition({ line: 1.5, character: 0 })).toBe(false);
    expect(validatePosition({ line: 1 })).toBe(false);
    expect(validatePosition(null)).toBe(false);
    expect(validatePosition([1, 2])).toBe(false);
    expect(validatePosition('1:2')).toBe(false);
  });
});

describe('validateRange', () => {
  it('start / end 都是合法 Position 才通过', () => {
    expect(validateRange(range)).toBe(true);
    expect(validateRange({ start: pos, end: { line: -1, character: 0 } })).toBe(
      false
    );
    expect(validateRange({ start: pos })).toBe(false);
  });
});

describe('validateLocation', () => {
  it('uri 必须是可解析的绝对 URL（与轨 B `z.string().url()` 同口径）', () => {
    expect(validateLocation({ uri, range })).toBe(true);
    expect(validateLocation({ uri: 'src/a.ts', range })).toBe(false);
    expect(validateLocation({ uri: '', range })).toBe(false);
    expect(validateLocation({ uri, range: { start: pos } })).toBe(false);
  });
});

describe('validateDiagnostic', () => {
  it('最小合法形态：range + message', () => {
    expect(validateDiagnostic({ range, message: 'unused var' })).toBe(true);
  });

  it('severity 仅接受 1–4 的整数', () => {
    expect(validateDiagnostic({ range, message: 'm', severity: 1 })).toBe(true);
    expect(validateDiagnostic({ range, message: 'm', severity: 4 })).toBe(true);
    expect(validateDiagnostic({ range, message: 'm', severity: 0 })).toBe(
      false
    );
    expect(validateDiagnostic({ range, message: 'm', severity: 5 })).toBe(
      false
    );
    expect(validateDiagnostic({ range, message: 'm', severity: 2.5 })).toBe(
      false
    );
  });

  it('code 接受 string|number；source 只接受 string；message 必填', () => {
    expect(validateDiagnostic({ range, message: 'm', code: 'E1' })).toBe(true);
    expect(validateDiagnostic({ range, message: 'm', code: 2322 })).toBe(true);
    expect(validateDiagnostic({ range, message: 'm', code: { x: 1 } })).toBe(
      false
    );
    expect(validateDiagnostic({ range, message: 'm', source: 'ts' })).toBe(
      true
    );
    expect(validateDiagnostic({ range, message: 'm', source: 1 })).toBe(false);
    expect(validateDiagnostic({ range })).toBe(false);
  });
});
