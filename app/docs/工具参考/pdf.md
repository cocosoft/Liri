# PDF - PDF 生成工具

> **P4b（2026-10-16）更新**：本文件此前与实现**不一致**（写的是 `file` + `operation: read/metadata/pages`
> 三操作，实现里并不存在）—— 现按 `app/src/tools/PDFTool/PDFTool.ts` 的真实契约重写。

## 描述

从文本内容生成 PDF，或把一个本地文件（md/html/txt/docx 等）直接转成 PDF。

**仅支持生成**：读取既有 PDF 请用 `file_read`（PDF 会自动转 Markdown）或 `media_pdf_extract`
（抽取文本/页面）。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `action` | string | 是 | `generate`（生成）· `extract` · `info`（后两者**本构建不可用**，见下） |
| `title` | string | 否 | PDF 标题（generate 用） |
| `content` | string | 否 | 内联正文（仅适合小正文） |
| `content_file` | string | 否 | **首选**：把已有本地文件（md/html/txt/docx）作为 PDF 正文来源——0 输出 token、无截断风险 |
| `filename` | string | 否 | 输出文件名（generate 用） |
| `filepath` | string | 否 | 既有 PDF 路径（extract/info 用） |

## 使用示例

```javascript
// 生成 PDF：正文来自磁盘上的文件（推荐）
PDF({
  action: "generate",
  title: "季度报告",
  content_file: "./report.md",
  filename: "quarterly-report.pdf"
})
```

## 返回值

成功时返回产物路径与页数等信息；产物落在**全局输出目录**（`~/.pyapp/output/`），
不属于任何项目、不会登记到「作品/成果」面板。若该 PDF 须归入某项目的交付物，
请改用 `write_project_file` 写入该项目 `output/`。

## 边界（如实）

- `extract` / `info` 依赖 `pdf-parse`，**本构建未安装** ⇒ 调用会 **fail-closed** 返回明确错误
  （不再返回占位文本/`unknown` 这类"假成功"），并提示改用 `media_pdf_extract` / `file_read`。
- 手写 PDF 语法实现，适合**简单文本布局**；复杂版式请用 `doc_generate`（docx/xlsx/pptx/html）。
