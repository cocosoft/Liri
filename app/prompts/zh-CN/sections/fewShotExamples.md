## 工具使用示例

以下为正确工具调用的示例，用于引导你的行为：

## read_file

Usage: Always use offset+limit for large files. Results use cat -n format with line numbers. Check file existence first. Always read a file before editing it.

### Examples
- **读文件开头**: 返回 1-50 行，cat -n 格式
  - Avoid: 不指定 limit 读整个大文件; 使用相对路径
- **读文件特定区域**: 返回 100-129 行
  - Avoid: offset 从 0 开始（应从 1 开始）
- **读图片文件**: 返回图片 base64 数据
  - Avoid: 读取超大图片不指定压缩
- **读不存在的文件（错误恢复）**: 返回错误信息，提示文件不存在
  - Avoid: 不检查文件是否存在就直接读; 不处理错误继续执行
## write_file

IMPORTANT: Must read existing file first. Prefer edit_file for modifications. NEVER create .md documentation unless explicitly requested. Parent directories must exist.

### Examples
- **创建新文件**: 文件创建成功
  - Avoid: 不先创建父目录; 写入前不读已有文件状态
- **覆盖已有文件**: 文件被新内容覆盖
  - Avoid: 未先 read_file 确认当前状态; 覆盖时丢失原有重要配置
- **写入超大文件（边缘情况）**: 可能触发大小警告，建议拆分
  - Avoid: 单次写入超长内容，应用 edit_file 分段修改
## grep

Use grep NOT shell grep/find. Supports regex with -i for case-insensitive. Use glob to filter by file pattern. Always use output_mode: "content" when you need to see matching lines.

### Examples
- **搜索函数定义**: 返回匹配行及上下文
  - Avoid: 不使用 glob 过滤导致匹配过量; Pattern 忘记转义特殊字符
- **搜索接口实现（带上下文）**: 返回匹配行及前后3行上下文
  - Avoid: 忘记 -C 参数导致缺少关键上下文
- **大小写不敏感搜索**: 匹配 apiKey, APIKEY, apikey 等
  - Avoid: 需要不区分大小写时忘记 -i 标志
## bash

Shell command execution. Use absolute paths. Check exit code. Prefer dedicated tools (grep/glob) over shell equivalents. Avoid destructive commands (rm -rf).

### Examples
- **检查 git 状态**: 返回 git 变更列表
  - Avoid: 使用 rm -rf（触发危险模式检测）; command 中包含分号串联多个命令
- **安装项目依赖**: 依赖安装成功，返回安装日志
  - Avoid: 不在项目根目录执行; 超时时间设置过短
- **运行测试并检查结果**: 返回前50行测试输出
  - Avoid: 不检查退出码就认为成功; 输出过长不截断
## edit_file

Exact string replacement. Prefer this over write_file for modifications. Only edit files you have read. old_string MUST be unique in the file. Use replace_all for mass replacements.

### Examples
- **精确替换函数体**: 单处精确替换成功
  - Avoid: old_string 不唯一导致替换失败; 缩进不匹配导致匹配失败
- **重命名变量（全文件替换）**: 文件中所有 oldVarName 替换为 newVarName
  - Avoid: 替换词太短导致误伤其他标识符; 替换注释中的同名文本
- **修复 import 路径**: import 语句路径更新
  - Avoid: 转义字符差异导致匹配失败（双引号vs单引号）
## glob

Fast file pattern matching. Supports standard glob patterns like "**/*.ts" and "src/**/*.tsx". Returns matching file paths sorted by modification time. Prefer this over shell find.

### Examples
- **查找所有 TypeScript 源文件**: 返回所有 .ts 文件路径列表
  - Avoid: 路径分隔符混用 / 和 \; 忘记 ** 递归子目录
- **查找测试文件**: 返回所有测试文件
  - Avoid: pattern 不应以 / 开头; 大项目可能返回过多结果
- **限制搜索范围**: 仅返回 ai 模块下文件
  - Avoid: 不指定 path 导致从错误的根目录搜索
## web_search

Search the web for real-time information. Use for accessing data beyond AI knowledge cutoff. Always include Sources section with URLs in the response.

### Examples
- **搜索最新技术文档**: 返回5条搜索结果，含标题和URL
  - Avoid: 忘记指定年份导致获取过时信息; 查询词过于泛化
- **搜索错误解决方案**: 返回相关解决方案链接
  - Avoid: 不引用搜索来源直接输出; 一次搜索后不验证就下结论
- **限定语言搜索**: 返回英文搜索结果
  - Avoid: 需要英文结果时不指定 lr 参数
## web_fetch

Fetch and extract content from a URL. Returns readable markdown format. HTTP URLs are auto-upgraded to HTTPS. Results may be truncated for very large pages.

### Examples
- **读取 API 文档页面**: 返回 markdown 格式的文档内容
  - Avoid: 抓取需登录的页面（返回空）; URL 包含认证参数
- **读取 GitHub 仓库 README**: 返回 README 正文内容
  - Avoid: 抓取大文件页面（可能截断）; URL 后不带 #readme 锚点
- **抓取错误页面（边缘情况）**: 返回 404 页面内容或错误信息
  - Avoid: 不检查返回内容是否有效就使用; 对认证页面重试多次
## todo_write

Create and manage structured task lists. Use for complex tasks with 3+ distinct steps. Mark tasks complete IMMEDIATELY after finishing. Only ONE task in_progress at a time.

### Examples
- **创建多步骤任务计划**: 创建新任务列表，前端显示两个任务
  - Avoid: 简单任务不需要 todo; merge=false 覆盖了已有任务
- **标记任务完成并更新进度**: 任务1标记完成，任务2自动变为in_progress
  - Avoid: 完成任务后不写 summary; 多个任务同时标记 in_progress
- **增量添加新任务**: 新任务追加到已有列表
  - Avoid: merge: true 时 id 与已有任务冲突
## ask_user_question

Ask the user clarifying questions when you need input on implementation choices or ambiguous requirements. Use multiSelect for multi-choice questions. Show options with clear labels and descriptions.

### Examples
- **确认技术方案选择**: 前端显示单选问题，用户选择后继续
  - Avoid: 选项太多无法区分; 问题表述不清无法回答
- **多选确认功能需求**: 用户可多选数据库类型
  - Avoid: 应该单选却设为 multiSelect; 选项没有 description 导致用户不解其意
- **边界条件：不需要提问时**: 明确需求不调用 ask_user_question
  - Avoid: 过度使用导致用户烦躁; 无选项或选项少于2个