import { useState, useRef } from "react";
import { knowledgeService } from "../../services/knowledgeService";
import { readFileAsBase64 } from "../../utils/format";
import { handleClientError } from "../../utils/handleError";

interface FileUploadZoneProps {
  isDark: boolean;
  baseName: string | null;
  onUploadComplete: () => void;
}

type UploadStatus = "idle" | "uploading" | "success" | "error";

interface UploadState {
  status: UploadStatus;
  message: string;
  progress: number;
}

const ACCEPTED_TYPES = [
  ".md",
  ".txt",
  ".json",
  ".csv",
  ".tsv",
  ".xml",
  ".yaml",
  ".yml",
  ".docx",
  ".xlsx",
  ".xls",
  ".pptx",
  ".pdf",
  ".epub",
  ".ipynb",
  ".zip",
  ".msg",
  ".rss",
  ".atom",
];

function FileUploadZone({
  isDark,
  baseName,
  onUploadComplete,
}: FileUploadZoneProps) {
  const [uploadState, setUploadState] = useState<UploadState>({
    status: "idle",
    message: "",
    progress: 0,
  });
  const [isDragOver, setIsDragOver] = useState(false);
  // P1-2 瘦身：上传区默认折叠为小按钮
  const [collapsed, setCollapsed] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const borderDragClass = isDragOver
    ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20"
    : isDark
      ? "border-gray-600 hover:border-gray-500"
      : "border-gray-300 hover:border-gray-400";
  const textMuted = isDark ? "text-gray-400" : "text-gray-500";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const bgHover = isDark ? "hover:bg-gray-700" : "hover:bg-gray-50";

  async function handleFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    if (!baseName) {
      setUploadState({
        status: "error",
        message: "请先选择一个知识库",
        progress: 0,
      });
      return;
    }

    // 捕获 non-null baseName 供内部函数使用
    const targetBase = baseName;

    setUploadState({ status: "uploading", message: "上传中...", progress: 0 });

    // 过滤出可接受的文件
    const validFiles = fileArray.filter((file) => {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!ACCEPTED_TYPES.includes(ext)) {
        return false;
      }
      return true;
    });

    // W8: 滑动窗口并发上传（替代串行批次）
    async function uploadWithConcurrency(
      files: File[],
      concurrency = 5,
    ): Promise<{
      successCount: number;
      errorCount: number;
      lastErrorMessage: string;
    }> {
      let successCount = 0;
      let errorCount = 0;
      let lastErrorMessage = "";
      const queue = [...files];

      async function worker() {
        while (queue.length > 0) {
          const file = queue.shift()!;
          try {
            const data = await readFileAsBase64(file);
            await knowledgeService.uploadToBase(targetBase, {
              name: file.name,
              data,
            });
            successCount++;
          } catch (err) {
            handleClientError(err, {
              module: "components:knowledge:FileUploadZone",
              action: "uploadFile",
            });
            errorCount++;
            if (err instanceof Error) {
              lastErrorMessage = err.message;
            }
          }
          // 更新进度
          const done = successCount + errorCount;
          setUploadState({
            status: "uploading",
            message: `上传中... (${done}/${files.length})`,
            progress: Math.round((done / files.length) * 100),
          });
        }
      }

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      return { successCount, errorCount, lastErrorMessage };
    }

    const { successCount, errorCount, lastErrorMessage } =
      await uploadWithConcurrency(validFiles, 5);

    if (successCount > 0) {
      setUploadState({
        status: "success",
        message: `上传完成: ${successCount} 个文件成功${errorCount > 0 ? `, ${errorCount} 个失败` : ""}`,
        progress: 100,
      });
      onUploadComplete();
    } else {
      setUploadState({
        status: "error",
        message: lastErrorMessage || "上传失败，请检查文件是否正确或稍后重试",
        progress: 0,
      });
    }

    setTimeout(() => {
      setUploadState({ status: "idle", message: "", progress: 0 });
    }, 3000);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = "";
    }
  }

  function openFileDialog() {
    fileInputRef.current?.click();
  }

  const isUploading = uploadState.status === "uploading";

  return (
    <div className="px-4 pb-3">
      {collapsed && uploadState.status === "idle" ? (
        <button
          onClick={() => setCollapsed(false)}
          className={`w-full flex items-center justify-center gap-1.5 text-xs border border-dashed rounded-lg py-1.5 transition-colors ${borderDragClass} ${bgHover}`}
        >
          <svg
            className={`w-3.5 h-3.5 ${textMuted}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <span className={textMuted}>上传文档</span>
        </button>
      ) : (
        <>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={openFileDialog}
            className={`
              relative border-2 border-dashed rounded-lg transition-all cursor-pointer
              ${borderDragClass} ${bgHover}
              ${isDragOver ? "p-4" : "py-1.5 px-3"}
              ${isUploading ? "pointer-events-none opacity-70" : ""}
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,.json,.csv,.tsv,.xml,.yaml,.yml,.docx,.xlsx,.xls,.pptx,.pdf,.epub,.ipynb,.zip,.msg,.rss,.atom"
              multiple
              onChange={handleFileInputChange}
              className="hidden"
            />

            {uploadState.status === "uploading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/10 dark:bg-black/30 rounded-lg">
                <div className="text-center">
                  <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-1" />
                  <span className={`text-xs ${textPrimary}`}>
                    {uploadState.message}
                  </span>
                </div>
              </div>
            )}

            {uploadState.status === "success" && (
              <div className="text-center">
                <span className="text-lg">✅</span>
                <p className={`text-xs mt-1 ${textPrimary}`}>
                  {uploadState.message}
                </p>
              </div>
            )}

            {uploadState.status === "error" && (
              <div className="text-center">
                <span className="text-lg">❌</span>
                <p className={`text-xs mt-1 text-red-500`}>
                  {uploadState.message}
                </p>
              </div>
            )}

            {uploadState.status === "idle" &&
              (isDragOver ? (
                <div className="text-center">
                  <svg
                    className={`w-6 h-6 mx-auto mb-1 ${textMuted}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <p className={`text-xs ${textMuted}`}>
                    拖拽文件到此处，或点击选择文件
                  </p>
                  <p className={`text-[10px] ${textMuted} mt-0.5`}>
                    支持 Markdown、文本、Office、PDF 等常见文件格式
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <svg
                    className={`w-4 h-4 ${textMuted}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <span className={`text-xs ${textMuted}`}>拖拽文件上传</span>
                </div>
              ))}

            {isUploading &&
              uploadState.progress > 0 &&
              uploadState.progress < 100 && (
                <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
                  <div
                    className="bg-blue-500 h-1 rounded-full transition-all duration-300"
                    style={{ width: `${uploadState.progress}%` }}
                  />
                </div>
              )}
          </div>

          <button
            onClick={() => setCollapsed(true)}
            className="mt-1 w-full text-center text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            收起
          </button>
        </>
      )}
    </div>
  );
}

export default FileUploadZone;
