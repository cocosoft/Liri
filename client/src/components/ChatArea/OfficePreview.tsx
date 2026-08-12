/**
 * OfficePreview — 客户端 Office 文件预览组件
 *
 * 替代后端 ConverterEngine → Markdown 路径，直接在浏览器中渲染：
 * - DOCX → mammoth.js → HTML
 * - XLSX → SheetJS → HTML 表格
 * - PPTX → pptx-viewer → SVG 缩略图
 * - PDF  → 由调用方 FilePreviewContent 分流到后端 Markdown 渲染（不经本组件）
 *
 * 通过 /api/file/stream 获取二进制文件，前端本地转换渲染。
 */

import { useEffect, useState, useRef } from "react";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import DOMPurify from "dompurify";
import { getBackendBaseUrl } from "../../services/backendUrl";
import { handleClientError } from "../../utils/handleError";
import type { FilePreview } from "../../types";

interface OfficePreviewProps {
  file: FilePreview;
}

/** 模块级 HTML 缓存，避免重复解析同一文件（上限 10 条，LRU） */
const htmlCache = new Map<string, string>();
const MAX_CACHE = 10;

export default function OfficePreview({ file }: OfficePreviewProps) {
  const [html, setHtml] = useState<string | null>(
    () => htmlCache.get(file.path) ?? null,
  );
  const [loading, setLoading] = useState(!htmlCache.has(file.path));
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;

    // 已缓存则直接使用
    const cached = htmlCache.get(file.path);
    if (cached) {
      setHtml(cached);
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const baseUrl = getBackendBaseUrl();
        const streamUrl = `${baseUrl}/api/file/stream?path=${encodeURIComponent(file.path)}`;
        const res = await fetch(streamUrl);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: 文件加载失败`);
        }

        const arrayBuffer = await res.arrayBuffer();
        if (cancelled) return;

        let content: string;

        if (file.type === "docx") {
          const result = await mammoth.convertToHtml(
            { arrayBuffer },
            {
              // 保留图片为 base64 内嵌
              convertImage: mammoth.images.imgElement((image) =>
                image.read("base64").then((b64) => ({
                  src: `data:${image.contentType};base64,${b64}`,
                })),
              ),
            },
          );
          content = result.value;
        } else if (file.type === "xlsx") {
          const workbook = XLSX.read(new Uint8Array(arrayBuffer), {
            type: "array",
          });
          const sheets = workbook.SheetNames.map((name) => {
            const sheet = workbook.Sheets[name];
            const sheetHtml = XLSX.utils.sheet_to_html(sheet, { id: name });
            return `<h3>${DOMPurify.sanitize(name)}</h3>${sheetHtml}`;
          });
          content = sheets.join('<hr style="margin:16px 0" />');
        } else if (file.type === "pptx") {
          const { loadPresentation, getThumbnails } =
            await import("pptx-viewer");
          const presentation = await loadPresentation(
            new Uint8Array(arrayBuffer),
          );
          const thumbnails = await getThumbnails(presentation);
          presentation.cleanup?.();
          content = thumbnails
            .map((svg: SVGSVGElement) => {
              const xml = new XMLSerializer().serializeToString(svg);
              return `<div style="max-width:100%;margin-bottom:12px;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden">${xml}</div>`;
            })
            .join("");
        } else {
          throw new Error(`不支持的 Office 格式: ${file.type}`);
        }

        if (!cancelled) {
          const sanitized = DOMPurify.sanitize(content, {
            ADD_TAGS: [
              "img",
              "h3",
              "hr",
              "div",
              "svg",
              "g",
              "path",
              "rect",
              "circle",
              "ellipse",
              "line",
              "polyline",
              "polygon",
              "text",
              "tspan",
              "defs",
              "clipPath",
              "linearGradient",
              "radialGradient",
              "stop",
              "use",
              "image",
              "foreignObject",
            ],
            ADD_ATTR: [
              "src",
              "alt",
              "style",
              "id",
              "border",
              "d",
              "x",
              "y",
              "width",
              "height",
              "viewBox",
              "fill",
              "stroke",
              "stroke-width",
              "transform",
              "cx",
              "cy",
              "r",
              "rx",
              "ry",
              "x1",
              "y1",
              "x2",
              "y2",
              "points",
              "href",
              "clip-path",
              "clip-rule",
              "fill-rule",
              "stroke-linecap",
              "stroke-linejoin",
              "font-size",
              "font-family",
              "text-anchor",
              "dominant-baseline",
              "opacity",
              "xmlns",
            ],
          });
          // 写入缓存（LRU 淘汰）
          if (htmlCache.size >= MAX_CACHE) {
            const firstKey = htmlCache.keys().next().value;
            if (firstKey) htmlCache.delete(firstKey);
          }
          htmlCache.set(file.path, sanitized);
          setHtml(sanitized);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          handleClientError(err, {
            module: "components:office:preview",
            action: "render",
          });
          setError(message);
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [file.path, file.type]);

  // 加载态：骨架屏
  if (loading) {
    return (
      <div className="flex-1 p-4 space-y-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-1/2" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-5/6" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-2/3" />
        <div className="h-80 bg-gray-100 dark:bg-gray-800 rounded animate-pulse mt-4" />
      </div>
    );
  }

  // 错误态
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-sm text-red-500 dark:text-red-400 mb-2">
            预览渲染失败
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  // 成功渲染
  return (
    <div
      className="flex-1 overflow-auto p-4 office-preview-content dark:invert-[0.9]"
      dangerouslySetInnerHTML={{ __html: html! }}
    />
  );
}
