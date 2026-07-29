// MIT License
// Copyright (c) 2026 190615273@qq.com

// P2-12: max_output 加倍重试测试
import { describe, it, expect } from 'bun:test';
import {
  shouldRetryMaxOutput,
  computeNextMaxTokens,
  createMaxOutputRetryState,
  advanceMaxOutputRetry,
} from '../../src/ai/MaxOutputRetryHandler';

describe('MaxOutputRetryHandler', () => {
  describe('shouldRetryMaxOutput', () => {
    it('retries on length stop reason', () => {
      expect(shouldRetryMaxOutput('length', 0, 4096)).toBe(true);
    });

    it('retries on max_tokens stop reason', () => {
      expect(shouldRetryMaxOutput('max_tokens', 0, 4096)).toBe(true);
    });

    it('does not retry on stop reason', () => {
      expect(shouldRetryMaxOutput('stop', 0, 4096)).toBe(false);
    });

    it('does not retry on null/undefined', () => {
      expect(shouldRetryMaxOutput(undefined, 0, 4096)).toBe(false);
    });

    it('stops at max retries', () => {
      expect(shouldRetryMaxOutput('length', 3, 4096)).toBe(false);
      expect(shouldRetryMaxOutput('length', 2, 4096)).toBe(true);
    });

    it('stops at max output limit', () => {
      expect(shouldRetryMaxOutput('length', 0, 64000)).toBe(false);
      expect(shouldRetryMaxOutput('length', 0, 63999)).toBe(true);
    });

    it('respects custom maxRetries', () => {
      expect(shouldRetryMaxOutput('length', 1, 4096, { maxRetries: 1 })).toBe(false);
    });

    it('respects custom maxOutputLimit', () => {
      expect(shouldRetryMaxOutput('length', 0, 32000, { maxOutputLimit: 32000 })).toBe(false);
    });
  });

  describe('computeNextMaxTokens', () => {
    it('doubles current max tokens', () => {
      expect(computeNextMaxTokens(4096)).toBe(8192);
    });

    it('caps at maxOutputLimit', () => {
      expect(computeNextMaxTokens(32768)).toBe(64000);
    });
  });

  describe('advanceMaxOutputRetry', () => {
    it('marks shouldRetry=true and doubles tokens on length', () => {
      const state = createMaxOutputRetryState(4096);
      const next = advanceMaxOutputRetry('length', state);

      expect(next.shouldRetry).toBe(true);
      expect(next.retryCount).toBe(1);
      expect(next.nextMaxTokens).toBe(8192);
    });

    it('marks shouldRetry=false on stop', () => {
      const state = createMaxOutputRetryState(4096);
      const next = advanceMaxOutputRetry('stop', state);

      expect(next.shouldRetry).toBe(false);
      expect(next.retryCount).toBe(0);
    });

    it('stops after reaching maxRetries', () => {
      let state = createMaxOutputRetryState(4096);
      state = advanceMaxOutputRetry('length', state); // 1: 8192
      state = advanceMaxOutputRetry('length', state); // 2: 16384
      state = advanceMaxOutputRetry('length', state); // 3: 32768
      state = advanceMaxOutputRetry('length', state); // 4: should stop

      expect(state.shouldRetry).toBe(false);
      expect(state.retryCount).toBe(3);
    });

    it('caps at maxOutputLimit', () => {
      let state = createMaxOutputRetryState(16000);
      state = advanceMaxOutputRetry('length', state); // 32000
      state = advanceMaxOutputRetry('length', state); // 64000
      state = advanceMaxOutputRetry('length', state); // should stop at 64000

      expect(state.shouldRetry).toBe(false);
      expect(state.currentMaxTokens).toBe(64000);
    });
  });
});
