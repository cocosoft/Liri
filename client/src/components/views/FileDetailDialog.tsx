import type { FileRegistryRecord } from "../../types";

/**
 * 文件详情弹窗属性
 */
interface FileDetailDialogProps {
  record: FileRegistryRecord;
  onClose: () => void;
}

/**
 * 文件详情弹窗组件
 * 展示文件的完整元数据信息，包括 MD5、来源、时间线等
 */
function FileDetailDialog({ record, onClose }: FileDetailDialogProps) {
  /** 格式化时间戳 */
  const formatDate = (ts: number) => {
    return new Date(ts * 1000).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  /** 格式化大小 */
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /** 复制文本到剪贴板 */
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      /* ignore */
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            文件详情
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 内容 */}
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <DetailRow
            label="原始文件名"
            value={record.originalName}
            mono={false}
          />
          <DetailRow label="保存文件名" value={record.savedName} mono />
          <DetailRow label="文件 ID" value={record.fileId} mono />
          <DetailRow label="存储路径" value={record.savedPath} mono />
          <DetailRow label="MD5" value={record.md5 || "-"} mono />
          <div className="grid grid-cols-2 gap-3">
            <DetailRow label="大小" value={formatSize(record.size)} mono />
            <DetailRow label="MIME 类型" value={record.mimeType || "-"} mono />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DetailRow label="来源" value={record.source} mono />
            <DetailRow label="来源 ID" value={record.sourceId || "-"} mono />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DetailRow label="存储分区" value={record.storeZone} mono />
            {record.storeZone === "media" && (
              <DetailRow
                label="媒体类型"
                value={record.mediaType || "-"}
                mono
              />
            )}
          </div>
          <DetailRow
            label="描述"
            value={record.description || "-"}
            mono={false}
          />
          <div className="grid grid-cols-2 gap-3">
            <DetailRow
              label="创建时间"
              value={formatDate(record.createdAt)}
              mono
            />
            <DetailRow
              label="更新时间"
              value={formatDate(record.updatedAt)}
              mono
            />
          </div>
          {record.isArchive && (
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded text-xs font-medium">
                压缩包文件
              </span>
              {record.archiveParentId && (
                <span className="text-gray-500">
                  父文件 ID:{" "}
                  <code className="text-xs">{record.archiveParentId}</code>
                </span>
              )}
            </div>
          )}
          {record.isDeleted && (
            <span className="inline-block px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded text-xs font-medium">
              已删除
            </span>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <button
            onClick={() => copyToClipboard(record.savedPath)}
            className="px-3 py-1.5 text-sm bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            复制路径
          </button>
          <button
            onClick={() => copyToClipboard(record.fileId)}
            className="px-3 py-1.5 text-sm bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            复制 ID
          </button>
          <button
            onClick={() => copyToClipboard(record.md5)}
            className="px-3 py-1.5 text-sm bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            复制 MD5
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 详情行组件
 */
function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono: boolean;
}) {
  return (
    <div>
      <span className="text-xs text-gray-400 dark:text-gray-500 block mb-0.5">
        {label}
      </span>
      <span
        className={`text-sm text-gray-900 dark:text-gray-100 block ${
          mono ? "font-mono text-xs break-all" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default FileDetailDialog;
