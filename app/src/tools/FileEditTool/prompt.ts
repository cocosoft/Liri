/**
 * FileEdit工具提示模板
 */

export const FILE_EDIT_TOOL_NAME = 'file_edit';

export function getEditToolDescription(): string {
  return 'Edit file content using SearchReplace pattern';
}

export const FILE_EDIT_TOOL_PROMPT = `你是一个文件编辑助手，使用SearchReplace模式修改文件内容。

## 使用场景

当你需要：
- 修改已存在文件的部分内容
- 更新代码中的特定函数或方法
- 修改配置文件
- 修复代码中的bug
- 更新文档内容

## 使用限制

1. **文件大小限制**：最大支持1 GiB
2. **唯一性要求**：oldString必须在文件中唯一出现
3. **文件必须存在**：无法创建新文件（请使用FileWrite工具）

## 输入格式

\`\`\`
{
  "filePath": "/path/to/file",
  "oldString": "要替换的文本",
  "newString": "新文本"
}
\`\`\`

## 注意事项

### 关于oldString的选择

1. **必须唯一**：确保oldString在文件中只出现一次
2. **上下文足够**：包含足够的上下文以确保唯一性
3. **格式精确**：保留原始缩进和空格

### 示例

#### 示例1：修改函数实现
输入：
\`\`\`json
{
  "filePath": "./src/utils.ts",
  "oldString": "function add(a: number, b: number): number {\n  return a + b;\n}",
  "newString": "function add(a: number, b: number): number {\n  console.log('Adding:', a, b);\n  return a + b;\n}"
}
\`\`\`

#### 示例2：更新配置值
输入：
\`\`\`json
{
  "filePath": "./config/app.config",
  "oldString": "timeout: 30000",
  "newString": "timeout: 60000"
}
\`\`\`

#### 示例3：修复bug
输入：
\`\`\`json
{
  "filePath": "./src/handler.ts",
  "oldString": "if (status === 'success') {",
  "newString": "if (status === 'completed') {"
}
\`\`\`

#### 示例4：添加新方法
输入：
\`\`\`json
{
  "filePath": "./src/service.ts",
  "oldString": "class UserService {\n  async getUser(id: string) {",
  "newString": "class UserService {\n  async createUser(data: UserData) {\n    return this.db.insert(data);\n  }\n\n  async getUser(id: string) {"
}
\`\`\`

## 输出格式

工具执行结果将包含：
- filePath：修改后的文件路径
- linesChanged：行数变化
- replaced：是否成功替换
- oldStringFound：是否找到oldString

## 常见问题处理

### 问题1：oldString不唯一
**错误信息**："old_string is not unique in file"

**解决方案**：
- 添加更多上下文
- 包含前后几行代码
- 使用更精确的匹配

### 问题2：oldString未找到
**错误信息**："oldStringFound: false"

**解决方案**：
- 检查文件路径是否正确
- 检查字符串是否完全匹配（包括空格和缩进）
- 确保文件编码正确

### 问题3：文件不存在
**错误信息**："File not found"

**解决方案**：
- 使用FileWrite工具创建新文件
- 或检查路径是否正确

## 提示

- 修改前建议先使用FileRead工具查看文件内容
- 复杂修改建议分步执行
- 修改前请确认目标文件
- 重要文件建议先备份`;
