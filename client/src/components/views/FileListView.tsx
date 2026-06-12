import { useEffect, useState, useCallback } from "react";
import { useFileStore } from "../../stores/fileStore";
import type { FileRegistryRecord, StoreZone } from "../../types";
import SearchInput from "../common/SearchInput";

/**
 * 来源筛选选项配置
 */
const SOURCE_GROUPS: Array<{ label: string; sources: string[] }> = [
  { label: "全部", sources: [] },
  { label: "用户上传", sources: ["upload"] },
  { label: "Telegram", sources: ["channel_telegram"] },
  { label: "飞书", sources: ["channel_feishu"] },
  { label: "钉钉", sources: ["channel_dingtalk"] },
  { label: "AI 写入", sources: ["tool_write"] },
  { label: "AI 下载", sources: ["tool_download"] },
  { label: "AI 生成", sources: ["tool_generate"] },
  { label: "自动摄取", sources: ["auto_ingest"] },
  { label: "会话制品", sources: ["artifact"] },
  { label: "笔记本", sources: ["notebook"] },
  { label: "解压产物", sources: ["archive_extracted"] },
];

/**
 * 文件列表视图组件
 * 支持来源筛选、FTS 搜索、游标分页
 */
function FileListView() {
  const {
    registryResults,
    registryTotal,
    registryNextCursor,
    registryParams,
    registryLoading,
    error,
    searchRegistry,
    loadMoreRegistry,
    setRegistryParams,
    setViewMode,
  } = useFileStore();

  const [searchText, setSearchText] = useState("");
  const [activeSource, setActiveSource] = useState<string | undefined>(undefined);
  const [storeZone, setStoreZone] = useState<StoreZone | string | undefined>("inbound");
  const [selectedFile, setSelectedFile] = useState<FileRegistryRecord | null>(null);

  /** 执行搜索 */
  const doSearch = useCallback(() => {
    const params: Record<string, unknown> = {};
    if (searchText.trim()) params.query = searchText.trim();
    if (activeSource) params.source = activeSource;
    if (storeZone) params.store_zone = storeZone;
    setRegistryParams(params as any);
  }, [searchText, activeSource, storeZone, setRegistryParams]);

  /** 初始加载 */
  useEffect(() => {
    doSearch();
  }, []);

  /** registryParams 变化时自动搜索 */
  useEffect(() => {
    searchRegistry();
  }, [registryParams]);

  /** 格式化时间 */
  const formatDate = (ts: number) => {
    return new Date(ts * 1000).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  /** 格式化大小 */
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /** 获取文件类型图标 */
  const getFileIcon = (record: FileRegistryRecord) => {
    const ext = record.originalName.split(".").pop()?.toLowerCase() || "";
    const imageExts = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"];
    const codeExts = ["js", "ts", "tsx", "jsx", "py", "java", "cpp", "c", "go", "rs", "rb", "php"];
    const docExts = ["md", "markdown", "txt", "pdf", "doc", "docx"];
    const archiveExts = ["zip", "tar", "gz", "rar", "7z"];

    if (imageExts.includes(ext)) return "🖼️";
    if (codeExts.includes(ext)) return "💻";
    if (docExts.includes(ext)) return "📄";
    if (archiveExts.includes(ext)) return "📦";
    return "📎";
  };

  /** 获取来源中文标签 */
  const getSourceLabel = (source: string): string => {
    const group = SOURCE_GROUPS.find((g) => g.sources.includes(source));
    return group?.label || source;
  };

  /** 获取来源颜色 */
  const getSourceColor = (source: string): string => {
    const colors: Record<string, string> = {
      upload: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      channel_telegram: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
      tool_write: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
      tool_download: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
      tool_generate: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
      auto_ingest: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
      artifact: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
      notebook: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
      archive_extracted: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    };
    return colors[source] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* 搜索与筛选栏 */}
      <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700 space-y-3">
        <div className="flex items-center gap-3">
          <SearchInput
            value={searchText}
            onChange={(v) => { setSearchText(v); }}
            placeholder="FTS 全文搜索..."
            className="flex-1"
          />
          <button
            onClick={() => { doSearch(); searchRegistry(); }}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            搜索
          </button>
          <button
            onClick={() => setViewMode('directory')}
            className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition-colors"
          >
            返回目录
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* 来源筛选 */}
          <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">来源:</span>
          {SOURCE_GROUPS.map((group) => (
            <button
              key={group.label}
              onClick={() => {
                const newSource = activeSource === group.sources[0] ? undefined : (group.sources[0] || undefined);
                setActiveSource(newSource);
              }}
              className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                (group.sources.length === 0 && !activeSource) ||
                (group.sources.length > 0 && activeSource === group.sources[0])
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600"
              }`}
            >
              {group.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* 存储分区筛选 */}
          <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">分区:</span>
          {(['inbound', 'media', 'artifact', 'notebook'] as const).map((zone) => (
            <button
              key={zone}
              onClick={() => setStoreZone(storeZone === zone ? undefined : zone)}
              className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                storeZone === zone
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600"
              }`}
            >
              {zone === 'inbound' ? '入站' : zone === 'media' ? '媒体' : zone === 'artifact' ? '制品' : '笔记本'}
            </button>
          ))}
        </div>
      </div>

      {/* 统计信息 */}
      <div className="px-6 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          共 <strong className="text-gray-700 dark:text-gray-300">{registryTotal}</strong> 条记录
          {registryResults.length < registryTotal && (
            <span className="ml-1">（已显示 {registryResults.length} 条）</span>
          )}
        </span>
      </div>

      {/* 文件列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {registryLoading && registryResults.length === 0 ? (
          <div className="text-center py-12 text-gray-400">加载中...</div>
        ) : error ? (
          <div className="text-center py-12 text-red-500">{error}</div>
        ) : registryResults.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">暂无文件记录</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
              上传文件或使用 AI 工具生成文件后将在此处显示
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {registryResults.map((record) => (
                <div
                  key={record.fileId}
                  onClick={() => setSelectedFile(selectedFile?.fileId === record.fileId ? null : record)}
                  className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                    selectedFile?.fileId === record.fileId
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                      : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-xl flex-shrink-0">{getFileIcon(record)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                            {record.originalName}
                          </span>
                          <span className="text-xs text-gray-400 font-mono flex-shrink-0">
                            {record.savedName}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-400">
                            {formatSize(record.size)}
                          </span>
                          <span className="text-xs text-gray-400">
                            {record.mimeType || "未知类型"}
                          </span>
                          <span className="text-xs text-gray-400">
                            {formatDate(record.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className={`flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded ${getSourceColor(record.source)}`}>
                      {getSourceLabel(record.source)}
                    </span>
                  </div>

                  {/* 展开详情 */}
                  {selectedFile?.fileId === record.fileId && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-gray-400">来源 ID：</span>
                          <span className="text-gray-700 dark:text-gray-300">{record.sourceId || "-"}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">存储分区：</span>
                          <span className="text-gray-700 dark:text-gray-300">{record.storeZone}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">MD5：</span>
                          <code className="text-xs text-gray-700 dark:text-gray-300">{record.md5 || "-"}</code>
                        </div>
                        <div>
                          <span className="text-gray-400">文件 ID：</span>
                          <code className="text-xs text-gray-700 dark:text-gray-300">{record.fileId}</code>
                        </div>
                        {record.storeZone === 'inbound' && (
                          <div className="col-span-2">
                            <span className="text-gray-400">保存路径：</span>
                            <code className="text-xs text-gray-600 dark:text-gray-400 break-all">{record.savedPath}</code>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // 复制路径到剪贴板
                            navigator.clipboard.writeText(record.savedPath);
                          }}
                          className="px-3 py-1 text-xs bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors"
                        >
                          复制路径
                        </button>
                        {record.storeZone !== 'media' && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await useFileStore.getState().saveToKnowledge(record.savedPath);
                              } catch (_) { /* ignore */ }
                            }}
                            className="px-3 py-1 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded-md transition-colors"
                          >
                            存入知识库
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 加载更多 */}
            {registryNextCursor && (
              <div className="text-center py-4">
                <button
                  onClick={loadMoreRegistry}
                  disabled={registryLoading}
                  className="px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {registryLoading ? "加载中..." : "加载更多"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default FileListView;
