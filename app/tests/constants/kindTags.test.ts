/**
 * D-1（2026-10-18）B 类可调参数的 env 覆盖守卫。
 *
 * 验收锚点（清单 §5 D-1）：「B 类有 env 覆盖测试」。
 * `@kind` 标签完整性由 `lint:consts` 单点校验（`checkKindTags`），本文件不重复实现扫描。
 */
import { describe, it, expect, afterEach } from 'bun:test';

import { getRuntimeDefaults } from '../../src/constants/defaults';

/** 本用例涉及的 env 名（afterEach 统一清理，避免污染其它测试） */
const TOUCHED_ENV = [
  'LIRI_REQUEST_TIMEOUT_MS',
  'LIRI_MAX_CONCURRENT_TASKS',
  'LIRI_DEFAULT_HOST',
  'LIRI_DEFAULT_PORT',
  'LIRI_API_IMAGE_MAX_BASE64_SIZE',
  'LIRI_TOOL_RESULT_MAX_TOKENS',
  'LIRI_PDF_MAX_PAGES_PER_READ',
];

afterEach(() => {
  for (const name of TOUCHED_ENV) delete process.env[name];
});

describe('D-1 B 类 env 覆盖', () => {
  it('未设置 env ⇒ 返回内置默认值（行为零变化）', () => {
    const d = getRuntimeDefaults();
    expect(d.requestTimeoutMs).toBe(60 * 1000);
    expect(d.maxConcurrentTasks).toBe(10);
    expect(d.defaultHost).toBe('localhost');
    expect(d.defaultPort).toBe(3000);
  });

  it('数值型 env 覆盖生效', () => {
    process.env.LIRI_REQUEST_TIMEOUT_MS = '12345';
    process.env.LIRI_MAX_CONCURRENT_TASKS = '4';
    process.env.LIRI_PDF_MAX_PAGES_PER_READ = '7';

    const d = getRuntimeDefaults();
    expect(d.requestTimeoutMs).toBe(12345);
    expect(d.maxConcurrentTasks).toBe(4);
    expect(d.pdfMaxPagesPerRead).toBe(7);
  });

  it('字符串型 env 覆盖生效', () => {
    process.env.LIRI_DEFAULT_HOST = '0.0.0.0';
    expect(getRuntimeDefaults().defaultHost).toBe('0.0.0.0');
  });

  it('非法值（非整数 / 负数）⇒ 回退默认', () => {
    process.env.LIRI_REQUEST_TIMEOUT_MS = 'abc';
    process.env.LIRI_DEFAULT_PORT = '-1';
    const d = getRuntimeDefaults();
    expect(d.requestTimeoutMs).toBe(60 * 1000);
    expect(d.defaultPort).toBe(3000);
  });

  it('派生字段随源字段计算：imageTargetRawSize = base64 上限 × 3/4', () => {
    process.env.LIRI_API_IMAGE_MAX_BASE64_SIZE = String(4 * 1024 * 1024);
    const d = getRuntimeDefaults();
    expect(d.apiImageMaxBase64Size).toBe(4 * 1024 * 1024);
    expect(d.imageTargetRawSize).toBe(3 * 1024 * 1024);
  });

  it('派生字段随源字段计算：contextMaxToolResultBytes = tokens × 4', () => {
    process.env.LIRI_TOOL_RESULT_MAX_TOKENS = '1000';
    const d = getRuntimeDefaults();
    expect(d.maxToolResultTokens).toBe(1000);
    expect(d.contextMaxToolResultBytes).toBe(4000);
  });
});
