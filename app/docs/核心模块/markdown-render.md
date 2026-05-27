# Markdown 渲染 - Markdown 渲染引擎

## 概述

Markdown 渲染引擎负责将 Markdown 文本渲染为格式化的终端输出，支持代码高亮、表格渲染和链接处理。

## 基本用法

```typescript
import { renderMarkdownWithMarkers } from "./core/markdown/render.js";

// 渲染 Markdown
const output = renderMarkdownWithMarkers("# Hello\nThis is **bold** text");
console.log(output);
```

## 支持的特性

| 特性 | 说明 |
|------|------|
| 标题 | # ~ ###### |
| 粗体/斜体 | **bold**, *italic* |
| 代码块 | ```language ... ``` |
| 行内代码 | `code` |
| 列表 | 有序和无序列表 |
| 表格 | 表格渲染 |
| 链接 | [text](url) |
| 图片 | ![alt](src) |
| 引用 | > blockquote |
| 分割线 | --- |
| 任务列表 | - [x] done |

## 代码高亮

渲染引擎自动识别代码块并应用 ANSI 高亮，支持 TypeScript、JavaScript、Python、Rust 等多种语言。

## 渲染选项

```typescript
import { renderMarkdownWithMarkers } from "./core/markdown/render.js";

const output = renderMarkdownWithMarkers(markdownContent, {
  maxWidth: 80,          // 最大行宽
  sanitize: true,        // 安全过滤
  linkify: true,         // 自动链接
  breaks: true           // 换行
});
```

## ANSI 转义

渲染引擎输出 ANSI 转义码，在支持 ANSI 的终端中显示彩色文本。
