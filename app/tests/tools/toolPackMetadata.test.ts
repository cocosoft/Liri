/**
 * 能力包**元数据**守卫（C1，2026-11-21；治理方案 v3 §14.2 / §14.6）
 *
 * 与 `toolCapabilityPacks.test.ts` 的分工：
 * - 那份文件断言**下发行为**（包开/关 × 任务类别）；
 * - 本文件只断言**元数据自洽**（`defaultIn` / `requires` / `risk` / 工具归属），
 *   供 C2 的 profile 选择器与设置页分组消费，不涉及运行时可见面。
 */
import { describe, expect, it } from 'bun:test';

import {
  CAPABILITY_PACKS,
  TOOL_CATEGORIES,
  type CapabilityPack,
  type ToolPackProfile,
} from '../../src/tools/toolCategories';
import { FEATURE_FLAGS } from '@openliri/kernel';

const PACK_IDS = Object.keys(CAPABILITY_PACKS) as CapabilityPack[];
const PROFILES: readonly ToolPackProfile[] = ['minimal', 'standard', 'full'];
const RISKS = ['high', 'write', 'read'] as const;

describe('能力包元数据：C1 口径', () => {
  it('每个包都有非空且合法的 defaultIn（只允许 minimal / standard / full）', () => {
    for (const pack of PACK_IDS) {
      const { defaultIn } = CAPABILITY_PACKS[pack];
      expect(defaultIn.length).toBeGreaterThan(0);
      for (const profile of defaultIn) {
        expect(PROFILES).toContain(profile);
      }
      // 去重：重复项会让"该包是否属于某 profile"的判定产生歧义
      expect(new Set(defaultIn).size).toBe(defaultIn.length);
    }
  });

  it('现有 8 包保持 standard + full（不改现状可见面）', () => {
    const legacy: CapabilityPack[] = [
      'media_image',
      'media_video',
      'media_audio',
      'doc_extra',
      'collab',
      'schedule',
      'workspace',
      'system_extra',
    ];
    for (const pack of legacy) {
      expect([...CAPABILITY_PACKS[pack].defaultIn].sort()).toEqual([
        'full',
        'standard',
      ]);
    }
  });

  it('新增包只在 full（`web` 例外：其工具本就是默认披露面成员）', () => {
    for (const pack of ['desktop', 'knowledge', 'code'] as const) {
      expect([...CAPABILITY_PACKS[pack].defaultIn]).toEqual(['full']);
    }
    expect([...CAPABILITY_PACKS.web.defaultIn].sort()).toEqual([
      'full',
      'standard',
    ]);
  });

  it('risk 取值合法；开关存在（且默认开 ⇒ 零行为变更）', () => {
    for (const pack of PACK_IDS) {
      expect(RISKS).toContain(CAPABILITY_PACKS[pack].risk);
      expect(FEATURE_FLAGS[CAPABILITY_PACKS[pack].flag]).toBe(true);
    }
  });

  it('platform 若声明必须是当前运行时可识别的平台字符串', () => {
    const known = new Set([
      'aix',
      'android',
      'darwin',
      'freebsd',
      'haiku',
      'linux',
      'openbsd',
      'sunos',
      'win32',
      'cygwin',
      'netbsd',
    ]);
    for (const pack of PACK_IDS) {
      const platform = CAPABILITY_PACKS[pack].platform;
      if (platform !== undefined) expect(known.has(platform)).toBe(true);
    }
  });

  it('requires 只指向存在的包，且无环（含自依赖）', () => {
    const visiting = new Set<CapabilityPack>();
    const done = new Set<CapabilityPack>();

    const visit = (pack: CapabilityPack, path: CapabilityPack[]): void => {
      if (done.has(pack)) return;
      expect(path).not.toContain(pack); // 环 ⇒ 直接失败并打印路径
      visiting.add(pack);
      for (const dep of CAPABILITY_PACKS[pack].requires ?? []) {
        expect(PACK_IDS).toContain(dep);
        visit(dep, [...path, pack]);
      }
      visiting.delete(pack);
      done.add(pack);
    };

    for (const pack of PACK_IDS) visit(pack, []);
    expect(visiting.size).toBe(0);
  });

  it('一工具一包（重复归属会让首个包静默胜出）', () => {
    const owner = new Map<string, CapabilityPack>();
    for (const pack of PACK_IDS) {
      for (const name of CAPABILITY_PACKS[pack].tools) {
        const prev = owner.get(name);
        expect(
          prev === undefined ? null : `${name}: ${prev}/${pack}`
        ).toBeNull();
        owner.set(name, pack);
      }
    }
  });

  it('包内工具名必须存在于「内置名 ∪ 运行期登记名」（TOOL_CATEGORIES 即两者并集）', () => {
    const known = new Set(Object.keys(TOOL_CATEGORIES));
    const missing: string[] = [];
    for (const pack of PACK_IDS) {
      for (const name of CAPABILITY_PACKS[pack].tools) {
        if (!known.has(name)) missing.push(`${name}（${pack}）`);
      }
    }
    expect(missing).toEqual([]);
  });
});
