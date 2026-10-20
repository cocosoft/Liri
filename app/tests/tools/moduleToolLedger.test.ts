/**
 * U-03（2026-10-19）：**模块工具全量注册台账**。
 *
 * 背景：`media_*` / `calendar:*` / `mail:send` / `office:*` 由**模块**在运行期注册
 * （`MediaModule` / `CalendarModule` / `MailModule` / `DocModule`），既不在
 * `TOOL_NAME_CONSTANTS`、也不在 `TOOL_EFFECTS`（唯一事实源只覆盖内建工具）
 * ⇒ 它们此前**没有任何台账**，新增/改名/命名漂移都无人看守。
 *
 * 本用例断言：
 * ① 模块**实际注册**的工具名集合与台账**逐一相等**（多一个/少一个都红）；
 * ② 台账内名字遵循命名约定（`media_*` 或 `<namespace>:<tool>`），例外须显式登记；
 * ③ 台账无重复项。
 *
 * 边界（如实）：`DocModule.onReady()` 会真实连接 MCP（`officecli`）且耗时十余秒，
 * 故 `office:*` 仅**文档登记**、不在用例中实例化断言；变更 `office:*` 时需人工同步本台账。
 */
import { describe, expect, it } from 'bun:test';
import { CalendarModule } from '../../src/modules/calendar/CalendarModule';
import { MailModule } from '../../src/modules/mail/MailModule';
import { globalToolManager } from '../../src/tools/core/ToolManager';
import { MediaModule } from '../../src/tools/media/MediaModule';

/** 模块工具台账（**运行期注册面**的事实记录，非声明表） */
const MODULE_TOOL_LEDGER = {
  media: [
    'media_delete',
    'media_deleteBatch',
    'media_image_adjust',
    'media_image_convert',
    'media_image_crop',
    'media_image_resize',
    'media_image_rotate',
    'media_image_watermark',
    'media_info',
    'media_pdf_extract',
    'media_qr_decode',
    'media_qr_generate',
    'media_video_compress',
    'media_video_extract_audio',
    'media_video_extract_thumbnail',
  ],
  calendar: [
    'calendar:add',
    'calendar:delete',
    'calendar:list',
    'calendar:update',
  ],
  mail: ['mail:send'],
  /** 仅文档登记：`DocModule` 在测试中不实例化（会连 MCP officecli） */
  doc: ['office:workflow', 'office:doc-pipeline'],
} as const;

/**
 * 命名约定例外：`media_deleteBatch` 违反 snake_case（应为 `media_delete_batch`）。
 * 改名会变更**模型可见的工具名**（影响已存提示词/历史调用），故暂列例外；
 * 若要归正，需按 CD05「先摘入口 → 再改实现」并同步提示词。
 */
const NAMING_EXCEPTIONS = new Set(['media_deleteBatch']);

/** 删除本用例注册进全局的工具，避免污染同进程的其他用例 */
function unregister(names: readonly string[]): void {
  for (const name of names) {
    globalToolManager.unregisterTool(name);
  }
}

async function collectRegistered(
  module: { onReady(): Promise<void> },
  run: () => Promise<void> = () => module.onReady()
): Promise<string[]> {
  const before = new Set(globalToolManager.getAllTools().map((t) => t.name));
  await run();
  const added = globalToolManager
    .getAllTools()
    .map((t) => t.name)
    .filter((n) => !before.has(n));
  unregister(added);
  return added.sort();
}

describe('模块工具注册台账（U-03）', () => {
  it('media 模块注册面与台账逐一相等', async () => {
    expect(await collectRegistered(new MediaModule())).toEqual(
      [...MODULE_TOOL_LEDGER.media].sort()
    );
  });

  it('calendar 模块注册面与台账逐一相等', async () => {
    expect(await collectRegistered(new CalendarModule())).toEqual(
      [...MODULE_TOOL_LEDGER.calendar].sort()
    );
  });

  it('mail 模块注册面与台账逐一相等', async () => {
    expect(await collectRegistered(new MailModule())).toEqual(
      [...MODULE_TOOL_LEDGER.mail].sort()
    );
  });

  it('台账名字遵循命名约定（例外须显式登记）', () => {
    const offenders: string[] = [];
    for (const names of Object.values(MODULE_TOOL_LEDGER)) {
      for (const name of names) {
        if (NAMING_EXCEPTIONS.has(name)) continue;
        const snakeMedia = /^media_[a-z0-9_]+$/.test(name);
        const namespaced = /^[a-z][a-z0-9-]*:[a-z0-9-]+$/.test(name);
        if (!snakeMedia && !namespaced) offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('台账无重复项', () => {
    const all = Object.values(MODULE_TOOL_LEDGER).flat();
    expect(all.length).toBe(new Set(all).size);
  });
});
