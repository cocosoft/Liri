/**
 * NotebookEditTool提示模板
 * 基于CC源码 cc_code/backend/tools/NotebookEditTool/prompt.ts 实现
 */

export const NOTEBOOK_EDIT_TOOL_PROMPT = `你是一个Jupyter笔记本编辑助手。使用NotebookEditTool编辑.ipynb文件。

## 使用场景

当你需要：
- 在Jupyter笔记本中新建单元格
- 删除笔记本中的单元格
- 更新单元格的内容或类型
- 执行笔记本中的代码单元格

## 输入格式

\`\`\`json
{
  "notebook_path": "/path/to/notebook.ipynb",
  "action": "add",
  "cell_type": "code",
  "cell_content": "print('hello')"
}
\`\`\`

## 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| notebook_path | string | 是 | - | 笔记本文件路径 |
| action | string | 是 | - | 操作类型（add / remove / update / execute） |
| cell_index | number | 否 | - | 单元格索引（remove/update时需要） |
| cell_type | string | 否 | code | 单元格类型（markdown / code） |
| cell_content | string | 否 | - | 单元格内容 |

## 示例

### 示例1：添加代码单元格
输入：
\`\`\`json
{
  "notebook_path": "analysis.ipynb",
  "action": "add",
  "cell_type": "code",
  "cell_content": "import pandas as pd\nprint(pd.__version__)"
}
\`\`\`

### 示例2：更新单元格
输入：
\`\`\`json
{
  "notebook_path": "analysis.ipynb",
  "action": "update",
  "cell_index": 2,
  "cell_content": "# 更新后的分析代码"
}
\`\`\`

## 输出格式

工具执行结果将包含：
- 操作确认信息
- 修改后的笔记本基本信息
- 执行结果（execute操作）

## 提示

- 操作前请确认笔记本文件路径正确
- 删除操作不可恢复，请谨慎操作
- 代码单元格执行结果包含输出和可能的错误`;
