// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G-8（2026-10-18）：新接入点统一短路入口 `runRegisteredOutputGuards` 契约测试。
 *
 * 关键不变量：`OUTPUT_GUARD=false`（默认）⇒ 组合根空注册 ⇒ 返回 `null` ⇒
 * 各接入点（流式 chunk / 工具回传 / 文件写入）零行为变更、零管线开销。
 */

import { afterEach, describe, expect, it } from 'bun:test';

import {
  getOutputGuardRegistry,
  resetOutputGuardRegistryForTest,
  runRegisteredOutputGuards,
} from '@modules/security/outputGuardRegistry';
import { createSensitiveContentGuard } from '../../src/chat/outputGuards/sensitiveContentGuard';

/** 命中 `redactSecretsFully` 规则表的假密钥形态（sk- 前缀 + 长值；固定假值，非真实凭据） */
const FAKE_SECRET = `sk-proj-${'G'.repeat(40)}`;

afterEach(() => {
  resetOutputGuardRegistryForTest();
});

describe('runRegisteredOutputGuards（G-8 接入点短路入口）', () => {
  it('空注册（默认 OUTPUT_GUARD=false 语义）⇒ 返回 null（调用方零变更）', () => {
    expect(runRegisteredOutputGuards(`key = ${FAKE_SECRET}`)).toBeNull();
  });

  it('注册敏感护栏且未命中 ⇒ pass（文本原样）', () => {
    getOutputGuardRegistry().register(createSensitiveContentGuard());
    const r = runRegisteredOutputGuards('hello world');
    expect(r).not.toBeNull();
    expect(r!.blocked).toBe(false);
    expect(r!.redactedBy).toEqual([]);
    expect(r!.text).toBe('hello world');
  });

  it('注册敏感护栏且命中 ⇒ redact（文本已打码，redactedBy 记录护栏名）', () => {
    getOutputGuardRegistry().register(createSensitiveContentGuard());
    const input = `api_key = "${FAKE_SECRET}"`;
    const r = runRegisteredOutputGuards(input);
    expect(r).not.toBeNull();
    expect(r!.blocked).toBe(false);
    expect(r!.redactedBy).toContain('sensitive_content');
    expect(r!.text).not.toContain(FAKE_SECRET);
  });

  it('注册 block 护栏 ⇒ blocked + 阻断原因（替代文本缺省时沿用当前文本）', () => {
    getOutputGuardRegistry().register({
      name: 'test_blocker',
      priority: 1,
      check: () => ({
        action: 'block',
        issues: [
          { guard: 'test_blocker', severity: 'block', message: '测试阻断' },
        ],
      }),
    });
    const r = runRegisteredOutputGuards('anything');
    expect(r).not.toBeNull();
    expect(r!.blocked).toBe(true);
    expect(r!.blockReason).toBe('测试阻断');
    expect(r!.text).toBe('anything');
  });
});
