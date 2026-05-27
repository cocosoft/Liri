/**
 * Session Memory 提示词模板
 */

export const DEFAULT_SESSION_MEMORY_TEMPLATE = `
# 会话标题
_简短且独特的 5-10 字描述性标题。信息密度高，无填充内容_

# 当前状态
_当前正在积极进行的工作是什么？尚未完成的待办任务。紧接着的下一步是什么。_

# 任务说明
_用户要求构建什么？有任何设计决策或其他解释性上下文吗？_

# 文件与函数
_重要文件有哪些？简要说明它们包含什么以及为什么相关？_

# 工作流程
_通常按什么顺序运行哪些 bash 命令？如果输出不直观，如何解释？_

# 错误与更正
_遇到的错误以及如何修复的。用户纠正了什么？哪些方法失败且不应再尝试？_

# 代码库与系统文档
_重要的系统组件有哪些？它们如何工作/配合？_

# 经验总结
_什么方法有效？什么无效？应避免什么？不要与其他部分重复_

# 关键成果
_如果用户要求了特定的输出（如问题答案、表格或其他文档），在此处记录确切结果_

# 工作日志
_逐步记录了尝试了什么、做了什么。每个步骤非常简洁的摘要_
`;

export function getDefaultUpdatePrompt(): string {
  return `重要提示：此消息及以下指令并非实际用户对话的一部分。不要在笔记内容中包含任何关于"记笔记"、"会话笔记提取"或这些更新指令的提及。

基于上述用户对话（排除本条笔记指令消息、系统提示、PY_APP.md 条目以及任何历史会话摘要），更新会话笔记文件。

文件 {{notesPath}} 已被读取。以下是其当前内容：
<current_notes_content>
{{currentNotes}}
</current_notes_content>

<update_instructions>
1. 使用对话中的新信息更新现有段落
2. 如重要新主题需要，添加新段落
3. 保持条目简洁、信息密集
4. 移除或更新任何过时信息
5. 不要修改仍然准确的段落
6. 保留原有的 markdown 结构

重要指南：
- 极其简洁——每个词都应承载信息
- 关注事实、决策和结果——而非过程
- 使用用户使用的相同术语
- 文件路径尽量使用绝对路径
- 列出 bash 命令时，包含使用的确切参数
</update_instructions>`;
}

export function buildSessionMemoryUpdatePrompt(
  notesPath: string,
  currentNotes: string
): string {
  return getDefaultUpdatePrompt()
    .replace('{{notesPath}}', notesPath)
    .replace('{{currentNotes}}', currentNotes);
}

export function loadSessionMemoryTemplate(): string {
  return DEFAULT_SESSION_MEMORY_TEMPLATE;
}
