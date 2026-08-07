/**
 * NotebookPreviewModal — .ipynb 只读预览（P2-1）
 *
 * 读取标准 Jupyter nbformat 4 文件（P1 后 NotebookManager 保存的标准格式），
 * 渲染 markdown cell（MarkdownRenderer）与 code/raw cell（代码块）。
 * 仅查看，不提供编辑。
 */
import { useEffect, useState } from "react";
import { fileService } from "../../services/fileService";
import MarkdownRenderer from "../ChatArea/MarkdownRenderer";

interface JupyterCell {
  cell_type: "markdown" | "code" | "raw";
  source: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
}

interface NotebookPreviewModalProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
  isDark: boolean;
}

/** Jupyter source（string | string[]）归一化为字符串 */
function sourceToText(source: string | string[]): string {
  return Array.isArray(source) ? source.join("") : source;
}

/** 解析标准 nbformat 4.x 的 cells；失败返回空数组 */
function parseCells(text: string): JupyterCell[] {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data.cells)) return data.cells as JupyterCell[];
  } catch {
    /* 解析失败返回空 */
  }
  return [];
}

function NotebookPreviewModal({
  filePath,
  fileName,
  onClose,
  isDark,
}: NotebookPreviewModalProps) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const text = await fileService.readFile(filePath);
        setContent(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [filePath]);

  const cells = content ? parseCells(content) : [];

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

          <div className="overflow-y-auto p-4 space-y-3">
            {loading ? (
              <div className="text-center py-8 text-gray-400">
                <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                <span className="text-xs">读取中...</span>
              </div>
            ) : error ? (
              <div className="text-center py-8 text-red-500 text-sm">
                读取失败：{error}
              </div>
            ) : cells.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                无法解析 Notebook 内容（非标准 nbformat 或为空）
              </div>
            ) : (
              cells.map((cell, i) =>
                cell.cell_type === "markdown" ? (
                  <div
                    key={i}
                    className={`px-3 py-2 rounded-lg ${
                      isDark ? "bg-gray-700/40" : "bg-gray-50"
                    }`}
                  >
                    <MarkdownRenderer content={sourceToText(cell.source)} />
                  </div>
                ) : (
                  <div
                    key={i}
                    className={`rounded-lg border overflow-hidden ${
                      isDark ? "border-gray-700" : "border-gray-200"
                    }`}
                  >
                    <div
                      className={`px-2 py-1 text-[10px] ${
                        isDark
                          ? "bg-gray-700 text-gray-400"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {cell.cell_type === "code" ? "代码" : "RAW"}
                    </div>
                    <pre
                      className={`text-xs p-3 overflow-x-auto font-mono ${
                        isDark ? "bg-gray-900" : "bg-gray-50"
                      }`}
                    >
                      {sourceToText(cell.source)}
                    </pre>
                  </div>
                ),
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default NotebookPreviewModal;
