// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * AI 回复气泡导出工具（单条消息）
 *
 * 支持三种格式：
 * - Markdown：原样字符串（getFullContent 产出即 markdown）
 * - HTML：轻量 md→html 转换器（零新依赖，覆盖标题/粗体/斜体/行内代码/代码块/
 *   列表/表格/引用/链接）+ 内联基础样式
 * - Word：把生成的 HTML 包进 Word 兼容壳（application/msword，Word/WPS 可直接打开）
 *
 * 下载/文件名消毒复用 SessionHistorySidebar/SessionHeader 的既有模式（M10 修复）。
 */

import { createLogger } from "@/utils/logger";
import katex from "katex";
import "katex/contrib/mhchem";
import katexCssRaw from "katex/dist/katex.min.css?raw";

const logger = createLogger("utils:exportMessage");

/**
 * KaTeX CSS（?raw 内联到导出文档 head）：
 * 字体相对路径替换为 CDN 绝对路径——导出 HTML 在线打开时字体完整加载；
 * 离线打开时布局规则齐全、字体回退但仍可读。
 */
const KATEX_CSS = katexCssRaw.replace(
  /url\(fonts\//g,
  "url(https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/fonts/",
);

/** M10 修复：文件名消毒——Windows 非法字符 \ / : * ? " < > | 会导致下载失败 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "export";
}

/** M10 修复：触发 blob 下载并延迟 revokeObjectURL——
 * 立即 revoke 在 Firefox 偶发下载失败；元素需先挂载到 DOM 再 click */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  logger.debug("triggerBlobDownload:已触发浏览器下载", {
    filename,
    blobSize: blob.size,
    blobType: blob.type,
  });
}

/** 以文本形式触发下载 */
export function downloadTextFile(
  content: string,
  mime: string,
  filename: string,
): void {
  logger.debug("downloadTextFile:入口", {
    filename,
    mime,
    contentLength: content.length,
  });
  triggerBlobDownload(
    new Blob([content], { type: mime }),
    sanitizeFilename(filename),
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 渲染单行文本中的 LaTeX 公式（$...$ / \(...\) / \[...\]）为 KaTeX HTML，
 * 返回 { text: 公式被占位符替换后的文本, formulas: 占位符→HTML 映射 }。
 * 渲染失败（非法 LaTeX）保留原文不替换。
 */
function extractInlineFormulas(line: string): {
  text: string;
  formulas: string[];
} {
  const formulas: string[] = [];
  let text = line;
  let failCount = 0;
  const failedExprs: string[] = [];
  const render = (expr: string, displayMode: boolean): string | null => {
    try {
      const html = katex.renderToString(expr.trim(), {
        displayMode,
        strict: false,
      });
      const idx = formulas.push(html) - 1;
      return `\u0000${idx}\u0000`;
    } catch {
      failCount++;
      if (failedExprs.length < 3) failedExprs.push(expr.slice(0, 60));
      return null; // 非法公式保留原文
    }
  };
  // 行内 $...$（排除 $$ 前缀，公式内不允许换行）
  text = text.replace(
    /(^|[^$])\$([^$\n]+?)\$([^$]|$)/g,
    (m, pre: string, expr: string, post: string) => {
      const html = render(expr, false);
      return html === null ? m : `${pre}${html}${post}`;
    },
  );
  // 行内 \(...\)
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (m, expr: string) => {
    const html = render(expr, false);
    return html === null ? m : html;
  });
  // 行内 \[...\]
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (m, expr: string) => {
    const html = render(expr, true);
    return html === null ? m : html;
  });
  // 公式渲染日志：仅当本行出现公式或失败时记录，避免刷屏
  if (formulas.length > 0 || failCount > 0) {
    logger.debug("extractInlineFormulas:行内公式处理", {
      renderedCount: formulas.length,
      failCount,
      failedExprPreviews: failedExprs,
      hasChemical: /\\ce\{/.test(line),
      linePreview: line.slice(0, 80),
    });
  }
  return { text, formulas };
}

/** 行内 markdown → HTML（先渲染公式隔离占位，再转义+格式，最后还原公式 HTML） */
function inlineMdToHtml(line: string): string {
  const { text, formulas } = extractInlineFormulas(line);
  let s = escapeHtml(text);
  // 行内代码 `code`
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
  // 粗体 **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // 斜体 *text*（避免与加粗重复匹配）
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  // 删除线 ~~text~~
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // 图片 ![alt](http|data:)
  s = s.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^)\s]+|data:[^)\s]+)\)/g,
    '<img src="$2" alt="$1" />',
  );
  // 链接 [text](https://...)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  // 还原公式占位符（KaTeX HTML 不经转义直接注入）
  if (formulas.length > 0) {
    s = s.replace(
      /\u0000(\d+)\u0000/g,
      (_m, idx: string) => formulas[Number(idx)],
    );
  }
  return s;
}

