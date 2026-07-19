/**
 * XlsxRenderer — .xlsx 懒加载渲染器
 * 使用 SheetJS 解析 .xlsx，输出 HTML 表格，DOMPurify 清洗后渲染
 */

import { useEffect, useState, useRef } from "react";
import * as XLSX from "xlsx";
import { useOfficeStore, type FileInfo } from "../../../../stores/officeStore";
import { officeApi } from "../../../../services/officeApi";
import { sanitizeDocHtml } from "./purifyConfig";
import { useTheme } from "../../../../hooks/useTheme";
import { markStart } from "../../../../hooks/usePerformanceMarks";

interface XlsxRendererProps {
  file: FileInfo;
}

export function XlsxRenderer({ file }: XlsxRendererProps) {
  const theme = useTheme();
  const isDark = theme === "dark";

  const { previewCache, addToCache, setPreviewState } = useOfficeStore();
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const cached = previewCache[file.id];
      if (cached) {
        setHtml(cached.html);
        setLoading(false);
        setPreviewState("success");
        return;
      }

      setLoading(true);
      setPreviewState("loading");

      try {
        const doneDownload = markStart("doc-download");
        const res = await officeApi.downloadDoc(file.name);

        const blob = (res as unknown as Response)?.blob
          ? await (res as unknown as Response).blob()
          : (res as unknown as { data: Blob })?.data instanceof Blob
            ? (res as unknown as { data: Blob }).data
            : new Blob([res as unknown as string]);

        doneDownload();

        const arrayBuffer = await blob.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: "array" });

        // 渲染所有 sheet，每个 sheet 一个表格
        let tableHtml = "";
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const sheetHtml = XLSX.utils.sheet_to_html(sheet, { id: sheetName });
          tableHtml += `<h3>${sheetName}</h3>${sheetHtml}`;
        }

        if (cancelled) return;

        const donePurify = markStart("doc-purify");
        const sanitized = sanitizeDocHtml(tableHtml);
        donePurify();

        setHtml(sanitized);
        addToCache(file.id, sanitized);
        setPreviewState("success");
      } catch (err) {
        if (cancelled) return;
        setPreviewState(
          "error",
          err instanceof Error ? err.message : "表格加载失败",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, file.name]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        加载中...
      </div>
    );
  }

  if (!html) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        无法渲染表格内容
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-auto">
      <div
        className={`p-4 ${isDark ? "bg-gray-900" : "bg-white"}`}
        style={
          isDark
            ? { filter: "invert(0.9) hue-rotate(180deg)" }
            : {}
        }
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
