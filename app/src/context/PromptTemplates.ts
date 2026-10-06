/**
 * 系统提示词构建结果类型（遵循规则K：品牌使用Liri，不使用Anthropic/CLAUDE）
 *
 * B 类复核（2026-10-07）：原 `buildBasePrompt` / `buildUserContext` / `buildSystemContext`
 * 三个已废弃（deprecated）的模板函数（功能已迁移至 systemPromptSections +
 * `PromptAssembler.assembleSystemPrompt()`）经全仓 grep **零消费者**（仅桶再导出）
 * ⇒ 已删除；本文件仅保留仍被 `query/queryContext.ts` 消费的 `SystemPromptParts`。
 */

export interface SystemPromptParts {
  basePrompt: string[];
  userContext: Record<string, string>;
  systemContext: Record<string, string>;
}
