/**
 * P0-2（2026-10-30）：工具**能力包** —— 可选能力默认不披露
 *
 * 契约：
 * - 包默认**关** ⇒ 包内工具在 `default` / `chat` / `coding` / `agent` 面**不下发**；
 * - 包**开**（`FEATURE_TOOL_PACK_*=true`）⇒ 与改造前逐字一致；
 * - **不是删除 / 不是注销**：本文件只断言"下发面"，注册面与执行面不受影响；
 * - `extraCategories`（带图消息的 `image`、会话 profile 的 `media`）是显式能力声明 ⇒ 命中即放开；
 * - 非通用任务面（`image` / `video` / `tts` …）不套用本门控（其类别白名单本身就是声明）；
 * - `getRealToolNamesForTask` 与 `filterToolsByTask` **同判据**（不得形成第二套口径）；
 * - 恒保留集（`getMandatoryTools()`）与能力包**无交集**（否则会被"包关"静默吃掉）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import {
  CAPABILITY_PACKS,
  PACK_GATED_TASK_TYPES,
  filterToolsByTask,
  getCapabilityPackOf,
  getMandatoryTools,
  getRealToolNamesForTask,
  getTaskToolCategories,
  getToolCategory,
  isCapabilityPackEnabled,
  isToolInDisabledCapabilityPack,
  type CapabilityPack,
} from '../../src/tools/toolCategories';
import { FEATURE_FLAGS } from '@openliri/kernel';

const PACK_IDS = Object.keys(CAPABILITY_PACKS) as CapabilityPack[];
const PACK_ENV_KEYS = PACK_IDS.map(
  (p) => `FEATURE_${CAPABILITY_PACKS[p].flag}`
);

afterEach(() => {
  for (const key of PACK_ENV_KEYS) delete process.env[key];
});

/** 某任务面下保留的（假）定义名 —— 直接用包内工具名构造，避免依赖真实装配 */
function keptNames(
  names: readonly string[],
  taskType: string | undefined,
  extraCategories: Parameters<typeof filterToolsByTask>[2] = []
): string[] {
  return filterToolsByTask(
    names.map((name) => ({ name })),
    taskType,
    extraCategories
  ).map((t) => t.name);
}

describe('能力包：映射表自洽', () => {
  it('每个包的开关都存在且默认关', () => {
    for (const pack of PACK_IDS) {
      const flag = CAPABILITY_PACKS[pack].flag;
      expect(FEATURE_FLAGS[flag]).toBe(false);
      expect(isCapabilityPackEnabled(pack)).toBe(false);
    }
  });

  it('工具名不跨包重复（一工具一包）', () => {
    const seen = new Map<string, CapabilityPack>();
    const duplicated: string[] = [];
    for (const pack of PACK_IDS) {
      for (const name of CAPABILITY_PACKS[pack].tools) {
        const prev = seen.get(name);
        if (prev) duplicated.push(`${name}: ${prev}/${pack}`);
        seen.set(name, pack);
        expect(getCapabilityPackOf(name)).toBe(pack);
      }
    }
    expect(duplicated).toEqual([]);
  });

  it('包内工具均已登记类别且不是 misc（不得因未登记而被静默裁剪）', () => {
    for (const pack of PACK_IDS) {
      for (const name of CAPABILITY_PACKS[pack].tools) {
        expect(getToolCategory(name)).not.toBe('misc');
      }
    }
  });

  it('恒保留集与能力包无交集（mandatory 不受包关影响）', () => {
    for (const name of getMandatoryTools()) {
      expect(getCapabilityPackOf(name)).toBeUndefined();
    }
  });

  it('通用任务面清单非空（避免门控面写错导致"三个点都生效"）', () => {
    expect([...PACK_GATED_TASK_TYPES].sort()).toEqual([
      'agent',
      'chat',
      'coding',
      'default',
    ]);
  });
});

describe('能力包：默认不披露', () => {
  it('包关 ⇒ 四个通用任务面都裁掉包内工具', () => {
    for (const pack of PACK_IDS) {
      const tools = CAPABILITY_PACKS[pack].tools;
      for (const taskType of ['default', 'chat', 'coding', 'agent'] as const) {
        for (const name of tools) {
          expect(keptNames([name], taskType)).not.toContain(name);
        }
      }
      // `undefined` 等价 `default`
      expect(keptNames([tools[0]!], undefined)).not.toContain(tools[0]!);
      expect(isToolInDisabledCapabilityPack(tools[0]!)).toBe(true);
    }
  });

  it('包开 ⇒ 不再被本层裁掉（是否可见只剩类别白名单说了算）', () => {
    const allowed = new Set(getTaskToolCategories('coding'));
    for (const pack of PACK_IDS) {
      process.env[`FEATURE_${CAPABILITY_PACKS[pack].flag}`] = 'true';
      try {
        expect(isCapabilityPackEnabled(pack)).toBe(true);
        for (const name of CAPABILITY_PACKS[pack].tools) {
          // 等价判定：包开后该工具的可见性 = 其类别是否在 coding 白名单内
          //（如媒体类本就不在 coding 白名单 ⇒ 包开也不可见，这与改造前一致）
          expect(keptNames([name], 'coding').includes(name)).toBe(
            allowed.has(getToolCategory(name))
          );
        }
      } finally {
        delete process.env[`FEATURE_${CAPABILITY_PACKS[pack].flag}`];
      }
    }
  });

  it('包关不影响**非通用任务面**（`video` / `tts` 任务仍拿得到本族工具）', () => {
    expect(keptNames(['video'], 'video')).toContain('video');
    expect(keptNames(['tts'], 'tts')).toContain('tts');
    expect(keptNames(['image_analysis'], 'image')).toContain('image_analysis');
  });

  it('`extraCategories` 是显式能力声明 ⇒ 命中即放开（带图消息 / profile）', () => {
    // 带图消息：`hasImages` ⇒ extraCategories 含 'image'
    expect(keptNames(['image_analysis'], 'default', ['image'])).toContain(
      'image_analysis'
    );
    // 会话 profile 声明 media ⇒ 含 'video'
    expect(keptNames(['video_analysis'], 'coding', ['video'])).toContain(
      'video_analysis'
    );
  });
});

describe('能力包：与 getRealToolNamesForTask 同判据', () => {
  it('包关 ⇒ 名字清单里同样没有包内工具；包开 ⇒ 恢复', () => {
    // `clipboard` 类别 assist 在 coding 白名单内 ⇒ 包关/包开的差异可被观测到
    const name = 'clipboard';
    expect(getCapabilityPackOf(name)).toBe('system_extra');
    expect(getRealToolNamesForTask('coding')).not.toContain(name);

    process.env['FEATURE_TOOL_PACK_SYSTEM_EXTRA'] = 'true';
    try {
      expect(getRealToolNamesForTask('coding')).toContain(name);
    } finally {
      delete process.env['FEATURE_TOOL_PACK_SYSTEM_EXTRA'];
    }
  });
});
