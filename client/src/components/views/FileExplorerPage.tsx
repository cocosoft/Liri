import { useEffect, useRef, useState } from "react";
import { useFileStore } from "../../stores/fileStore";
import { useAppStore } from "../../stores/appStore";
import { SkeletonTable } from "../common/Skeleton";

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FileExplorerPage() {
  const {
    entries,
    currentPath,
    isLoading,
    error,
    uploading,
    detectResult,
    convertResult,
    loadDir,
    navigateTo,
    goUp,
    uploadFile,
    detectFile,
    convertFile,
    clearFileAction,
  } = useFileStore();
  const setActivePage = useAppStore((s) => s.setActivePage);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    path: string;
  } | null>(null);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [convertFormat, setConvertFormat] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    loadDir(currentPath);
  }, []);

  useEffect(() => {
    if (error) {
      setDetecting(false);
      setConverting(false);
    }
  }, [error]);

  const handleItemClick = (entry: {
    name: string;
    path: string;
    type: "file" | "directory";
  }) => {
    if (entry.type === "directory") {
      navigateTo(entry.path);
      setSelectedFile(null);
      clearFileAction();
    } else {
      setSelectedFile(
        entry.type === "file" ? { name: entry.name, path: entry.path } : null,
      );
      clearFileAction();
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
      e.target.value = "";
    }
  };

  const handleDetect = async () => {
    if (!selectedFile) return;
    setDetecting(true);
    await detectFile(selectedFile.path);
    setDetecting(false);
  };

  const handleConvertOpen = () => {
    setConvertFormat("");
    setShowConvertDialog(true);
  };

  const handleConvertConfirm = async () => {
    if (!selectedFile || !convertFormat.trim()) return;
    setConverting(true);
    setShowConvertDialog(false);
    await convertFile({
      filePath: selectedFile.path,
      outputFormat: convertFormat.trim(),
    });
    setConverting(false);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              文件浏览器
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {currentPath}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleUploadClick}
              disabled={uploading}
              className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
            >
              {uploading ? "上传中..." : "上传文件"}
            </button>
            <button
              onClick={goUp}
              disabled={currentPath === "/"}
              className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40"
            >
              上级目录
            </button>
            <button
              onClick={() => setActivePage("chat")}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              返回聊天
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
            {error}
            <button
              onClick={clearFileAction}
              className="ml-2 text-red-500 hover:text-red-700 underline"
            >
              关闭
            </button>
          </div>
        )}

        {selectedFile && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>📄</span>
                <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  已选择: {selectedFile.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDetect}
                  disabled={detecting}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded"
                >
                  {detecting ? "检测中..." : "检测类型"}
                </button>
                <button
                  onClick={handleConvertOpen}
                  disabled={converting}
                  className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded"
                >
                  {converting ? "转换中..." : "转换格式"}
                </button>
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    clearFileAction();
                  }}
                  className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  取消
                </button>
              </div>
            </div>

            {detectResult && (
              <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800">
                <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                  <p>
                    <span className="font-medium">文件类型:</span>{" "}
                    {detectResult.type}
                  </p>
                  <p>
                    <span className="font-medium">MIME:</span>{" "}
                    {detectResult.mime}
                  </p>
                  <p>
                    <span className="font-medium">扩展名:</span>{" "}
                    {detectResult.extension}
                  </p>
                </div>
              </div>
            )}

            {!!convertResult && (
              <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800">
                <div className="text-xs text-green-700 dark:text-green-300">
                  转换成功: {JSON.stringify(convertResult)}
                </div>
              </div>
            )}
          </div>
        )}

        {showConvertDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-96 shadow-xl">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                文件格式转换
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                目标文件: {selectedFile?.name}
              </p>
              <input
                type="text"
                value={convertFormat}
                onChange={(e) => setConvertFormat(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConvertConfirm()}
                placeholder="输入目标格式 (如: pdf, docx, txt)"
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowConvertDialog(false)}
                  className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
                >
                  取消
                </button>
                <button
                  onClick={handleConvertConfirm}
                  disabled={!convertFormat.trim()}
                  className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded disabled:cursor-not-allowed"
                >
                  开始转换
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {isLoading ? (
            <div className="p-4">
              <SkeletonTable rows={5} />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              空目录
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase">
                  <th className="text-left px-4 py-3 font-medium">名称</th>
                  <th className="text-right px-4 py-3 font-medium w-24">
                    大小
                  </th>
                  <th className="text-right px-4 py-3 font-medium w-32">
                    修改时间
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.path}
                    onClick={() => handleItemClick(entry)}
                    className={`border-b border-gray-100 dark:border-gray-700/50 transition-colors cursor-pointer ${
                      selectedFile?.path === entry.path
                        ? "bg-blue-50 dark:bg-blue-900/20"
                        : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">
                          {entry.type === "directory" ? "📁" : "📄"}
                        </span>
                        <span className="text-sm text-gray-900 dark:text-gray-100 truncate max-w-xs">
                          {entry.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500 dark:text-gray-400">
                      {entry.type === "file" ? formatSize(entry.size) : "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(entry.modified_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default FileExplorerPage;
