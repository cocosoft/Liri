/**
 * DocPreviewModal — 文档预览模态框
 * 支持 .docx (mammoth)、.xlsx (SheetJS)、.pptx (pptx-viewer)
 * 纯浏览器端渲染，零后端依赖
 */

import { useEffect, useRef, useState } from "react";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("components:office:DocPreview");

type FileFormat = "docx" | "xlsx" | "pptx";

interface DocPreviewModalProps {
  /** 文件名（如 "report.docx"），用于请求后端下载 */
  file: string;
  onClose: () => void;
}

/** 根据文件扩展名判断格式 */
function detectFormat(fileName: string): FileFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".pptx")) return "pptx";
  return "docx";
}

export default function DocPreviewModal({
  file,
  onClose,
}: DocPreviewModalProps) {
  const format = detectFormat(file);

  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // pptx-viewer 需要 DOM 容器挂载
  const pptxContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    loadAndRender(file, format, pptxContainerRef, controller.signal)
      .then((result) => setHtml(result))
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(String(e));
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [file, format]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[92vw] h-[88vh] bg-white dark:bg-gray-950 rounded-xl overflow-hidden flex flex-col shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <span className="text-sm font-medium text-gray-900 dark:text-white truncate pr-4">
            {file}
          </span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none p-1"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-auto p-6">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <span className="text-gray-400 animate-pulse">加载中...</span>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-red-500 text-sm mb-2">{error}</p>
                <button
                  onClick={onClose}
                  className="text-xs text-blue-600 hover:underline"
                >
                  关闭
                </button>
              </div>
            </div>
          )}

          {!loading && !error && format === "pptx" && (
            <div ref={pptxContainerRef} className="pptx-slides" />
          )}

          {!loading && !error && format !== "pptx" && html && (
            <div
              dangerouslySetInnerHTML={{ __html: html }}
              className="prose prose-sm dark:prose-invert max-w-none"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 加载文件并根据格式渲染为 HTML
 * @param file       文件名（用于构建下载 URL）
 * @param format     文件格式
 * @param pptxRef    pptx-viewer 的 DOM 容器 ref（仅 pptx 格式使用）
 * @param signal     AbortController signal
 * @returns 渲染后的 HTML 字符串（pptx 返回空字符串，由 pptx-viewer 直接操作 DOM）
 */
async function loadAndRender(
  file: string,
  format: FileFormat,
  pptxRef: React.RefObject<HTMLDivElement | null>,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(`/v1/doc/download?file=${encodeURIComponent(file)}`, {
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message || "文件加载失败");
  }

  const arrayBuffer = await res.arrayBuffer();

  switch (format) {
    case "docx":
      return renderDocx(arrayBuffer);
    case "xlsx":
      return renderXlsx(arrayBuffer);
    case "pptx":
      return renderPptx(arrayBuffer, pptxRef);
  }
}

/** .docx → HTML（mammoth.js） */
async function renderDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      // 保留样式映射，提升预览效果
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Quote'] => blockquote",
        "r[style-name='Strong'] => strong",
        "r[style-name='Emphasis'] => em",
      ],
    },
  );

  if (result.messages.length > 0) {
    logger.warn("mammoth 转换警告", result.messages);
  }

  return result.value;
}

/** .xlsx → HTML 表格（SheetJS，支持多 sheet 切换） */
function renderXlsx(arrayBuffer: ArrayBuffer): string {
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
  const sheetNames = workbook.SheetNames;

  if (sheetNames.length === 0) return "<p>空工作簿</p>";

  let html = "";

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    const tableHtml = XLSX.utils.sheet_to_html(sheet, { editable: false });

    html += `<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mt-4 mb-2">${escapeHtml(name)}</h3>`;
    html += tableHtml;
    html += '<hr class="my-4 border-gray-200 dark:border-gray-700" />';
  }

  return html;
}

/** .pptx → Canvas 幻灯片（pptx-viewer 直接操作 DOM） */
async function renderPptx(
  arrayBuffer: ArrayBuffer,
  pptxRef: React.RefObject<HTMLDivElement | null>,
): Promise<string> {
  const { PPTXViewer } = await import("pptx-viewer");

  // 等待下一帧确保容器 DOM 已挂载
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const container = pptxRef.current;
  if (!container) throw new Error("预览容器未就绪");

  // 清空容器
  container.innerHTML = "";

  const viewer = new PPTXViewer(container, {
    width: 960,
    height: 540,
  });

  await viewer.load(arrayBuffer);

  // 添加翻页键盘快捷键样式
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "center";
  container.style.padding = "16px 0";

  // pptx-viewer 直接操作 DOM，不需返回 HTML
  return "";
}

/** 转义 HTML 特殊字符 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (c) => map[c] || c);
}
