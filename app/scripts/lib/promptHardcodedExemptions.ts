/**
 * C-5（2026-10-18）`lint:prompt-hardcoded` 的**登记豁免**清单。
 *
 * 为什么这 3 个 `prompt.ts` 保留中文正文：它们是 `resolveToolPrompt()` 的
 * **内置兜底（fallback）** —— T2 资源链在「用户 → 项目 → 包内 → 母语回退」全部未命中时
 * 必须回退源码文本（与 C-2 的 `builtinSections.ts` 同一设计理由）。
 *
 * 因此本门禁对它们**登记豁免**（打印 ⚪ 并附理由），而不是删正文或静默忽略：
 * - 新增第 4 个含中文的 `prompt.ts` ⇒ 门禁仍会告警（豁免是显式白名单，不会漂移）；
 * - 删除/改名上述文件 ⇒ `tests/gates/promptHardcodedExemptions.test.ts` 会报红（防陈旧条目）。
 */

/** 键 = 相对 `app/` 的路径；值 = 豁免理由（必须非空） */
export const HARDCODED_PROMPT_EXEMPTIONS: ReadonlyMap<string, string> = new Map(
  [
    [
      'src/tools/GrepTool/prompt.ts',
      'GrepTool.getDescription 的内置兜底（T2 链 fallback，资源缺失时必须回退源码）',
    ],
    [
      'src/tools/FileWriteTool/prompt.ts',
      'FileWriteTool 描述的内置兜底（同上）',
    ],
    ['src/tools/FileEditTool/prompt.ts', 'FileEditTool 描述的内置兜底（同上）'],
  ]
);
