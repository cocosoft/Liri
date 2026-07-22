/**
 * DocxRenderer — .docx 懒加载渲染器
 * 使用 mammoth 将 .docx 转为 HTML，DOMPurify 清洗后渲染
 * 支持深色模式（纯文本 invert + 含图片二次反转补偿）
 */

import { useEffect, useState, useRef } from "react";
import mammoth from "mammoth";
import { useOfficeStore, type FileInfo } from "../../../../stores/officeStore";
import { officeApi } from "../../../../services/officeApi";
import { sanitizeDocHtml } from "./purifyConfig";
import { useTheme } from "../../../../hooks/useTheme";

interface DocxRendererProps {
  file: FileInfo;
}

export function DocxRenderer({ file }: DocxRendererProps) {
  const theme = useTheme();
  const isDark = theme === "dark";

  const { previewCache, addToCache, setPreviewState } = useOfficeStore();
  const [html, setHtml] = useState<string | null>(null);
  const [hasImages, setHasImages] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // 先查缓存
      const cached = previewCache[file.id];
      if (cached) {
        setHtml(cached.html);
        setHasImages(cached.html.includes("<img"));
        setLoading(false);
        setPreviewState("success");
        return;
      }

      setLoading(true);
      setPreviewState("loading");

      try {
        const res = await officeApi.downloadDoc(file.name);
        // 处理 different response formats
        const blob = (res as unknown as Response)?.blob
          ? await (res as unknown as Response).blob()
          : (res as unknown as { data: Blob })?.data instanceof Blob
            ? (res as unknown as { data: Blob }).data
            : new Blob([res as unknown as string]);

        const arrayBuffer = await blob.arrayBuffer();

        const result = await mammoth.convertToHtml(
          { arrayBuffer },
          {
            // 保留样式但限制转换选项
            styleMap: [
              "p[style-name='Heading 1'] => h1:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Heading 3'] => h3:fresh",
            ],
          },
        );

        if (cancelled) return;

        const sanitized = sanitizeDocHtml(result.value);
        setHtml(sanitized);
        setHasImages(sanitized.includes("<img"));
        addToCache(file.id, sanitized);
        setPreviewState("success");
      } catch (err) {
        if (cancelled) return;
        setPreviewState(
          "error",
          err instanceof Error ? err.message : "文档加载失败",
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
        无法渲染文档内容
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-auto">
      <div
        className="p-6 max-w-3xl mx-auto"
        style={{
          ...(isDark && !hasImages
            ? { filter: "invert(0.9) hue-rotate(180deg)" }
            : {}),
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {/* 含图片文档深色模式：仅反转容器背景，图片单独处理 */}
      {isDark && hasImages && (
        <style>{`
          .docx-preview img {
            filter: invert(1) hue-rotate(180deg);
          }
        `}</style>
      )}
    </div>
  );
}
