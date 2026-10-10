/**
 * P0-4 —— 崩溃恢复后 `unknown` 工具调用的重放策略（`.trae/specs/unknown-tool-call-recovery.md` §4）。
 *
 * 语义红线：**仅幂等工具可自动重放**；非幂等 / 未声明（MCP·插件）⇒ 需人工/补偿
 * （不得让"库看起来恢复正常"掩盖"外部世界已重复操作"）。
 */
import { describe, expect, it } from 'bun:test';

import {
  canReplayAfterUnknown,
  resolveToolRecoveryPolicy,
} from '../../src/tools/toolEffects.js';

describe('P0-4 工具恢复策略', () => {
  it('幂等工具（只读/无副作用）⇒ retryable', () => {
    expect(resolveToolRecoveryPolicy('file_read')).toBe('retryable');
    expect(resolveToolRecoveryPolicy('glob')).toBe('retryable');
    expect(resolveToolRecoveryPolicy('sleep')).toBe('retryable');
  });

  it('非幂等工具 ⇒ manual（禁止自动重放）', () => {
    expect(resolveToolRecoveryPolicy('file_write')).toBe('manual');
    expect(resolveToolRecoveryPolicy('bash')).toBe('manual');
    expect(resolveToolRecoveryPolicy('code_run')).toBe('manual');
    expect(resolveToolRecoveryPolicy('image_generate')).toBe('manual');
  });

  it('未声明工具（MCP / 插件）⇒ manual（保守：无法证明幂等）', () => {
    expect(resolveToolRecoveryPolicy('mcp__unknown_server__tool')).toBe(
      'manual'
    );
    expect(resolveToolRecoveryPolicy('plugin:custom')).toBe('manual');
    expect(resolveToolRecoveryPolicy('')).toBe('manual');
  });

  it('canReplayAfterUnknown 恒等价于 (policy === retryable)', () => {
    expect(canReplayAfterUnknown('file_read')).toBe(true);
    expect(canReplayAfterUnknown('file_write')).toBe(false);
    expect(canReplayAfterUnknown('bash')).toBe(false);
    expect(canReplayAfterUnknown('mcp__x')).toBe(false);
  });
});
