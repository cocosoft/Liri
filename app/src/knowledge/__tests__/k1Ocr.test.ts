// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// R1 扫描件 OCR 开关与判定（纯函数层；L2 OCR/渲染通道复用既有实现，无引擎单测）

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  requiresOcr,
  isPdfOcrEnabled,
  SCAN_MIN_CHARS_PER_PAGE,
} from '../ingestion/extractors/PdfOcrExtractor';

const ENV_KEY = 'KNOWLEDGE_PDF_OCR';

beforeEach(() => {
  delete process.env[ENV_KEY];
});

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('R1 requiresOcr（扫描件判定）', () => {
  it('空文本 → 需要 OCR', () => {
    expect(requiresOcr('', 1)).toBe(true);
    expect(requiresOcr('', 0)).toBe(true);
  });

  it('文本稀薄（均页低于阈值）→ 需要 OCR', () => {
    const low = 'A'.repeat(SCAN_MIN_CHARS_PER_PAGE - 1);
    expect(requiresOcr(low, 1)).toBe(true);
    // 2 页：每页 10 字符 < 15
    expect(requiresOcr('A'.repeat(20), 2)).toBe(true);
  });

  it('正常文本 → 不需要 OCR', () => {
    expect(requiresOcr('A'.repeat(SCAN_MIN_CHARS_PER_PAGE), 1)).toBe(false);
    expect(requiresOcr('中文字符填充内容'.repeat(50), 2)).toBe(false);
  });
});

describe('R1 isPdfOcrEnabled（默认关开关）', () => {
  it('未设置或 0/false → 关闭（默认）', () => {
    expect(isPdfOcrEnabled()).toBe(false);
    process.env[ENV_KEY] = '0';
    expect(isPdfOcrEnabled()).toBe(false);
    process.env[ENV_KEY] = 'false';
    expect(isPdfOcrEnabled()).toBe(false);
  });

  it('1/true → 开启', () => {
    process.env[ENV_KEY] = '1';
    expect(isPdfOcrEnabled()).toBe(true);
    process.env[ENV_KEY] = 'true';
    expect(isPdfOcrEnabled()).toBe(true);
  });
});
