/**
 * FewShotRegistry — Few-shot 示例管理系统
 *
 * P1-11: 对标 cc_code AgentTool/prompt.ts 287行结构化示例设计。
 * 为每个工具提供 3-5 个结构化示例（正常用例 + 边界条件 + 错误恢复）。
 *
 * 示例格式：
 *   - 工具名 + 使用场景
 *   - 输入参数
 *   - 预期行为 + 常见错误避免
 */

export interface ToolExample {
  /** 场景描述 */
  scenario: string;
  /** 输入参数 */
  input: Record<string, unknown>;
  /** 预期结果描述 */
  expectedBehavior: string;
  /** 常见错误 */
  commonMistakes: string[];
}

export interface FewShotEntry {
  toolName: string;
  /** 工具使用指南（注入到 tool description 中） */
  usageGuide: string;
  /** 结构化示例 */
  examples: ToolExample[];
  /** 该工具的 prompt.ts 注入文本 */
  getPrompt?: () => string;
}

// ============================================================
// P1-11: 预置核心工具示例
// ============================================================

export const BUILTIN_EXAMPLES: FewShotEntry[] = [
  {
    toolName: 'read_file',
    usageGuide:
      'Usage: Always use offset+limit for large files. Results use cat -n format with line numbers. Check file existence first. Always read a file before editing it.',
    examples: [
      {
        scenario: '读文件开头',
        input: { file_path: '/path/to/file.ts', offset: 1, limit: 50 },
        expectedBehavior: '返回 1-50 行，cat -n 格式',
        commonMistakes: ['不指定 limit 读整个大文件', '使用相对路径'],
      },
      {
        scenario: '读文件特定区域',
        input: { file_path: '/src/app.ts', offset: 100, limit: 30 },
        expectedBehavior: '返回 100-129 行',
        commonMistakes: ['offset 从 0 开始（应从 1 开始）'],
      },
      {
        scenario: '读图片文件',
        input: { file_path: '/path/to/screenshot.png' },
        expectedBehavior: '返回图片 base64 数据',
        commonMistakes: ['读取超大图片不指定压缩'],
      },
      {
        scenario: '读不存在的文件（错误恢复）',
        input: { file_path: '/nonexistent/file.txt' },
        expectedBehavior: '返回错误信息，提示文件不存在',
        commonMistakes: ['不检查文件是否存在就直接读', '不处理错误继续执行'],
      },
    ],
  },
  {
    toolName: 'write_file',
    usageGuide:
      'IMPORTANT: Must read existing file first. Prefer edit_file for modifications. NEVER create .md documentation unless explicitly requested. Parent directories must exist.',
    examples: [
      {
        scenario: '创建新文件',
        input: { file_path: '/path/to/new.ts', content: 'export const x = 1;' },
        expectedBehavior: '文件创建成功',
        commonMistakes: ['不先创建父目录', '写入前不读已有文件状态'],
      },
      {
        scenario: '覆盖已有文件',
        input: { file_path: '/src/config.ts', content: 'export default { port: 3000 };' },
        expectedBehavior: '文件被新内容覆盖',
        commonMistakes: ['未先 read_file 确认当前状态', '覆盖时丢失原有重要配置'],
      },
      {
        scenario: '写入超大文件（边缘情况）',
        input: { file_path: '/src/large.ts', content: '/* 10000+ 行代码 */' },
        expectedBehavior: '可能触发大小警告，建议拆分',
        commonMistakes: ['单次写入超长内容，应用 edit_file 分段修改'],
      },
    ],
  },
  {
    toolName: 'grep',
    usageGuide:
      'Use grep NOT shell grep/find. Supports regex with -i for case-insensitive. Use glob to filter by file pattern. Always use output_mode: "content" when you need to see matching lines.',
    examples: [
      {
        scenario: '搜索函数定义',
        input: { pattern: 'function\\s+handleLogin', path: '/src', glob: '*.ts' },
        expectedBehavior: '返回匹配行及上下文',
        commonMistakes: ['不使用 glob 过滤导致匹配过量', 'Pattern 忘记转义特殊字符'],
      },
      {
        scenario: '搜索接口实现（带上下文）',
        input: { pattern: 'implements IPlugin', path: '/src', output_mode: 'content', '-C': 3 },
        expectedBehavior: '返回匹配行及前后3行上下文',
        commonMistakes: ['忘记 -C 参数导致缺少关键上下文'],
      },
      {
        scenario: '大小写不敏感搜索',
        input: { pattern: 'apikey', path: '/src', '-i': true, glob: '*.ts' },
        expectedBehavior: '匹配 apiKey, APIKEY, apikey 等',
        commonMistakes: ['需要不区分大小写时忘记 -i 标志'],
      },
    ],
  },
  {
    toolName: 'bash',
    usageGuide:
      'Shell command execution. Use absolute paths. Check exit code. Prefer dedicated tools (grep/glob) over shell equivalents. Avoid destructive commands (rm -rf).',
    examples: [
      {
        scenario: '检查 git 状态',
        input: { command: 'git status --short', timeout: 10000 },
        expectedBehavior: '返回 git 变更列表',
        commonMistakes: ['使用 rm -rf（触发危险模式检测）', 'command 中包含分号串联多个命令'],
      },
      {
        scenario: '安装项目依赖',
        input: { command: 'bun install', timeout: 60000 },
        expectedBehavior: '依赖安装成功，返回安装日志',
        commonMistakes: ['不在项目根目录执行', '超时时间设置过短'],
      },
      {
        scenario: '运行测试并检查结果',
        input: { command: 'bun test 2>&1 | head -50', timeout: 30000 },
        expectedBehavior: '返回前50行测试输出',
        commonMistakes: ['不检查退出码就认为成功', '输出过长不截断'],
      },
    ],
  },
  {
    toolName: 'edit_file',
    usageGuide:
      'Exact string replacement. Prefer this over write_file for modifications. Only edit files you have read. old_string MUST be unique in the file. Use replace_all for mass replacements.',
    examples: [
      {
        scenario: '精确替换函数体',
        input: { file_path: '/src/app.ts', old_string: 'function foo() { return 1; }', new_string: 'function foo() { return 2; }' },
        expectedBehavior: '单处精确替换成功',
        commonMistakes: ['old_string 不唯一导致替换失败', '缩进不匹配导致匹配失败'],
      },
      {
        scenario: '重命名变量（全文件替换）',
        input: { file_path: '/src/utils.ts', old_string: 'oldVarName', new_string: 'newVarName', replace_all: true },
        expectedBehavior: '文件中所有 oldVarName 替换为 newVarName',
        commonMistakes: ['替换词太短导致误伤其他标识符', '替换注释中的同名文本'],
      },
      {
        scenario: '修复 import 路径',
        input: { file_path: '/src/index.ts', old_string: "from './old/path'", new_string: "from './new/path'" },
        expectedBehavior: 'import 语句路径更新',
        commonMistakes: ['转义字符差异导致匹配失败（双引号vs单引号）'],
      },
    ],
  },
  {
    toolName: 'glob',
    usageGuide:
      'Fast file pattern matching. Supports standard glob patterns like "**/*.ts" and "src/**/*.tsx". Returns matching file paths sorted by modification time. Prefer this over shell find.',
    examples: [
      {
        scenario: '查找所有 TypeScript 源文件',
        input: { pattern: 'src/**/*.ts' },
        expectedBehavior: '返回所有 .ts 文件路径列表',
        commonMistakes: ['路径分隔符混用 / 和 \\', '忘记 ** 递归子目录'],
      },
      {
        scenario: '查找测试文件',
        input: { pattern: '**/*.test.ts' },
        expectedBehavior: '返回所有测试文件',
        commonMistakes: ['pattern 不应以 / 开头', '大项目可能返回过多结果'],
      },
      {
        scenario: '限制搜索范围',
        input: { pattern: 'src/ai/**/*.ts', path: '/absolute/project/path' },
        expectedBehavior: '仅返回 ai 模块下文件',
        commonMistakes: ['不指定 path 导致从错误的根目录搜索'],
      },
    ],
  },
  {
    toolName: 'web_search',
    usageGuide:
      'Search the web for real-time information. Use for accessing data beyond AI knowledge cutoff. Always include Sources section with URLs in the response.',
    examples: [
      {
        scenario: '搜索最新技术文档',
        input: { query: 'React 19 new features 2026', num: 5 },
        expectedBehavior: '返回5条搜索结果，含标题和URL',
        commonMistakes: ['忘记指定年份导致获取过时信息', '查询词过于泛化'],
      },
      {
        scenario: '搜索错误解决方案',
        input: { query: 'TypeScript error TS2345 fix', num: 3 },
        expectedBehavior: '返回相关解决方案链接',
        commonMistakes: ['不引用搜索来源直接输出', '一次搜索后不验证就下结论'],
      },
      {
        scenario: '限定语言搜索',
        input: { query: 'Python asyncio best practices', num: 5, lr: 'lang_en' },
        expectedBehavior: '返回英文搜索结果',
        commonMistakes: ['需要英文结果时不指定 lr 参数'],
      },
    ],
  },
  {
    toolName: 'web_fetch',
    usageGuide:
      'Fetch and extract content from a URL. Returns readable markdown format. HTTP URLs are auto-upgraded to HTTPS. Results may be truncated for very large pages.',
    examples: [
      {
        scenario: '读取 API 文档页面',
        input: { url: 'https://platform.openai.com/docs/api-reference/chat' },
        expectedBehavior: '返回 markdown 格式的文档内容',
        commonMistakes: ['抓取需登录的页面（返回空）', 'URL 包含认证参数'],
      },
      {
        scenario: '读取 GitHub 仓库 README',
        input: { url: 'https://github.com/user/repo#readme' },
        expectedBehavior: '返回 README 正文内容',
        commonMistakes: ['抓取大文件页面（可能截断）', 'URL 后不带 #readme 锚点'],
      },
      {
        scenario: '抓取错误页面（边缘情况）',
        input: { url: 'https://example.com/404-page' },
        expectedBehavior: '返回 404 页面内容或错误信息',
        commonMistakes: ['不检查返回内容是否有效就使用', '对认证页面重试多次'],
      },
    ],
  },
  {
    toolName: 'todo_write',
    usageGuide:
      'Create and manage structured task lists. Use for complex tasks with 3+ distinct steps. Mark tasks complete IMMEDIATELY after finishing. Only ONE task in_progress at a time.',
    examples: [
      {
        scenario: '创建多步骤任务计划',
        input: { todos: [{ id: '1', content: '分析错误根因', status: 'in_progress', priority: 'high' }, { id: '2', content: '修复代码', status: 'pending', priority: 'high' }], merge: false },
        expectedBehavior: '创建新任务列表，前端显示两个任务',
        commonMistakes: ['简单任务不需要 todo', 'merge=false 覆盖了已有任务'],
      },
      {
        scenario: '标记任务完成并更新进度',
        input: { todos: [{ id: '1', status: 'completed', summary: '根因：空指针异常' }], merge: true },
        expectedBehavior: '任务1标记完成，任务2自动变为in_progress',
        commonMistakes: ['完成任务后不写 summary', '多个任务同时标记 in_progress'],
      },
      {
        scenario: '增量添加新任务',
        input: { todos: [{ id: '3', content: '编写单元测试', status: 'pending', priority: 'medium' }], merge: true },
        expectedBehavior: '新任务追加到已有列表',
        commonMistakes: ['merge: true 时 id 与已有任务冲突'],
      },
    ],
  },
  {
    toolName: 'ask_user_question',
    usageGuide:
      'Ask the user clarifying questions when you need input on implementation choices or ambiguous requirements. Use multiSelect for multi-choice questions. Show options with clear labels and descriptions.',
    examples: [
      {
        scenario: '确认技术方案选择',
        input: { questions: [{ question: '使用哪个状态管理库？', header: '状态管理', options: [{ label: 'Zustand (推荐)', description: '轻量、与 React 18 配合最佳' }, { label: 'Redux Toolkit', description: '功能完整、生态丰富' }], multiSelect: false }] },
        expectedBehavior: '前端显示单选问题，用户选择后继续',
        commonMistakes: ['选项太多无法区分', '问题表述不清无法回答'],
      },
      {
        scenario: '多选确认功能需求',
        input: { questions: [{ question: '需要支持哪些数据库？', header: '数据库', options: [{ label: 'SQLite', description: '本地嵌入式数据库' }, { label: 'PostgreSQL', description: '服务器级关系型数据库' }, { label: 'MongoDB', description: '文档型 NoSQL' }], multiSelect: true }] },
        expectedBehavior: '用户可多选数据库类型',
        commonMistakes: ['应该单选却设为 multiSelect', '选项没有 description 导致用户不解其意'],
      },
      {
        scenario: '边界条件：不需要提问时',
        input: { /* 无调用 — 当需求明确时不应使用此工具 */ },
        expectedBehavior: '明确需求不调用 ask_user_question',
        commonMistakes: ['过度使用导致用户烦躁', '无选项或选项少于2个'],
      },
    ],
  },
];

/**
 * P1-11: 为工具生成 prompt 注入文本
 */
export function renderFewShotPrompt(entry: FewShotEntry): string {
  const lines: string[] = [`## ${entry.toolName}`, '', entry.usageGuide];
  if (entry.examples.length > 0) {
    lines.push('', '### Examples');
    for (const ex of entry.examples) {
      lines.push(`- **${ex.scenario}**: ${ex.expectedBehavior}`);
      if (ex.commonMistakes.length > 0) {
        lines.push(`  - Avoid: ${ex.commonMistakes.join('; ')}`);
      }
    }
  }
  return lines.join('\n');
}

/** P1-11: 按工具名查找示例 */
export function findFewShotEntry(toolName: string): FewShotEntry | undefined {
  return BUILTIN_EXAMPLES.find((e) => e.toolName === toolName);
}

/** P1-11: 获取所有已注册的示例工具名称 */
export function getFewShotToolNames(): string[] {
  return BUILTIN_EXAMPLES.map((e) => e.toolName);
}
