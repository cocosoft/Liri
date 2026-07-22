/**
 * DOMPurify 白名单配置（集中维护）
 * 保留 mammoth/SheetJS 输出的文档排版样式，同时过滤恶意内容
 *
 * 注意：实施后需用包含表格、图片、删除线、下划线的 .docx 验证标签覆盖
 */

import DOMPurify from "dompurify";

export const DOC_PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "img",
    "a",
    "ul",
    "ol",
    "li",
    "br",
    "strong",
    "em",
    "span",
    "div",
    "pre",
    "code",
    "blockquote",
    "hr",
    "sup",
    "sub",
    "s",
    "u",
    "dl",
    "dt",
    "dd",
    "figure",
    "figcaption",
  ],
  ALLOWED_ATTR: [
    "href",
    "src",
    "alt",
    "style",
    "class",
    "colspan",
    "rowspan",
    "width",
    "height",
    "id",
    "title",
  ],
  ALLOW_DATA_ATTR: false,
};

/**
 * 安全清洗 HTML 内容
 * 使用集中配置的白名单，保留文档排版
 */
export function sanitizeDocHtml(html: string): string {
  return DOMPurify.sanitize(html, DOC_PURIFY_CONFIG) as unknown as string;
}
