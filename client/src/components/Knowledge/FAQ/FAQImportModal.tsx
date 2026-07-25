import { useState, useCallback, memo } from "react";
import { X, Upload } from "lucide-react";
import type { FAQImportReport } from "../../../types/faq";

interface FAQImportModalProps {
  isDark: boolean;
  onImport: (format: "csv" | "json", data: string) => Promise<FAQImportReport>;
  onClose: () => void;
}

export const FAQImportModal = memo(function FAQImportModal({
  isDark,
  onImport,
  onClose,
}: FAQImportModalProps) {
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<FAQImportReport | null>(null);
  const [error, setError] = useState("");
  const [rawText, setRawText] = useState("");

  const handleImport = useCallback(async () => {
    if (!rawText.trim()) {
      setError("请粘贴或选择文件内容");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const result = await onImport(format, rawText.trim());
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }, [format, rawText, onImport]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        setRawText(text);
        setReport(null);
      } catch {
        setError("文件读取失败");
      }
    },
    [],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`w-full max-w-lg max-h-[85vh] rounded-xl shadow-xl flex flex-col overflow-hidden ${
          isDark ? "bg-gray-900 border border-gray-700" : "bg-white border border-gray-200"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}>
          <h2 className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-800"}`}>
            批量导入 FAQ
          </h2>
          <button onClick={onClose} className={`p-1 rounded hover:bg-gray-700/50 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 格式选择 */}
          <div>
            <span className={`text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}>格式</span>
            <div className="flex gap-2 mt-1">
              {(["csv", "json"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => { setFormat(f); setReport(null); }}
                  className={`text-xs px-3 py-1 rounded-lg border ${
                    format === f
                      ? "bg-blue-500/20 border-blue-500 text-blue-500"
                      : isDark
                        ? "border-gray-700 text-gray-400"
                        : "border-gray-200 text-gray-500"
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* 格式提示 */}
          <div className={`text-[10px] leading-relaxed rounded-lg px-3 py-2 ${
            isDark ? "bg-gray-800 text-gray-400" : "bg-gray-50 text-gray-500"
          }`}>
            {format === "csv" ? (
              <>
                <p className="font-medium mb-1">CSV 格式：</p>
                <code>question,answer,category,tags</code><br />
                <code>&quot;如何重置密码&quot;,&quot;请前往设置...&quot;,&quot;账号问题&quot;,&quot;密码,账号&quot;</code>
              </>
            ) : (
              <>
                <p className="font-medium mb-1">JSON 格式：</p>
                <code>{'[{ "question": "...", "answer": "...", "category": "...", "tags": ["..."] }]'}</code>
              </>
            )}
          </div>

          {/* 文件选择 + 文本粘贴 */}
          <div className="space-y-2">
            <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed cursor-pointer text-xs transition-colors ${
              isDark
                ? "border-gray-700 text-gray-400 hover:border-gray-500"
                : "border-gray-200 text-gray-500 hover:border-gray-300"
            }`}>
              <Upload size={14} />
              点击选择文件
              <input type="file" accept={format === "csv" ? ".csv" : ".json"} onChange={handleFileChange} className="hidden" />
            </label>
            <textarea
              value={rawText}
              onChange={(e) => { setRawText(e.target.value); setReport(null); }}
              placeholder={`或直接粘贴 ${format.toUpperCase()} 内容...`}
              rows={8}
              className={`w-full text-xs px-3 py-2 rounded-lg border outline-none resize-none font-mono ${
                isDark
                  ? "bg-gray-800 border-gray-700 text-gray-200 focus:border-blue-500"
                  : "bg-white border-gray-200 text-gray-800 focus:border-blue-400"
              }`}
            />
          </div>

          {/* 错误 */}
          {error && (
            <div className="text-xs text-red-500 bg-red-500/10 rounded px-3 py-2">{error}</div>
          )}

          {/* 导入报告 */}
          {report && (
            <div className={`text-xs rounded-lg px-3 py-2 ${
              report.failed > 0
                ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                : "bg-green-500/10 text-green-600 dark:text-green-400"
            }`}>
              导入 {report.imported}，跳过 {report.skipped}，失败 {report.failed}
              {report.errors.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {report.errors.map((e, i) => (
                    <div key={i}>第 {e.row} 行: {e.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-end gap-2 px-4 py-3 border-t ${isDark ? "border-gray-700" : "border-gray-200"}`}>
          <button onClick={onClose} className={`text-xs px-3 py-1.5 rounded-lg ${
            isDark ? "text-gray-400 hover:bg-gray-800" : "text-gray-500 hover:bg-gray-100"
          }`}>
            取消
          </button>
          <button
            onClick={handleImport}
            disabled={importing || !rawText.trim()}
            className={`text-xs px-4 py-1.5 rounded-lg font-medium transition-colors ${
              importing || !rawText.trim() ? "opacity-50 cursor-not-allowed" : ""
            } bg-blue-600 text-white hover:bg-blue-700`}
          >
            {importing ? "导入中..." : "导入"}
          </button>
        </div>
      </div>
    </div>
  );
});
