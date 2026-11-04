/**
 * 工具**能力包**：默认开 + 按任务类别裁剪（2026-11-05 重定；原为"默认不披露"）
 *
 * 契约：
 * - 包**默认开** ⇒ 包内工具是否下发**只由任务类别白名单**决定（媒体类仍不在
 *   `default`/`chat`/`coding` 白名单 ⇒ 默认仍不可见）；
 * - 显式 `FEATURE_TOOL_PACK_*=false` ⇒ 回到旧口径：四个通用任务面**一律不下发**；
 * - **不是删除 / 不是注销**：本文件只断言"下发面"，注册面与执行面不受影响；
 * - `extraCategories`（带图消息的 `image`、会话 profile 的 `media`）是显式能力声明 ⇒ 命中即放开（包关也放开）；
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
  it('每个包的开关都存在且默认开（2026-11-05 重定）', () => {
    for (const pack of PACK_IDS) {
      const flag = CAPABILITY_PACKS[pack].flag;
      expect(FEATURE_FLAGS[flag]).toBe(true);
      expect(isCapabilityPackEnabled(pack)).toBe(true);
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

describe('能力包：默认开 ⇒ 可见性由类别白名单决定', () => {
  it('默认（包开）⇒ 类别白名单内的包工具可见（抽样 coding / agent）', () => {
    // 实测集合（2026-11-05 包全开时 filterToolsByTask 的结果）：
    // coding +9、agent +14；这里只钉住几类代表，避免把白名单/披露预算整表抄一遍。
    for (const name of ['cron', 'worktree', 'clipboard']) {
      expect(keptNames([name], 'coding')).toContain(name);
    }
    for (const name of ['sessions_yield', 'save_conversation', 'agents_list']) {
      expect(keptNames([name], 'agent')).toContain(name);
    }
  });

  it('媒体类在 default/chat 仍不可见（类别白名单兜住 ⇒ 不增加这部分 token）', () => {
    for (const name of CAPABILITY_PACKS.media_image.tools) {
      expect(keptNames([name], 'chat')).not.toContain(name);
    }
    for (const name of CAPABILITY_PACKS.media_video.tools) {
      expect(keptNames([name], 'default')).not.toContain(name);
    }
  });

  it('显式关（FEATURE_TOOL_PACK_*=false）⇒ 灰度回退到"通用任务面一律不下发"', () => {
    for (const pack of PACK_IDS) {
      const tools = CAPABILITY_PACKS[pack].tools;
      process.env[`FEATURE_${CAPABILITY_PACKS[pack].flag}`] = 'false';
      try {
        expect(isCapabilityPackEnabled(pack)).toBe(false);
        for (const taskType of [
          'default',
          'chat',
          'coding',
          'agent',
        ] as const) {
          for (const name of tools) {
            expect(keptNames([name], taskType)).not.toContain(name);
          }
        }
        expect(isToolInDisabledCapabilityPack(tools[0]!)).toBe(true);
      } finally {
        delete process.env[`FEATURE_${CAPABILITY_PACKS[pack].flag}`];
      }
    }
  });

  it('包关不影响**非通用任务面**（`video` / `tts` 任务仍拿得到本族工具）', () => {
    process.env['FEATURE_TOOL_PACK_MEDIA_VIDEO'] = 'false';
    process.env['FEATURE_TOOL_PACK_MEDIA_AUDIO'] = 'false';
    process.env['FEATURE_TOOL_PACK_MEDIA_IMAGE'] = 'false';
    try {
      expect(keptNames(['video'], 'video')).toContain('video');
      expect(keptNames(['tts'], 'tts')).toContain('tts');
      expect(keptNames(['image_analysis'], 'image')).toContain(
        'image_analysis'
      );
    } finally {
      delete process.env['FEATURE_TOOL_PACK_MEDIA_VIDEO'];
      delete process.env['FEATURE_TOOL_PACK_MEDIA_AUDIO'];
      delete process.env['FEATURE_TOOL_PACK_MEDIA_IMAGE'];
    }
  });

  it('`extraCategories` 是显式能力声明 ⇒ 包关也放开（带图消息 / profile）', () => {
    process.env['FEATURE_TOOL_PACK_MEDIA_IMAGE'] = 'false';
    process.env['FEATURE_TOOL_PACK_MEDIA_VIDEO'] = 'false';
    try {
      // 带图消息：`hasImages` ⇒ extraCategories 含 'image'
      expect(keptNames(['image_analysis'], 'default', ['image'])).toContain(
        'image_analysis'
      );
      // 会话 profile 声明 media ⇒ 含 'video'
      expect(keptNames(['video_analysis'], 'coding', ['video'])).toContain(
        'video_analysis'
      );
    } finally {
      delete process.env['FEATURE_TOOL_PACK_MEDIA_IMAGE'];
      delete process.env['FEATURE_TOOL_PACK_MEDIA_VIDEO'];
    }
  });
});

describe('能力包：与 getRealToolNamesForTask 同判据', () => {
  it('默认（包开）⇒ 名字清单含包内工具；显式关 ⇒ 不含', () => {
    // `clipboard` 类别 assist 在 coding 白名单内 ⇒ 开/关的差异可被观测到
    const name = 'clipboard';
    expect(getCapabilityPackOf(name)).toBe('system_extra');
    expect(getRealToolNamesForTask('coding')).toContain(name);

    process.env['FEATURE_TOOL_PACK_SYSTEM_EXTRA'] = 'false';
    try {
      expect(getRealToolNamesForTask('coding')).not.toContain(name);
    } finally {
      delete process.env['FEATURE_TOOL_PACK_SYSTEM_EXTRA'];
    }
  });
});
