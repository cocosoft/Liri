/**
 * NotebookPreviewModal — .ipynb 只读预览（P2-1）
 *
 * 复用后端 IpynbConverter（POST /v1/files/convert）将标准 nbformat 4 转 Markdown，
 * 前端只渲染（markdown cell 原文 + code/raw cell fenced code block 均由后端转换），
 * 避免前端重复实现 nbformat 解析（实现唯一性，方案 §三 P2-1）。
 * 仅查看，不提供编辑。
 */
import { useEffect, useState } from "react";
import { fileService } from "../../services/fileService";
import MarkdownRenderer from "../ChatArea/MarkdownRenderer";

interface NotebookPreviewModalProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
  isDark: boolean;
}

/** POST /v1/files/convert 的返回结构（ConverterEngine → IpynbConverter 输出 markdown/title） */
interface ConvertResponse {
  markdown?: string;
  title?: string;
  error?: { message?: string };
}

function NotebookPreviewModal({
  filePath,
  fileName,
  onClose,
  isDark,
}: NotebookPreviewModalProps) {
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = (await fileService.convert({
          filePath,
          outputFormat: "markdown",
        })) as ConvertResponse;
        if (result?.error) {
          setError(result.error.message || "转换失败");
        } else if (typeof result?.markdown === "string") {
          setMarkdown(result.markdown);
        } else {
          setError("无法转换 Notebook 内容（非标准 nbformat 或为空）");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [filePath]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[80vh] m-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`rounded-xl shadow-xl flex flex-col ${
            isDark ? "bg-gray-800" : "bg-white"
          }`}
        >
          <div
            className={`flex items-center justify-between px-4 py-3 border-b ${
              isDark ? "border-gray-700" : "border-gray-200"
            }`}
          >
            <h3 className="text-sm font-medium truncate">📓 {fileName}</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg"
            >
              ✕
            </button>
          </div>

          <div className="overflow-y-auto p-4">
            {loading ? (
              <div className="text-center py-8 text-gray-400">
                <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                <span className="text-xs">读取中...</span>
              </div>
            ) : error ? (
              <div className="text-center py-8 text-red-500 text-sm">
                读取失败：{error}
              </div>
            ) : markdown.trim() === "" ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                Notebook 内容为空
              </div>
            ) : (
              <MarkdownRenderer content={markdown} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default NotebookPreviewModal;