/**
 * 轻量 markdown → HTML 转换器（零依赖）
 * 覆盖：标题、粗体、斜体、行内代码、代码块、无序/有序列表、表格、引用、链接
 */
export function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  let tableCount = 0;
  let blockFormulaCount = 0;
  logger.debug("mdToHtml:入口", {
    inputLength: md.length,
    lineCount: lines.length,
    hasChemical: /\\ce\{/.test(md),
  });

  while (i < lines.length) {
    const line = lines[i];

    // 块级公式 $$...$$（可跨行，独占块）
    if (line.trim().startsWith("$$")) {
      const exprLines: string[] = [];
      const first = line.trim();
      if (first.length > 2 && first.endsWith("$$")) {
        // 单行 $$expr$$
        exprLines.push(first.slice(2, -2));
        i++;
      } else {
        // 多行 $$ ... $$
        exprLines.push(first.slice(2));
        i++;
        while (i < lines.length && !lines[i].trim().endsWith("$$")) {
          exprLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          const lastLine = lines[i].trim();
          exprLines.push(lastLine.slice(0, lastLine.length - 2));
          i++;
        }
      }
      const expr = exprLines.join("\n").trim();
      try {
        const html = katex.renderToString(expr, {
          displayMode: true,
          strict: false,
        });
        blockFormulaCount++;
        logger.debug("mdToHtml:渲染块级公式（$$）", {
          blockFormulaCount,
          exprLength: expr.length,
          exprPreview: expr.slice(0, 80),
          htmlLength: html.length,
        });
        out.push(`<div class="katex-block">${html}</div>`);
      } catch {
        logger.warn("mdToHtml:块级公式渲染失败，保留原文（$$）", {
          exprPreview: expr.slice(0, 80),
          exprLength: expr.length,
        });
        out.push(`<p>$$${expr}$$</p>`);
      }
      continue;
    }

    // 块级公式 \[...\]（可跨行，独占块）
    if (line.trim().startsWith("\\[")) {
      const exprLines: string[] = [];
      const first = line.trim();
      if (first.length > 2 && first.endsWith("\\]")) {
        exprLines.push(first.slice(2, -2));
        i++;
      } else {
        exprLines.push(first.slice(2));
        i++;
        while (i < lines.length && !lines[i].trim().endsWith("\\]")) {
          exprLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          const lastLine = lines[i].trim();
          exprLines.push(lastLine.slice(0, lastLine.length - 2));
          i++;
        }
      }
      const expr = exprLines.join("\n").trim();
      try {
        const html = katex.renderToString(expr, {
          displayMode: true,
          strict: false,
        });
        blockFormulaCount++;
        logger.debug("mdToHtml:渲染块级公式（\\[...\\]）", {
          blockFormulaCount,
          exprLength: expr.length,
          exprPreview: expr.slice(0, 80),
          htmlLength: html.length,
        });
        out.push(`<div class="katex-block">${html}</div>`);
      } catch {
        logger.warn("mdToHtml:块级公式渲染失败，保留原文（\\[...\\]）", {
          exprPreview: expr.slice(0, 80),
          exprLength: expr.length,
        });
        out.push(`<p>\\[${expr}\\]</p>`);
      }
      continue;
    }

    // 代码块 ```lang ... ```
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过结束标记
      out.push(
        `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // 表格：| a | b | + 分隔行（支持多列；分隔行正则含列间 |）
    if (
      line.trim().startsWith("|") &&
      i + 1 < lines.length &&
      /^\s*\|[\s:-]+(\|[\s:-]+)*\|\s*$/.test(lines[i + 1])
    ) {
      const separatorLine = lines[i + 1];
      // 解析行：按 | 切分后去除首尾空串（兼容"无尾竖线"写法）
      const parseRow = (rowLine: string): string[] =>
        rowLine
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
      const headerCells = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      tableCount++;
      logger.debug("mdToHtml:解析到表格", {
        tableCount,
        headerColumnCount: headerCells.length,
        dataRowCount: rows.length,
        headerLine: line,
        separatorLine,
      });
      out.push(
        `<table><thead><tr>${headerCells
          .map((c) => `<th>${inlineMdToHtml(c)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map(
            (r) =>
              `<tr>${r.map((c) => `<td>${inlineMdToHtml(c)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table>`,
      );
      continue;
    }

    // 水平线 --- / *** / ___
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr/>");
      i++;
      continue;
    }

    // 标题 #~######
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inlineMdToHtml(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 引用 > ...
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        `<blockquote>${quoteLines.map(inlineMdToHtml).join("<br/>")}</blockquote>`,
      );
      continue;
    }

    // 无序列表 -/*/+（含任务列表 - [x] / - [ ]）
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*+]\s+(.*)$/);
        if (!m) break;
        const itemBody = m[1];
        const task = itemBody.match(/^\[([ xX])\]\s+(.*)$/);
        items.push(
          task
            ? `<li><input type="checkbox" disabled${task[1].toLowerCase() === "x" ? " checked" : ""}/> ${inlineMdToHtml(task[2])}</li>`
            : `<li>${inlineMdToHtml(itemBody)}</li>`,
        );
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // 有序列表 1. 2. ...
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        if (!m) break;
        items.push(inlineMdToHtml(m[1]));
        i++;
      }
      out.push(`<ol>${items.map((it) => `<li>${it}</li>`).join("")}</ol>`);
      continue;
    }

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    out.push(`<p>${inlineMdToHtml(line)}</p>`);
    i++;
  }

  const html = out.join("\n");
  logger.debug("mdToHtml:转换完成", {
    inputLength: md.length,
    outputLength: html.length,
    elementCount: out.length,
    tableCount,
    blockFormulaCount,
    hasRenderedFormula: html.includes('class="katex"'),
  });
  return html;
}

