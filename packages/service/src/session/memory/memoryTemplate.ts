// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Session Memory 模板
 *
 * 对标 BA_REF sessionMemory.md，存储 AI 从对话中提炼的记忆。
 * 提炼 Agent 只能编辑此文件，不能调用其他工具。
 */

export const MEMORY_TEMPLATE = `# Session Memory

> 自动提炼于 {{lastExtraction}}

## Discussions
<!-- 讨论过的关键议题 -->

## Decisions
<!-- 做出的关键决策 -->

## File Changes
<!-- 修改过的文件及变更描述 -->

## Code References
<!-- 提及的重要代码段 / 函数 / 模块 -->

## Open Questions
<!-- 尚未解决的问题 -->
`;

/**
 * 从记忆文件内容解析为结构化数据
 */
export function parseMemoryContent(content: string): {
  discussions: string[];
  decisions: string[];
  fileChanges: string[];
  codeReferences: string[];
  openQuestions: string[];
} {
  const section = (heading: string): string[] => {
    const regex = new RegExp(`## ${heading}[\\s\\S]*?(?=## |$)`, 'i');
    const match = content.match(regex);
    if (!match) return [];
    return match[0]
      .split('\n')
      .filter((l) => l.startsWith('- ') || l.match(/^\d+\./))
      .map((l) => l.replace(/^[-*\d.]+\s*/, '').trim())
      .filter(Boolean);
  };

  return {
    discussions: section('Discussions'),
    decisions: section('Decisions'),
    fileChanges: section('File Changes'),
    codeReferences: section('Code References'),
    openQuestions: section('Open Questions'),
  };
}
