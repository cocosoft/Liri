// MIT License
// Copyright (c) 2026 190615273@qq.com

// P2-16: 平台提示测试
import { describe, it, expect } from 'bun:test';
import {
  getChannelPrompt,
  getAllChannelPrompts,
  renderChannelPrompt,
  registerChannelPrompt,
} from '../../src/channels/platform/ChannelPromptTemplates';

describe('ChannelPromptTemplates', () => {
  describe('getChannelPrompt', () => {
    it('returns SMS prompt', () => {
      const p = getChannelPrompt('sms');
      expect(p).not.toBeNull();
      expect(p!.maxLength).toBe(160);
      expect(p!.markdownSupported).toBe(false);
      expect(p!.formatRules).toContain('SMS');
    });

    it('returns LINE prompt', () => {
      const p = getChannelPrompt('line');
      expect(p).not.toBeNull();
      expect(p!.maxLength).toBe(5000);
      expect(p!.markdownSupported).toBe(true);
      expect(p!.formatRules).toContain('LINE');
    });

    it('returns IRC prompt', () => {
      const p = getChannelPrompt('irc');
      expect(p).not.toBeNull();
      expect(p!.maxLength).toBe(400);
      expect(p!.markdownSupported).toBe(false);
      expect(p!.formatRules).toContain('IRC');
    });

    it('returns null for unknown channel', () => {
      expect(getChannelPrompt('unknown_channel')).toBeNull();
    });
  });

  describe('getAllChannelPrompts', () => {
    it('contains sms, line, irc', () => {
      const all = getAllChannelPrompts();
      expect(all.sms).toBeDefined();
      expect(all.line).toBeDefined();
      expect(all.irc).toBeDefined();
    });
  });

  describe('renderChannelPrompt', () => {
    it('renders SMS prompt with format rules', () => {
      const result = renderChannelPrompt('sms');
      expect(result).not.toBeNull();
      expect(result).toContain('短信');
      expect(result).toContain('160');
    });

    it('renders LINE prompt with Markdown support info', () => {
      const result = renderChannelPrompt('line');
      expect(result).toContain('LINE');
      expect(result).toContain('Markdown 支持：是');
    });

    it('renders IRC prompt with plain text rules', () => {
      const result = renderChannelPrompt('irc');
      expect(result).toContain('IRC');
      expect(result).toContain('Markdown 支持：否');
    });

    it('returns null for unknown channel', () => {
      expect(renderChannelPrompt('unknown')).toBeNull();
    });
  });

  describe('registerChannelPrompt', () => {
    it('registers new channel prompt', () => {
      registerChannelPrompt({
        channelId: 'test_chan',
        maxLength: 100,
        markdownSupported: true,
        formatRules: 'test rules',
      });
      const p = getChannelPrompt('test_chan');
      expect(p).not.toBeNull();
      expect(p!.maxLength).toBe(100);
    });
  });
});
