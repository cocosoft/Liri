# FileEditTool - 文件编辑工具

## 描述

对文件进行精确编辑，支持搜索替换功能。相比 file_write，FileEditTool 更适合修改现有文件的部分内容。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `file_path` | string | 是 | 要编辑的文件路径 |
| `old_str` | string | 是 | 要搜索的原始内容 |
| `new_str` | string | 是 | 替换后的内容 |

## 使用示例

```javascript
// 替换文件中的文本
FileEditTool({
  file_path: "./src/config.ts",
  old_str: "port: 3000",
  new_str: "port: 8080"
})

// 添加新的导入语句
FileEditTool({
  file_path: "./src/index.ts",
  old_str: "import { App } from './app';",
  new_str: "import { App } from './app';\nimport { Logger } from './logger';"
})
```

## 匹配规则

- 精确匹配，区分大小写
- 只替换第一个匹配项
- 建议包含上下文行以确保唯一匹配

## 注意事项

- 编辑前会自动备份原文件
- 不支持正则表达式匹配
- 多次编辑相同的文件请注意上下文变化
