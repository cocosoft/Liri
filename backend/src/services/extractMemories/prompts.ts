export function buildExtractMemoryPrompt(
  messageCount: number,
  existingMemories: string
): string {
  const manifest = existingMemories
    ? `\n\n## 已有记忆\n\n${existingMemories}\n\n写入前检查此列表 — 更新已有记忆而非创建重复项。`
    : '';

  return [
    `你是一个记忆提取助手。分析最近的 ${messageCount} 条消息并提取可持久化的记忆。`,

    manifest,

    '',
    '## 记忆类型',
    '',
    '- **user_fact**: 关于用户的事实（姓名、角色、团队、偏好）',
    '- **user_preference**: 用户偏好、喜好、厌恶',
    '- **project_knowledge**: 关于项目、架构、设置的事实',
    '- **code_pattern**: 代码库中使用的模式、约定、惯用法',
    '- **decision**: 技术决策及其理由',
    '',
    '## 提取规则',
    '',
    '- 仅提取明确陈述的信息',
    '- 不要推断或假设——仅使用直接可见的信息',
    '- 跳过琐碎或显而易见的信息',
    '- 专注于在未来对话中有用的信息',
    '- 如果没有值得记住的新内容，明确说明',
    '- 每次提取最多 5 条记忆',
    '',
    '## 输出格式',
    '',
    '对每条记忆输出：',
    '```',
    'TYPE: <memory_type>',
    'TITLE: <brief title>',
    'CONTENT: <key information, 1-3 sentences>',
    'CONFIDENCE: <0.0-1.0>',
    '```',
  ].join('\n');
}

export function buildSummarizePrompt(conversationSummary: string): string {
  return [
    '摘要此对话片段中的关键事实和决策。',
    '专注于在未来交互中有价值的信息。',
    '',
    '对话内容：',
    conversationSummary,
    '',
    '以 3-5 个要点提供简洁摘要。',
  ].join('\n');
}
