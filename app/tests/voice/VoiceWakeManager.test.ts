/**
 * VoiceWakeManager 单元测试
 * 覆盖唤醒词检测、配置持久化、触发器规范化
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { rmSync } from 'fs';

import {
  defaultVoiceWakeTriggers,
  sanitizeTriggers,
  loadVoiceWakeConfig,
  setVoiceWakeTriggers,
  detectWakeWord,
} from '../../src/voice/VoiceWakeManager.js';
import { resolvePyappHome } from '@modules/core/paths';

const CONFIG_PATH = join(resolvePyappHome(), 'settings', 'voicewake.json');

describe('defaultVoiceWakeTriggers', () => {

  it('返回默认唤醒词列表', () => {
    const triggers = defaultVoiceWakeTriggers();
    expect(Array.isArray(triggers)).toBe(true);
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers).toContain('pyapp');
  });

  it('每次调用返回新副本（不可变）', () => {
    const a = defaultVoiceWakeTriggers();
    const b = defaultVoiceWakeTriggers();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('sanitizeTriggers', () => {

  it('去除空格并转小写', () => {
    const result = sanitizeTriggers([' HELLO ', 'World ']);
    expect(result).toEqual(['hello', 'world']);
  });

  it('过滤空字符串', () => {
    const result = sanitizeTriggers(['hello', '', '  ']);
    expect(result).toEqual(['hello']);
  });

  it('全部空时返回默认值', () => {
    const result = sanitizeTriggers(['', '  ']);
    expect(result).toEqual(defaultVoiceWakeTriggers());
  });

  it('空数组返回默认值', () => {
    const result = sanitizeTriggers([]);
    expect(result).toEqual(defaultVoiceWakeTriggers());
  });
});

describe('loadVoiceWakeConfig', () => {

  beforeEach(async () => {
    if (existsSync(CONFIG_PATH)) {
      unlinkSync(CONFIG_PATH);
    }
  });

  it('配置文件不存在时返回默认配置', async () => {
    const config = await loadVoiceWakeConfig();
    expect(config.triggers).toEqual(defaultVoiceWakeTriggers());
    expect(config.updatedAtMs).toBe(0);
  });
});

describe('setVoiceWakeTriggers', () => {

  beforeEach(async () => {
    const dir = join(resolvePyappHome(), 'settings');
    if (existsSync(CONFIG_PATH)) {
      unlinkSync(CONFIG_PATH);
    } else if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(CONFIG_PATH)) {
      unlinkSync(CONFIG_PATH);
    }
  });

  it('保存并返回规范化后的触发词', async () => {
    const config = await setVoiceWakeTriggers(['Hello', '  World ']);
    expect(config.triggers).toEqual(['hello', 'world']);
    expect(config.updatedAtMs).toBeGreaterThan(0);
  });

  it('持久化到文件后可重新加载', async () => {
    await setVoiceWakeTriggers(['test']);
    const loaded = await loadVoiceWakeConfig();
    expect(loaded.triggers).toEqual(['test']);
    expect(loaded.updatedAtMs).toBeGreaterThan(0);
  });
});

describe('detectWakeWord', () => {

  it('空文本返回未检测到', async () => {
    const result = await detectWakeWord('');
    expect(result.detected).toBe(false);
    expect(result.matchedTrigger).toBeNull();
  });

  it('检测到默认唤醒词', async () => {
    const result = await detectWakeWord('pyapp what is the weather', ['pyapp']);
    expect(result.detected).toBe(true);
    expect(result.matchedTrigger).toBe('pyapp');
  });

  it('返回去除唤醒词后的剩余文本', async () => {
    const result = await detectWakeWord('hey assistant tell me a joke', ['assistant']);
    expect(result.detected).toBe(true);
    expect(result.remainingText).toBe('tell me a joke');
  });

  it('唤醒词位于文本开头', async () => {
    const result = await detectWakeWord('computer open file', ['computer']);
    expect(result.detected).toBe(true);
    expect(result.remainingText).toBe('open file');
  });

  it('唤醒词位于文本中间', async () => {
    const result = await detectWakeWord('please assistant help', ['assistant']);
    expect(result.detected).toBe(true);
    expect(result.remainingText).toBe('help');
  });

  it('不区分大小写', async () => {
    const result = await detectWakeWord('PyApp test', ['pyapp']);
    expect(result.detected).toBe(true);
  });

  it('优先匹配较长唤醒词', async () => {
    const result = await detectWakeWord('hey pyapp test', ['pyapp', 'hey pyapp']);
    expect(result.matchedTrigger).toBe('hey pyapp');
  });

  it('未匹配时返回未检测到', async () => {
    const result = await detectWakeWord('hello world', ['pyapp']);
    expect(result.detected).toBe(false);
    expect(result.matchedTrigger).toBeNull();
    expect(result.remainingText).toBeNull();
  });
});
