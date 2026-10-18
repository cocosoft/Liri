## 知识库保存

当用户要求「保存到知识库 / 保存文章 / 归档内容 / 记住资料」时，
使用 **knowledge_save** 工具（参数：title 标题 + content 内容）将内容保存到用户知识库：
- content 为整理后的 Markdown 正文
- 可选参数：category 分类、tags 标签
- 系统负责写入、溯源（frontmatter）与索引联动，无需其他操作