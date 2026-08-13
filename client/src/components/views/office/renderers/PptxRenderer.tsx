/**
 * PptxRenderer — .pptx 懒加载渲染器
 * 使用 pptx-viewer 的 loadPresentation + getThumbnails 渲染幻灯片缩略图
 */

import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { useOfficeStore, type FileInfo } from "../../../../stores/officeStore";
import { officeApi } from "../../../../services/officeApi";
import { markStart } from "../../../../hooks/usePerformanceMarks";

interface PptxRendererProps {
  file: FileInfo;
}

export function PptxRenderer({ file }: PptxRendererProps) {
  const { previewCache, addToCache, setPreviewState } = useOfficeStore();
  const [thumbnails, setThumbnails] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    /** 用于 cleanup 释放 blob URL 资源 */
    let presentation: Awaited<
      ReturnType<typeof import("pptx-viewer").loadPresentation>
    > | null = null;

    async function load() {
      setLoading(true);
      setPreviewState("loading");

      try {
        // 先查缓存
        const cached = previewCache[file.id];
        if (cached) {
          setThumbnails(cached.html.split("|||PPTX_SLIDE|||"));
          setLoading(false);
          setPreviewState("success");
          return;
        }

        const doneDownload = markStart("doc-download");
        const res = await officeApi.downloadDoc(file.name);

        const blob = (res as unknown as Response)?.blob
          ? await (res as unknown as Response).blob()
          : (res as unknown as { data: Blob })?.data instanceof Blob
            ? (res as unknown as { data: Blob }).data
            : new Blob([res as unknown as string]);

        doneDownload();

        const arrayBuffer = await blob.arrayBuffer();
        if (cancelled) return;

        const doneParse = markStart("doc-purify");
        const pptxViewer = await import("pptx-viewer");
        presentation = await pptxViewer.loadPresentation(arrayBuffer);
        doneParse();

        if (cancelled) return;

        // 生成缩略图 SVG（宽度 720px）
        const svgs = pptxViewer.getThumbnails(presentation, 720);
        const svgStrings = svgs.map((svg) => {
          svg.setAttribute("width", "100%");
          svg.setAttribute("height", "auto");
          const raw = new XMLSerializer().serializeToString(svg);
          // R6 修复：SVG 经 DOMPurify svg 白名单清洗（与 MarkdownRenderer mermaid
          // 修复同方案）。pptx 内容可含事件属性/外链等，裸插 dangerouslySetInnerHTML 即 XSS。
          return DOMPurify.sanitize(raw, {
            USE_PROFILES: { svg: true, svgFilters: true },
          }) as unknown as string;
        });

        // 用分隔符合并存入缓存
        addToCache(file.id, svgStrings.join("|||PPTX_SLIDE|||"));

        if (cancelled) return;
        setThumbnails(svgStrings);
        setPreviewState("success");
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "演示文稿加载失败";
        setError(msg);
        setPreviewState("error", msg);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      presentation?.cleanup();
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

  if (error || !thumbnails) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 px-4 text-center">
        {error ?? "无法渲染演示文稿"}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-100 dark:bg-gray-900 p-4">
      <div className="flex flex-col items-center gap-4 max-w-3xl mx-auto">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          共 {thumbnails.length} 页
        </p>

        {thumbnails.map((svgStr, i) => (
          <div
            key={i}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden w-full"
          >
            <p className="text-xs text-gray-400 px-3 py-1 border-b border-gray-100 dark:border-gray-700">
              第 {i + 1} 页
            </p>
            <div
              dangerouslySetInnerHTML={{ __html: svgStr }}
              className="[&>svg]:w-full [&>svg]:h-auto"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
