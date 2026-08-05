/**
 * BaseThirdPartyAdapter 单元测试（v1.5 阶段 1）
 * 覆盖：searchSkills 过滤透传、updateSkill 原子替换/失败回滚、getSearchEngine 返回结构
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { BaseThirdPartyAdapter } from '../../src/skills/loaders/adapter/BaseThirdPartyAdapter';
import type {
  InstalledThirdPartySkill,
  ThirdPartySkillMeta,
} from '../../src/skills/loaders/adapter/types';
import type {
  ThirdPartySkillSearchResult,
} from '../../src/skills/loaders/adapter/ThirdPartySkillAdapter';
import type { Skill } from '../../src/skills/types';
import { SkillSource, SkillLoadMethod } from '../../src/skills/types';

/** 假适配器：可控 doInstall 结果/错误、记录远程调用 */
class FakeAdapter extends BaseThirdPartyAdapter<InstalledThirdPartySkill> {
  readonly name = 'fake';
  readonly displayName = 'Fake 市场';

  remoteCalls: Array<{ query: string; opts?: unknown }> = [];
  doInstallError: Error | null = null;

  protected toSkill(internal: InstalledThirdPartySkill): Skill {
    return {
      name: internal.meta.name,
      description: internal.meta.description,
      source: SkillSource.THIRD_PARTY,
      loadMethod: SkillLoadMethod.ADAPTER,
      loadedFrom: this.name,
      impl: { kind: 'executable', execute: async () => undefined },
    };
  }

  protected toSearchResult(
    internal: InstalledThirdPartySkill
  ): ThirdPartySkillSearchResult {
    return {
      id: internal.meta.id,
      name: internal.meta.name,
      version: internal.meta.version,
      description: internal.meta.description,
      author: internal.meta.author,
      category: internal.meta.category,
      tags: internal.meta.tags,
      installed: internal.enabled,
    };
  }

  protected async doInstall(
    skillId: string,
    sourceUrl?: string,
    targetPath?: string
  ): Promise<InstalledThirdPartySkill> {
    if (this.doInstallError) throw this.doInstallError;
    const installPath = targetPath || this.localStore.getSkillInstallPath(skillId);
    mkdirSync(installPath, { recursive: true });
    writeFileSync(join(installPath, 'SKILL.md'), '# New Version', 'utf-8');
    const meta: ThirdPartySkillMeta = {
      id: skillId,
      name: 'fake-skill',
      version: '2.0.0',
      description: 'new desc',
      author: 'tester',
    };
    return {
      meta,
      installPath,
      installedAt: Date.now(),
      updatedAt: Date.now(),
      enabled: true,
      files: ['SKILL.md'],
      sourceUrl: sourceUrl || '',
    };
  }

  protected async doUninstall(skill: InstalledThirdPartySkill): Promise<void> {}

  protected async doSearchRemote(
    query: string,
    opts?: { category?: string; tags?: string[]; source?: string }
  ): Promise<ThirdPartySkillSearchResult[]> {
    this.remoteCalls.push({ query, opts });
    return [
      {
        id: 'remote-1',
        name: 'remote-skill',
        version: '1.0.0',
        description: '',
        author: '',
        installed: false,
      },
    ];
  }
}

function makeInstalled(
  id: string,
  overrides: Partial<InstalledThirdPartySkill> = {}
): InstalledThirdPartySkill {
  return {
    meta: {
      id,
      name: id,
      version: '1.0.0',
      description: `desc of ${id}`,
      author: 'tester',
    },
    installPath: '/unused',
    installedAt: Date.now(),
    updatedAt: Date.now(),
    enabled: true,
    files: [],
    ...overrides,
  };
}

describe('BaseThirdPartyAdapter（阶段 1）', () => {
  let dir: string;
  let adapter: FakeAdapter;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'skill-adapter-test-'));
    adapter = new FakeAdapter(dir);
    await adapter.initialize();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('searchSkills 过滤条件透传到远程（P2-1/P2-6）', async () => {
    await adapter.searchSkills('foo', { category: 'dev', tags: ['ts'] });

    expect(adapter.remoteCalls).toHaveLength(1);
    expect(adapter.remoteCalls[0].query).toBe('foo');
    expect(adapter.remoteCalls[0].opts).toEqual({
      category: 'dev',
      tags: ['ts'],
    });
  });

  it('searchSkills 本地过滤生效（P2-7：searchLocal 收到 options）', async () => {
    await adapter.localStore.addSkill(
      makeInstalled('local-1', {
        installPath: join(dir, 'local-1'),
        meta: { id: 'local-1', name: 'local-one', version: '1.0.0', description: 'a', author: 't' },
      })
    );

    // 指定其他 category → 本地结果被过滤，只剩远程
    const results = await adapter.searchSkills('', { category: 'nonexistent' });
    const localNames = results.filter((r) => r.id === 'local-1');
    expect(localNames).toHaveLength(0);
  });

  it('getSearchEngine 返回引擎且 searchRemote 含 skill 包装（P0-2）', async () => {
    const engine = adapter.getSearchEngine();
    expect(engine).toBeDefined();
    // 同一实例缓存
    expect(adapter.getSearchEngine()).toBe(engine);

    const results = await engine.searchRemote('');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('skill.id');
    expect(results[0]).toHaveProperty('source', 'remote');
  });

  it('getSearchEngine 源管理：添加/列出/移除，且仅 https', () => {
    const engine = adapter.getSearchEngine();

    expect(() => engine.addCustomSource('hub', 'http://insecure.example.com')).toThrow(
      /https/
    );
    engine.addCustomSource('hub', 'https://hub.example.com');
    expect(engine.getSourceNames()).toContain('hub');

    engine.removeCustomSource('hub');
    expect(engine.getSourceNames()).not.toContain('hub');
  });

  it('updateSkill 存在且成功时原子替换并更新索引（P0-1）', async () => {
    // 预置已安装技能（正式目录含旧内容）
    const installPath = join(dir, 'real-skill');
    mkdirSync(installPath, { recursive: true });
    writeFileSync(join(installPath, 'SKILL.md'), '# Old Version', 'utf-8');
    await adapter.localStore.addSkill(
      makeInstalled('real-skill', { installPath, sourceUrl: 'https://hub.example.com/real-skill' })
    );

    const updated = await adapter.updateSkill('real-skill');
    expect(updated).not.toBeNull();

    // 索引更新为新版本
    const indexed = await adapter.localStore.getSkill('real-skill');
    expect(indexed?.meta.version).toBe('2.0.0');
    // 正式目录内容为新版本
    expect(readFileSync(join(installPath, 'SKILL.md'), 'utf-8')).toBe('# New Version');
    // 无 .tmp/.bak 残留
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp') || f.includes('.bak'));
    expect(leftovers).toEqual([]);
  });

  it('updateSkill 失败时回滚保留旧版本（P3-10）', async () => {
    const installPath = join(dir, 'real-skill');
    mkdirSync(installPath, { recursive: true });
    writeFileSync(join(installPath, 'SKILL.md'), '# Old Version', 'utf-8');
    await adapter.localStore.addSkill(
      makeInstalled('real-skill', { installPath, sourceUrl: 'https://hub.example.com/real-skill' })
    );

    adapter.doInstallError = new Error('下载失败');
    const updated = await adapter.updateSkill('real-skill');
    expect(updated).toBeNull();

    // 正式目录仍为旧内容
    expect(existsSync(installPath)).toBe(true);
    expect(readFileSync(join(installPath, 'SKILL.md'), 'utf-8')).toBe('# Old Version');
  });
});
