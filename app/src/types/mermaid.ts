/**
 * 2026-10-01 B11 前置 P1（D-223）—— `MermaidLintIssue` 下沉类型中心（infra → core）。
 *
 * 动机：`session/types/eventPayloads.ts` 引 `@modules/utils/mermaidLint`(infra) ⇒ 该契约文件
 * 若改走「下沉 `types/`」（B11 方案甲）会变成 `core -> infra`（更差）。把此**零出向依赖**
 * 的问题项接口下沉 core，可使 `eventPayloads.ts` 成为**纯 core 引用**的契约文件。
 *
 * 原址（`utils/mermaidLint.ts`）保留**再导出** ⇒ `@modules/utils/mermaidLint` 既有消费方
 * （`session/types/eventPayloads.ts` · `chat/ReActToolLoop.ts` 等）零改动；
 * 依 R05-013 口径「再导出不计入类型中心冲突」。
 */

export interface MermaidLintIssue {
  /** 第几个 mermaid 块（从 0 起；文本中有多块时用于定位） */
  blockIndex: number;
  /** 该块起始行号（1 起，便于日志定位） */
  line: number;
  /** 判为问题的原因（中文、不含技术黑话，可直接回喂给模型） */
  reason: string;
}
