/**
 * KnowledgeBaseList — 知识库文档列表 (Phase 1 W1: ≤200 行)
 *
 * 组合子组件 + 使用 useKnowledgeBaseList hook 管理状态。
 * W3: 搜索改为调用 knowledgeService.hybridSearch()，来源/分类筛选与搜索正交。
 */
import type { KnowledgeFile } from "../../types";
import { useEffect, useState } from "react";
import FileUploadZone from "./FileUploadZone";
import PendingCompilePanel from "./PendingCompilePanel";
import KBaseSelector from "./KBaseSelector";
import DocFilterBar from "./DocFilterBar";
import BatchActionBar from "./BatchActionBar";
import CreateBaseModal from "./CreateBaseModal";
import BatchTagModal from "./BatchTagModal";
import { useKnowledgeBaseList } from "./useKnowledgeBaseList";
import { formatFileSize, formatDate } from "./shared/utils";
import { sourceLabels } from "./shared/constants";

interface KnowledgeBaseListProps {
  isDark: boolean;
  selectedBase: string | null;
  onSelectBase: (name: string | null) => void;
  onSelectFile: (file: KnowledgeFile) => void;
  selectedFileId: string | null;
  onRefreshBases?: () => void;
  onTotalChange?: (total: number) => void;
}

function KnowledgeBaseList({
  isDark,
  selectedBase,
  onSelectBase,
  onSelectFile,
  selectedFileId,
  onRefreshBases,
  onTotalChange,
}: KnowledgeBaseListProps) {
  const {
    bases,
    files,
    loading,
    searching,
    searchQuery,
    searchResults,
    showCreateModal,
    newBaseName,
    newBaseLabel,
    newBaseIcon,
    createStatus,
    editingBase,
    editLabel,
    sortBy,
    selectedCategory,
    selectedSource,
    selectedFileIds,
    showBatchTagModal,
    batchTagInput,
    batchTagStatus,
    compileStatus,
    compileMessage,
    searchTags,
    total,
    page,
    pageSize,
    dispatch,
    loadFiles,
    handleRefresh,
    handleSearch,
    handleCompile,
    handleCreateBase,
    handleDeleteBase,
    handleCloneBase,
    handleDuplicateBase,
    handleRenameBase,
    handleBatchTag,
  } = useKnowledgeBaseList({
    selectedBase,
    onSelectBase,
    onRefreshBases,
  });

  // P1-3: 上报列表真实总数（与分页列表口径一致）
  useEffect(() => {
    onTotalChange?.(total);
  }, [total, onTotalChange]);

  // ── 计算显示列表 ──
  const isSearchActive =
    searchQuery.trim().length > 0 && searchResults.length > 0;
  const baseList = isSearchActive ? searchResults : files;
  const filteredBySource =
    !isSearchActive && selectedSource
      ? baseList.filter((f) => f.source === selectedSource)
      : baseList;
  const filteredByCategory =
    !isSearchActive && selectedCategory
      ? filteredBySource.filter((f) => f.category === selectedCategory)
      : filteredBySource;
  const sortedFiles = [...filteredByCategory].sort((a, b) => {
    if (sortBy === "title") return a.title.localeCompare(b.title);
    if (sortBy === "created") return (b.created_at || 0) - (a.created_at || 0);
    return (b.updated_at || 0) - (a.updated_at || 0);
  });

  const categories = [
    ...new Set(files.map((f) => f.category).filter(Boolean)),
  ] as string[];

  const bg = isDark ? "bg-gray-800" : "bg-gray-50",
    t1 = isDark ? "text-gray-100" : "text-gray-900",
    t2 = isDark ? "text-gray-400" : "text-gray-500",
    tm = isDark ? "text-gray-500" : "text-gray-400",
    ab = isDark ? "bg-gray-700" : "bg-blue-50",
    bc = isDark ? "border-gray-700" : "border-gray-200";

  // P1-2: 待编译面板收进抽屉，由标题栏按钮开关
  const [showCompileDrawer, setShowCompileDrawer] = useState(false);

  return (
    <div className={`relative flex flex-col h-full ${bg}`}>
      {/* 标题栏 */}
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${bc}`}
      >
        <h2 className={`text-sm font-medium ${t1}`}>知识库</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => dispatch({ type: "OPEN_CREATE_MODAL" })}
            className={`p-1 rounded ${t2} hover:opacity-70`}
            title="新建知识库"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
          <button
            onClick={handleRefresh}
            className={`p-1 rounded ${t2} hover:opacity-70`}
            title="刷新"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          <button
            onClick={() => setShowCompileDrawer((v) => !v)}
            className={`p-1 rounded ${showCompileDrawer ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600" : t2} hover:opacity-70`}
            title="待处理文件（编译队列）"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </button>
          <button
            onClick={handleCompile}
            disabled={compileStatus === "compiling"}
            className={`p-1 rounded ${t2} hover:opacity-70 disabled:opacity-40`}
            title="编译"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* 知识库选择 */}
      <KBaseSelector
        isDark={isDark}
        bases={bases}
        selectedBase={selectedBase}
        editingBase={editingBase}
        editLabel={editLabel}
        onSelectBase={onSelectBase}
        onStartEdit={(n, l) =>
          dispatch({ type: "START_EDIT_BASE", name: n, label: l })
        }
        onSetEditLabel={(l) => dispatch({ type: "SET_EDIT_LABEL", label: l })}
        onRenameBase={handleRenameBase}
        onCancelEdit={() => dispatch({ type: "CANCEL_EDIT_BASE" })}
        onDeleteBase={handleDeleteBase}
        onCloneBase={handleCloneBase}
        onDuplicateBase={handleDuplicateBase}
      />

      {/* 搜索筛选 */}
      <DocFilterBar
        isDark={isDark}
        searchQuery={searchQuery}
        sortBy={sortBy}
        selectedSource={selectedSource}
        selectedCategory={selectedCategory}
        categories={categories}
        docCount={sortedFiles.length}
        selectedBase={selectedBase}
        onSearchQueryChange={(q) =>
          dispatch({ type: "SET_SEARCH_QUERY", query: q })
        }
        onSearch={handleSearch}
        onSortByChange={(s) => dispatch({ type: "SET_SORT_BY", sortBy: s })}
        onSourceChange={(s) => dispatch({ type: "SET_SOURCE", source: s })}
        onCategoryChange={(c) =>
          dispatch({ type: "SET_CATEGORY", category: c })
        }
        onSearchTagsChange={(tags) =>
          dispatch({ type: "SET_SEARCH_TAGS", tags })
        }
        searchTags={searchTags}
      />

      {/* 编译状态 */}
      {compileStatus !== "idle" && (
        <div className="px-4 pb-2">
          <div
            className={`text-xs px-2 py-1 rounded ${compileStatus === "compiling" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600" : compileStatus === "success" ? "bg-green-100 dark:bg-green-900/30 text-green-600" : "bg-red-100 dark:bg-red-900/30 text-red-600"}`}
          >
            {compileStatus === "compiling" ? (
              <>
                <span className="animate-spin w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full inline-block mr-1" />
                编译中...
              </>
            ) : (
              compileMessage
            )}
          </div>
        </div>
      )}

      {/* 文档列表 — 主区域 */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <BatchActionBar
          isDark={isDark}
          selectedFileIds={selectedFileIds}
          selectedBase={selectedBase}
          bases={bases}
          onOpenBatchTag={() => dispatch({ type: "OPEN_BATCH_TAG_MODAL" })}
          onClearSelection={() => dispatch({ type: "CLEAR_SELECTION" })}
          onRefresh={loadFiles}
        />

        {loading || searching ? (
          <div className={`text-center py-8 ${tm}`}>
            <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
            <span className="text-xs">
              {searching ? "搜索中..." : "加载中..."}
            </span>
          </div>
        ) : sortedFiles.length === 0 ? (
          <div className={`text-center py-10 ${tm}`}>
            <svg
              className="w-12 h-12 mx-auto mb-3 opacity-30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="text-sm font-medium mb-1">
              {isSearchActive ? "未找到匹配的文档" : "知识库为空"}
            </p>
            {isSearchActive ? (
              <div>
                <p className="text-xs opacity-60 mb-2">
                  试试缩短关键词，或调整分类筛选
                </p>
                <button
                  onClick={() =>
                    dispatch({ type: "SET_SEARCH_QUERY", query: "" })
                  }
                  className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400"
                >
                  重置筛选
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 mt-3">
                <button
                  onClick={() => {
                    const uploadTrigger =
                      document.querySelector<HTMLButtonElement>(
                        '[data-testid="file-upload-trigger"]',
                      );
                    if (uploadTrigger) uploadTrigger.click();
                    else
                      document
                        .querySelector<HTMLInputElement>(
                          'input[type="file"][accept*=".md"]',
                        )
                        ?.click();
                  }}
                  className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  上传文档
                </button>
                <button
                  onClick={() => dispatch({ type: "OPEN_CREATE_MODAL" })}
                  className="px-3 py-1.5 text-xs border rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  新建文档
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {sortedFiles.map((file) => (
              <div
                key={file.id}
                className={`px-1 py-2 rounded-md transition-colors flex items-start gap-1 ${selectedFileId === file.id ? ab : isDark ? "hover:bg-gray-700" : "hover:bg-gray-100"}`}
              >
                <div
                  className="flex-shrink-0 pt-0.5 pl-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: "TOGGLE_FILE_SELECTION", id: file.id });
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedFileIds.has(file.id)}
                    onChange={() => {}}
                    className="w-3 h-3 rounded cursor-pointer accent-blue-500"
                  />
                </div>
                {/* P4: 文档项 2 行化 — 标题+来源 / 摘要+大小+日期；base/分类移入详情面板展示 */}
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => onSelectFile(file)}
                >
                  <div className="flex items-center justify-between gap-1">
                    <p className={`text-sm font-medium truncate ${t1}`}>
                      {file.title || "未命名文档"}
                    </p>
                    {file.source && (
                      <span
                        className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] ${isDark ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-500"}`}
                      >
                        {sourceLabels[file.source] || file.source}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className={`text-xs ${t2} truncate`}>
                      {file.content?.slice(0, 60) || "无内容"}
                    </p>
                    <span className={`ml-auto shrink-0 text-[10px] ${tm}`}>
                      {formatFileSize(file.size)}
                    </span>
                    {file.updated_at > 0 && (
                      <span className={`shrink-0 text-[10px] ${tm}`}>
                        {formatDate(file.updated_at)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 分页 */}
        {!isSearchActive && total > pageSize && (
          <div className="flex items-center justify-between px-2 py-1.5 border-t border-gray-200 dark:border-gray-700">
            <span className="text-[10px] text-gray-400">
              {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} /{" "}
              {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  dispatch({ type: "SET_PAGE", page: 0 });
                  loadFiles();
                }}
                disabled={page === 0}
                className="text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-30"
              >
                首页
              </button>
              <button
                onClick={() => {
                  const p = Math.max(0, page - 1);
                  dispatch({ type: "SET_PAGE", page: p });
                  loadFiles();
                }}
                disabled={page === 0}
                className="text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-30"
              >
                上一页
              </button>
              <button
                onClick={() => {
                  const p = Math.min(Math.ceil(total / pageSize) - 1, page + 1);
                  dispatch({ type: "SET_PAGE", page: p });
                  loadFiles();
                }}
                disabled={(page + 1) * pageSize >= total}
                className="text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-30"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 上传区 — 列表下方，紧凑模式 */}
      <FileUploadZone
        isDark={isDark}
        baseName={selectedBase}
        onUploadComplete={loadFiles}
      />

      {/* 待编译面板 — 收进抽屉，由标题栏按钮开关（P1-2 瘦身） */}
      {showCompileDrawer && (
        <div className="absolute inset-x-0 bottom-0 z-10">
          <PendingCompilePanel
            isDark={isDark}
            onCompileComplete={() => loadFiles()}
            onClose={() => setShowCompileDrawer(false)}
          />
        </div>
      )}

      {/* 弹窗 */}
      {showBatchTagModal && (
        <BatchTagModal
          isDark={isDark}
          selectedCount={selectedFileIds.size}
          tagInput={batchTagInput}
          status={batchTagStatus}
          onTagInputChange={(i) =>
            dispatch({ type: "SET_BATCH_TAG_INPUT", input: i })
          }
          onSave={handleBatchTag}
          onClose={() => dispatch({ type: "CLOSE_BATCH_TAG_MODAL" })}
        />
      )}
      {showCreateModal && (
        <CreateBaseModal
          isDark={isDark}
          name={newBaseName}
          label={newBaseLabel}
          icon={newBaseIcon}
          status={createStatus}
          onNameChange={(v) =>
            dispatch({ type: "SET_NEW_BASE", field: "name", value: v })
          }
          onLabelChange={(v) =>
            dispatch({ type: "SET_NEW_BASE", field: "label", value: v })
          }
          onIconChange={(v) =>
            dispatch({ type: "SET_NEW_BASE", field: "icon", value: v })
          }
          onCreate={handleCreateBase}
          onClose={() => dispatch({ type: "CLOSE_CREATE_MODAL" })}
        />
      )}
    </div>
  );
}

export default KnowledgeBaseList;
