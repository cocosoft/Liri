/**
 * 技能安全模块测试（v1.5 阶段 4）
 * 覆盖：safeSkillId 白名单、SkillPermission 权限模型、SkillSearchEngine SSRF 校验、安装大小校验
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { validateSkillId, sanitizeSkillId } from '../../src/skills/loaders/adapter/safeSkillId';
import {
  parseSkillPermissions,
  validateSkillPermissions,
  hasSensitivePermission,
  SKILL_PERMISSIONS,
} from '../../src/skills/loaders/adapter/SkillPermission';
import { SkillSearchEngine } from '../../src/skills/loaders/adapter/SkillSearchEngine';
import type { SearchEngineAdapter } from '../../src/skills/loaders/adapter/SkillSearchEngine';
import type { ThirdPartySkillSearchResult } from '../../src/skills/loaders/adapter/ThirdPartySkillAdapter';

/** 最小假适配器 */
function makeAdapter(dir: string): SearchEngineAdapter {
  return {
    async searchSkills(
      _query: string
    ): Promise<ThirdPartySkillSearchResult[]> {
      return [];
    },
    getLocalStore() {
      return { getSkillsPath: () => dir };
    },
  };
}

describe('safeSkillId', () => {
  it('拒绝路径穿越/分隔符/绝对路径', () => {
    expect(validateSkillId('../evil')).not.toBeNull();
    expect(validateSkillId('a/b')).not.toBeNull();
    expect(validateSkillId('a\\b')).not.toBeNull();
    expect(validateSkillId('C:/evil')).not.toBeNull();
    expect(validateSkillId('/abs')).not.toBeNull();
    expect(validateSkillId('')).not.toBeNull();
  });

  it('拒绝 Windows 非法字符与保留名', () => {
    expect(validateSkillId('a:b')).not.toBeNull();
    expect(validateSkillId('a?b')).not.toBeNull();
    expect(validateSkillId('CON')).not.toBeNull();
    expect(validateSkillId('nul.txt')).not.toBeNull();
    expect(validateSkillId('LPT1')).not.toBeNull();
  });

  it('合法 ID 通过', () => {
    expect(validateSkillId('my-skill')).toBeNull();
    expect(validateSkillId('github_owner_repo')).toBeNull();
    expect(validateSkillId('技能-01')).toBeNull();
  });

  it('sanitizeSkillId 清洗非法字符', () => {
    expect(sanitizeSkillId('a/b:c')).toBe('a_b_c');
    expect(sanitizeSkillId('normal-name')).toBe('normal-name');
  });
});

describe('SkillPermission', () => {
  it('解析 SKILL.md frontmatter 中的 permissions', () => {
    const md = [
      '---',
      'name: demo',
      'permissions: [network, command, unknown-x]',
      'version: 1.0.0',
      '---',
      'body',
    ].join('\n');
    const perms = parseSkillPermissions(md);
    expect(perms).toContain('network');
    expect(perms).toContain('command');
    expect(perms).not.toContain('unknown-x'); // 未知项过滤
  });

  it('无 frontmatter 或无 permissions 返回空', () => {
    expect(parseSkillPermissions('# no fm')).toEqual([]);
    expect(parseSkillPermissions('---\nname: x\n---\n')).toEqual([]);
  });

  it('validateSkillPermissions 校验合法性', () => {
    expect(validateSkillPermissions(['network'])).toBeNull();
    expect(validateSkillPermissions(['hack'])).not.toBeNull();
    expect(validateSkillPermissions('network' as unknown as unknown[])).not.toBeNull();
  });

  it('敏感权限检测', () => {
    expect(hasSensitivePermission(['network'])).toBe(false);
    expect(hasSensitivePermission(['command'])).toBe(true);
    expect(hasSensitivePermission(SKILL_PERMISSIONS as never[])).toBe(true);
  });
});

describe('SkillSearchEngine SSRF（阶段 4）', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skill-ssrf-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('拒绝 http 与非内网 https 之外的地址', () => {
    const engine = new SkillSearchEngine(makeAdapter(dir));
    expect(() => engine.addCustomSource('bad', 'http://example.com')).toThrow(/https/);
    expect(() => engine.addCustomSource('bad', 'ftp://example.com')).toThrow(/https/);
  });

  it('拒绝内网/回环段', () => {
    const engine = new SkillSearchEngine(makeAdapter(dir));
    expect(() => engine.addCustomSource('i1', 'https://localhost:8080')).toThrow(/内网|回环/);
    expect(() => engine.addCustomSource('i2', 'https://127.0.0.1/api')).toThrow(/内网|回环/);
    expect(() => engine.addCustomSource('i3', 'https://192.168.1.1/api')).toThrow(/内网|回环/);
    expect(() => engine.addCustomSource('i4', 'https://10.0.0.1/api')).toThrow(/内网|回环/);
    expect(() => engine.addCustomSource('i5', 'https://172.16.0.1/api')).toThrow(/内网|回环/);
  });

  it('接受公网 https 并持久化', () => {
    const engine = new SkillSearchEngine(makeAdapter(dir));
    engine.addCustomSource('ok', 'https://hub.example.com/v1');
    expect(engine.getSourceNames()).toContain('ok');
  });

  it('源持久化：重启后仍存在', () => {
    const engine = new SkillSearchEngine(makeAdapter(dir));
    engine.addCustomSource('ok', 'https://hub.example.com/v1');

    const engine2 = new SkillSearchEngine(makeAdapter(dir));
    expect(engine2.getSourceNames()).toContain('ok');
  });
});
