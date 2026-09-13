/**
 * safeSkillId 单测（S3-1）
 *
 * 覆盖 validateSkillId 的路径穿越 / 分隔符 / 绝对路径 / Windows 保留名 / 非法字符
 * 与 sanitizeSkillId 清洗行为，作为技能文件操作入口统一校验的 CI 回归防护。
 */

import { describe, it, expect } from 'bun:test';
import { validateSkillId, sanitizeSkillId } from '../safeSkillId';

describe('validateSkillId', () => {
  it('放行正常技能 ID', () => {
    expect(validateSkillId('my-skill')).toBeNull();
    expect(validateSkillId('my_skill_123')).toBeNull();
    expect(validateSkillId('SKILL')).toBeNull();
    expect(validateSkillId('hello.world')).toBeNull();
  });

  it('拦截空值与空白', () => {
    expect(validateSkillId('')).not.toBeNull();
    expect(validateSkillId('   ')).not.toBeNull();
    expect(validateSkillId(' padded ')).not.toBeNull();
  });

  it('拦截路径穿越 ..（含连续 .. 变体）', () => {
    expect(validateSkillId('..')).not.toBeNull();
    expect(validateSkillId('../victim')).not.toBeNull();
    expect(validateSkillId('..%2Fvictim')).not.toBeNull();
    expect(validateSkillId('a/../b')).not.toBeNull();
  });

  it('拦截分隔符与绝对路径', () => {
    expect(validateSkillId('a/b')).not.toBeNull();
    expect(validateSkillId('a\\b')).not.toBeNull();
    expect(validateSkillId('/etc/passwd')).not.toBeNull();
    expect(validateSkillId('C:\\Windows')).not.toBeNull();
    expect(validateSkillId('C:/Windows')).not.toBeNull();
  });

  it('拦截 Windows 保留设备名（含扩展名变体）', () => {
    expect(validateSkillId('CON')).not.toBeNull();
    expect(validateSkillId('NUL.txt')).not.toBeNull();
    expect(validateSkillId('com1')).not.toBeNull();
    expect(validateSkillId('LPT9')).not.toBeNull();
  });

  it('拦截非法字符', () => {
    expect(validateSkillId('a?b')).not.toBeNull();
    expect(validateSkillId('a*b')).not.toBeNull();
    expect(validateSkillId('a:b')).not.toBeNull();
    expect(validateSkillId('a|b')).not.toBeNull();
    expect(validateSkillId('a\x00b')).not.toBeNull();
  });
});

describe('sanitizeSkillId', () => {
  it('非法字符替换为下划线', () => {
    expect(sanitizeSkillId('a/b\\c')).toBe('a_b_c');
    expect(sanitizeSkillId('a:b')).toBe('a_b');
  });

  it('去除前导点号', () => {
    expect(sanitizeSkillId('..evil')).toBe('evil');
    expect(sanitizeSkillId('.hidden')).toBe('hidden');
  });
});
