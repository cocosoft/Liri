/**
 * Memory frontmatter example for documentation.
 */
export const MEMORY_FRONTMATTER_EXAMPLE = [
  '---',
  'id: user_preferences',
  'name: User Preferences',
  "description: The user's preferred working style and tools",
  'type: user',
  'createdAt: 2023-01-01T00:00:00Z',
  'updatedAt: 2023-01-01T00:00:00Z',
  'tags: [preferences, workflow]',
  'priority: high',
  'expiresAt: 2024-01-01T00:00:00Z',
  'author: assistant',
  'source: conversation',
  '---',
];

/**
 * Trusting recall section for memory prompts.
 */
export const TRUSTING_RECALL_SECTION = [
  '## 关于记忆的可靠性',
  '',
  '你不可能记住所有细节，这很正常 —— 记忆系统的存在就是为了帮助你。',
  '若对某个细节不确定，宁可去检索信息或询问用户，也不要凭空编造。',
  '记忆不能替代对项目真实状态的核查（例如读取文件或运行命令）。',
  '可以把记忆当作向导，但在依此行动之前，务必核实重要细节。',
];

/**
 * Individual memory types section for memory prompts.
 */
export const TYPES_SECTION_INDIVIDUAL = [
  '## 记忆类型',
  '',
  '### 用户记忆（User）',
  '关于用户本人的信息：角色、偏好、沟通风格与目标。',
  '- 示例：“该用户是前端开发者，偏好 React 而非 Vue”',
  '- 示例：“该用户喜欢带代码示例的详细解释”',
  '- 示例：“该用户在这个项目上正赶一个很紧的截止日期”',
  '',
  '### 反馈记忆（Feedback）',
  '用户就你的表现或你所使用工具给出的反馈。',
  '- 示例：“该用户希望我不要对代码改动做总结”',
  '- 示例：“该用户认为我对 Promise 的解释很有帮助”',
  '- 示例：“该用户要求我在回复中多用表情符号”',
  '',
  '### 项目记忆（Project）',
  '无法从代码本身推导出的项目上下文。',
  '- 示例：“该项目使用某个需要 API key 的特定 API”',
  '- 示例：“团队遵循某个特定的分支策略”',
  '- 示例：“该第三方库存在一个已知问题”',
  '',
  '### 参考记忆（Reference）',
  '与项目相关的外部引用或资源。',
  '- 示例：“设计规范见 https://example.com/specs”',
  '- 示例：“API 文档见 https://api.example.com/docs”',
  '- 示例：“团队用 Jira 做项目管理：https://jira.example.com”',
];

/**
 * What not to save section for memory prompts.
 */
export const WHAT_NOT_TO_SAVE_SECTION = [
  '## 不应保存的内容',
  '',
  '不要保存符合以下任一情况的信息：',
  '- 可从代码库推导（如文件结构、函数名）',
  '- 临时的、仅与当前对话相关',
  '- 敏感的（如 API key、密码、个人信息）',
  '- 已在别处有良好文档记录',
  '- 会违反隐私或安全策略',
  '',
  '记忆用于跨多次对话仍然有用的、持久的、富含上下文的信息。',
];

/**
 * When to access section for memory prompts.
 */
export const WHEN_TO_ACCESS_SECTION = [
  '## 何时访问记忆',
  '',
  '你应当在以下时机访问记忆：',
  '- 与曾经交互过的用户开启新对话时',
  '- 用户问及可能存在于你记忆中的事情时',
  '- 你需要当前对话中并不直接可得的上下文时',
  '- 你希望与既往交互保持一致时',
  '',
  '并不是每次交互都需要访问记忆 —— 请自行判断哪些信息是相关的。',
];