/**
 * 将 HTML 包进 Word 兼容壳（零依赖，Word/WPS 可直接打开 .doc）
 */
export function buildWordHtml(title: string, bodyHtml: string): string {
  const hasFormula = bodyHtml.includes('class="katex"');
  const cdnFontCount = KATEX_CSS.match(/cdn\.jsdelivr\.net/g)?.length ?? 0;
  logger.debug("buildWordHtml:入口", {
    title,
    bodyLength: bodyHtml.length,
    hasTable: bodyHtml.includes("<table>"),
    hasCodeBlock: bodyHtml.includes("<pre>"),
    hasFormula,
    katexCssLength: KATEX_CSS.length,
    cdnFontCount,
  });
  const doc = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  body { font-family: "Microsoft YaHei", "SimSun", sans-serif; font-size: 14px; line-height: 1.7; color: #222; }
  pre { background: #f6f8fa; padding: 12px; border-radius: 6px; font-size: 13px; white-space: pre-wrap; }
  code { background: #f6f8fa; padding: 2px 4px; border-radius: 3px; font-size: 13px; }
  blockquote { border-left: 4px solid #ddd; margin: 8px 0; padding: 4px 12px; color: #666; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; }
  img { max-width: 100%; }
  .katex-block { overflow-x: auto; margin: 8px 0; }
</style>
<!-- 数学/物理/化学公式（KaTeX）样式：内联规则 + CDN 字体 -->
<style>
${KATEX_CSS}
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
  logger.debug("buildWordHtml:样式注入完成", {
    title,
    docLength: doc.length,
    bodyLength: bodyHtml.length,
    katexCssInjected: KATEX_CSS.length,
  });
  return doc;
}

/**
 * 导出单条 AI 回复（md / html / word）
 * @param content markdown 文本（如 getFullContent 产出）
 * @param format  目标格式
 * @param baseName 文件名（不含扩展名），默认 ai-reply-<时间戳>
 */
export function exportMessageAsFormat(
  content: string,
  format: "md" | "html" | "word",
  baseName?: string,
): void {
  const name = sanitizeFilename(baseName ?? `ai-reply-${Date.now()}`);
  logger.info("exportMessageAsFormat:入口", {
    format,
    contentLength: content.length,
    baseName: baseName ?? null,
    filename: name,
  });
  if (!content.trim()) {
    logger.warn("exportMessageAsFormat:内容为空，跳过导出", {
      format,
      filename: name,
    });
    return;
  }
  if (format === "md") {
    logger.info("exportMessageAsFormat:导出 Markdown", {
      filename: `${name}.md`,
    });
    downloadTextFile(content, "text/markdown;charset=utf-8", `${name}.md`);
    return;
  }
  const bodyHtml = mdToHtml(content);
  if (format === "html") {
    logger.info("exportMessageAsFormat:导出 HTML", {
      filename: `${name}.html`,
      htmlLength: bodyHtml.length,
    });
    downloadTextFile(
      buildWordHtml(name, bodyHtml),
      "text/html;charset=utf-8",
      `${name}.html`,
    );
    return;
  }
  logger.info("exportMessageAsFormat:导出 Word", {
    filename: `${name}.doc`,
    htmlLength: bodyHtml.length,
  });
  downloadTextFile(
    buildWordHtml(name, bodyHtml),
    "application/msword",
    `${name}.doc`,
  );
}
