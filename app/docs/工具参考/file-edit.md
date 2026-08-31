# FileEditTool - 文件编辑工具

## 描述

对文件进行精确编辑，支持搜索替换功能。相比 file_write，FileEditTool 更适合修改现有文件的部分内容。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `file_path` | string | 是 | 要编辑的文件路径 |
| `old_string` | string | 是 | 要搜索的原始内容 |
| `new_string` | string | 是 | 替换后的内容 |
| `replace_all` | boolean | 否 | 是否替换所有匹配项（默认 false） |

## 使用示例

```javascript
// 替换文件中的文本
FileEditTool({
  file_path: "./src/config.ts",
  old_string: "port: 3000",
  new_string: "port: 8080"
})

// 添加新的导入语句
FileEditTool({
  file_path: "./src/index.ts",
  old_string: "import { App } from './app';",
  new_string: "import { App } from './app';\nimport { Logger } from './logger';"
})
```

## 匹配规则

- 精确匹配，区分大小写
- 只替换第一个匹配项
- 建议包含上下文行以确保唯一匹配

## 注意事项

- 不支持正则表达式匹配
- 多次编辑相同的文件请注意上下文变化
- **路径语义（G3，2026-08-31）**：绝对路径直接使用；相对路径优先解析到会话工作目录（cwd，含 worktree 隔离目录），无 cwd 时回退 `~/.pyapp/output/`。
- **read-before-edit（B1，2026-08-31 新增）**：在主对话循环（TAORLoop）中，编辑已存在的文件前必须先用 read_file 读取该文件；若文件自上次读取后被外部修改，编辑会被拒绝并要求重新读取——防止基于过期内容修改。新文件（首次创建）不受此限制。
