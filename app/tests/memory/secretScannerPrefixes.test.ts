// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-27（2026-10-17）：新增 OpenAI 项目键 / Anthropic 键前缀识别。
 */
import { describe, it, expect } from 'bun:test';
import { scanForSecrets } from '../../src/memory/scanners/MemorySecretScanner.js';

describe('MemorySecretScanner 新前缀', () => {
  it('识别 sk-proj- 项目键', () => {
    const key = `sk-proj-${'A'.repeat(40)}`;
    expect(
      scanForSecrets(`key=${key}`).some(
        (m) => m.ruleId === 'openai-project-key'
      )
    ).toBe(true);
  });

  it('识别 sk-svcacct- 服务账号键', () => {
    const key = `sk-svcacct-${'B'.repeat(40)}`;
    expect(
      scanForSecrets(`key=${key}`).some(
        (m) => m.ruleId === 'openai-project-key'
      )
    ).toBe(true);
  });

  it('识别 sk-ant- Anthropic 键', () => {
    const key = `sk-ant-api03-${'C'.repeat(40)}`;
    expect(
      scanForSecrets(`key=${key}`).some((m) => m.ruleId === 'anthropic-api-key')
    ).toBe(true);
  });

  it('普通文本不误报', () => {
    expect(scanForSecrets('sk-proj 不是密钥')).toEqual([]);
  });
});
