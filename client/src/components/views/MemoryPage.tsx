import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { useMemoryStore } from "../../stores/memoryStore";
import type { MemoryType } from "../../services/memoryService";
import type { Memory } from "../../services/memoryService";
import MemorySearch from "../Memory/MemorySearch";
import MemoryList from "../Memory/MemoryList";
import MemoryWeightChart from "../Memory/MemoryWeightChart";
import MemorySyncingStatus from "../Memory/MemorySyncingStatus";
import MemoryCreateDialog from "../Memory/MemoryCreateDialog";
import { TYPE_LABELS } from "../Memory/memoryConstants";

function MemoryPage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const {
    memories,
    total,
    searchResults,
    weights,
    systemStats,
    selectedMemory,
    selectedIds,
    isBatchMode,
    isCleaning,
    isConsolidating,
    isDreaming,
    isLoading,
    isImporting,
    error,
    dreamBusyMessage,
    loadMemories,
    searchMemories,
    loadWeights,
    loadSystemStats,
    triggerCleanup,
    triggerConsolidate,
    triggerDream,
    deleteMemory,
    setSelectedMemory,
    updateMemory,
    deleteAllMemories,
    createMemory,
    toggleSelectMemory,
    selectAllMemories,
    clearSelection,
    batchDelete,
    togglePinMemory,
    importFromFile,
    exportAllAsJson,
  } = useMemoryStore();

  const [sortBy, setSortBy] = useState<"createdAt" | "updatedAt" | "weight">(
    "updatedAt",
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [typeFilter, setTypeFilter] = useState<MemoryType | "all">("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [editMemory, setEditMemory] = useState<Memory | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editType, setEditType] = useState<MemoryType>("knowledge");
  const [editTags, setEditTags] = useState("");
  const [editWeight, setEditWeight] = useState(50);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [importFilePath, setImportFilePath] = useState("");
  const [deleteAllConfirm, setDeleteAllConfirm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const showToast = (
    message: string,
    type: "success" | "error" = "success",
  ) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    loadMemories({ sortBy, sortOrder });
    loadWeights();
    loadSystemStats();
  }, [loadMemories, loadWeights, loadSystemStats, sortBy, sortOrder]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadSystemStats();
    }, 30000);
    return () => clearInterval(interval);
  }, [loadSystemStats]);

  useEffect(() => {
    const params: Parameters<typeof loadMemories>[0] = { sortBy, sortOrder };
    if (typeFilter !== "all") params.type = typeFilter;
    loadMemories(params);
  }, [typeFilter]);

  const handleSearch = (query: string) => {
    if (query.trim()) {
      setIsSearching(true);
      searchMemories({ query, limit: 100 });
    } else {
      setIsSearching(false);
    }
  };

  const handleTagClick = (tag: string) => {
    setTagFilter(tagFilter === tag ? null : tag);
  };

  const handleDelete = async (id: string) => {
    if (confirm(t("memory.confirmDelete"))) {
      await deleteMemory(id);
      showToast(t("memory.deleted"), "success");
    }
  };

  const handleDeleteAll = async () => {
    if (total === 0) return;
    if (deleteAllConfirm !== t("memory.confirmPhrase")) {
      return;
    }
    await deleteAllMemories();
    setDeleteAllConfirm("");
    showToast(t("memory.clearedAll"), "success");
    loadWeights();
    loadSystemStats();
  };

  const handleBatchDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (confirm(t("memory.confirmBatchDelete", { count }))) {
      const deleted = await batchDelete();
      showToast(t("memory.batchDeleted", { count: deleted }), "success");
    }
  };

  const handleEditStart = (memory: Memory) => {
    setEditMemory(memory);
    setEditContent(memory.content);
    setEditType(memory.type);
    setEditTags(memory.tags.join(", "));
    setEditWeight(memory.weight);
  };

  const handleEditSave = async () => {
    if (!editMemory) return;
    const tags = editTags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    await updateMemory(editMemory.id, {
      content: editContent,
      type: editType,
      tags,
      weight: editWeight,
    } as Partial<Memory>);
    await loadMemories({ sortBy, sortOrder });
    setEditMemory(null);
    showToast(t("memory.updated"), "success");
  };

  const handleEditCancel = () => {
    setEditMemory(null);
  };

  const handleCreate = async (data: {
    type: MemoryType;
    content: string;
    tags: string[];
    weight: number;
  }) => {
    const mem = await createMemory({
      type: data.type,
      content: data.content,
      summary: data.content.slice(0, 100),
      weight: data.weight,
      tags: data.tags,
      metadata: {},
    });
    if (mem) {
      await loadMemories({ sortBy, sortOrder });
      await loadWeights();
      await loadSystemStats();
      showToast(t("memory.created"), "success");
    }
  };

  const handleImport = async () => {
    if (!importFilePath.trim()) return;
    const path = importFilePath.trim();
    const mem = await importFromFile(path);
    if (mem) {
      setImportFilePath("");
      await loadWeights();
      showToast(t("memory.imported"), "success");
    }
  };

  const handleExport = async () => {
    await exportAllAsJson();
    showToast(t("memory.exported"), "success");
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // 类型筛选 + 标签筛选后的记忆（或搜索结果）
  const displayMemories = isSearching
    ? searchResults.map((r) => r.memory)
    : memories
        .filter((m) => typeFilter === "all" || m.type === typeFilter)
        .filter((m) => !tagFilter || m.tags.includes(tagFilter));

  const isFiltering = typeFilter !== "all" || tagFilter !== null;

  return (
    <div className="max-w-7xl mx-auto w-full p-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 animate-fade-in">
          <div
            className={`px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${
              toast.type === "success"
                ? "bg-green-500 text-white"
                : "bg-red-500 text-white"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      {/* 加载指示器 */}
      {isLoading && (
        <div className="fixed top-0 left-0 right-0 h-0.5 z-50 bg-blue-500/30">
          <div className="h-full bg-blue-500 animate-loading-bar" />
        </div>
      )}

      <div className="flex items-center justify-end mb-6">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateDialog(true)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isDark
                ? "bg-blue-700 hover:bg-blue-600 text-white"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            + {t("memory.createMemory")}
          </button>
          <button
            onClick={handleExport}
            disabled={total === 0}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              total === 0
                ? "bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                : isDark
                  ? "bg-green-700 hover:bg-green-600 text-white"
                  : "bg-green-500 hover:bg-green-600 text-white"
            }`}
          >
            {t("memory.exportJson")}
          </button>
          <button
            onClick={() => {
              if (isBatchMode) {
                clearSelection();
              } else {
                selectAllMemories();
              }
            }}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isDark
                ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
                : "bg-gray-200 hover:bg-gray-300 text-gray-700"
            }`}
          >
            {isBatchMode ? t("memory.exitBatch") : t("memory.batchMode")}
          </button>
          {isBatchMode && selectedIds.size > 0 && (
            <button
              onClick={handleBatchDelete}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white transition-colors"
            >
              {t("memory.deleteSelected", { count: selectedIds.size })}
            </button>
          )}
          {!isBatchMode && (
            <button
              onClick={() => {
                if (total === 0) return;
                // 使用自定义确认弹窗替代 confirm()
                setDeleteAllConfirm("");
                const modal = document.createElement("dialog");
                modal.className = isDark
                  ? "bg-gray-800 text-gray-100"
                  : "bg-white text-gray-900";
                // 使用简单的 confirm + 输入确认文字
                const phrase = t("memory.confirmPhrase");
                const confirmed = confirm(
                  t("memory.confirmAllPrompt", { count: total, phrase }),
                );
                if (confirmed) {
                  const input = prompt(
                    t("memory.confirmPhrasePrompt", { phrase }),
                  );
                  if (input === phrase) {
                    setDeleteAllConfirm(phrase);
                    handleDeleteAll();
                  }
                }
              }}
              disabled={total === 0}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                total === 0
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                  : "bg-red-500 hover:bg-red-600 text-white"
              }`}
            >
              {t("memory.clearAllAction")}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${isDark ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-red-50 text-red-600 border border-red-200"}`}
        >
          {error}
        </div>
      )}

      {/* 导入面板 */}
      <div
        className={`mb-4 p-3 rounded-lg border flex items-center gap-3 ${
          isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
        }`}
      >
        <span
          className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
        >
          {t("memory.importFromFileLabel")}
        </span>
        <input
          type="text"
          value={importFilePath}
          onChange={(e) => setImportFilePath(e.target.value)}
          placeholder={t("memory.importPathPlaceholder")}
          className={`flex-1 px-3 py-1.5 rounded text-sm border ${
            isDark
              ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
              : "bg-white border-gray-300 text-gray-900 placeholder-gray-500"
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
        />
        <button
          onClick={handleImport}
          disabled={!importFilePath.trim() || isImporting}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            !importFilePath.trim() || isImporting
              ? "bg-gray-400 text-white cursor-not-allowed"
              : isDark
                ? "bg-indigo-700 hover:bg-indigo-600 text-white"
                : "bg-indigo-500 hover:bg-indigo-600 text-white"
          }`}
        >
          {isImporting ? t("memory.importing") : t("common.import")}
        </button>
      </div>

      <MemorySearch isDark={isDark} onSearch={handleSearch} />

      {/* 排序 & 筛选 */}
      <div className="flex items-center justify-between mt-4 mb-4">
        <div className="flex items-center gap-3">
          {!isSearching && (
            <>
              <select
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as MemoryType | "all")
                }
                className={`px-3 py-2 rounded-lg text-sm border ${
                  isDark
                    ? "bg-gray-700 border-gray-600 text-white"
                    : "bg-white border-gray-300 text-gray-700"
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              >
                <option value="all">{t("memory.allTypes")}</option>
                {Object.entries(TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(
                    e.target.value as "createdAt" | "updatedAt" | "weight",
                  )
                }
                className={`px-3 py-2 rounded-lg text-sm border ${
                  isDark
                    ? "bg-gray-700 border-gray-600 text-white"
                    : "bg-white border-gray-300 text-gray-700"
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              >
                <option value="updatedAt">{t("memory.sortByUpdated")}</option>
                <option value="createdAt">{t("memory.sortByCreated")}</option>
                <option value="weight">{t("memory.sortByWeight")}</option>
              </select>
              <button
                onClick={() =>
                  setSortOrder(sortOrder === "desc" ? "asc" : "desc")
                }
                className={`px-3 py-2 rounded-lg text-sm border ${
                  isDark
                    ? "bg-gray-700 border-gray-600 text-white"
                    : "bg-white border-gray-300 text-gray-700"
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              >
                {sortOrder === "desc"
                  ? t("memory.sortDesc")
                  : t("memory.sortAsc")}
              </button>
            </>
          )}
          {isBatchMode && (
            <div className="flex items-center gap-2">
              <button
                onClick={selectAllMemories}
                className={`text-xs ${isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-500"}`}
              >
                {t("memory.selectAll")}
              </button>
              <button
                onClick={clearSelection}
                className={`text-xs ${isDark ? "text-gray-400 hover:text-gray-300" : "text-gray-500 hover:text-gray-400"}`}
              >
                {t("memory.deselect")}
              </button>
            </div>
          )}
        </div>
        <span
          className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
        >
          {isFiltering
            ? t("memory.filterPrefix", { count: displayMemories.length })
            : ""}
          {t("memory.totalLabel", { count: total })}
        </span>
      </div>

      {/* 主内容区 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <MemoryList
            memories={displayMemories}
            isDark={isDark}
            onSelect={setSelectedMemory}
            selectedId={selectedMemory?.id}
            onDelete={handleDelete}
            onEdit={handleEditStart}
            selectedIds={selectedIds}
            isBatchMode={isBatchMode}
            onToggleSelect={toggleSelectMemory}
            onTogglePin={togglePinMemory}
            onTagClick={handleTagClick}
          />
        </div>

        <div className="space-y-4">
          <MemoryWeightChart weights={weights} isDark={isDark} />
          <MemorySyncingStatus
            stats={systemStats}
            isDark={isDark}
            isCleaning={isCleaning}
            isConsolidating={isConsolidating}
            isDreaming={isDreaming}
            onCleanup={triggerCleanup}
            onConsolidate={triggerConsolidate}
            onDream={triggerDream}
            dreamBusyMessage={dreamBusyMessage}
          />
        </div>
      </div>

      {/* 记忆详情面板 */}
      {selectedMemory && !isBatchMode && (
        <div
          className={`mt-6 p-4 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    isDark
                      ? "bg-blue-900/30 text-blue-400"
                      : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {TYPE_LABELS[selectedMemory.type] || selectedMemory.type}
                </span>
                <span
                  className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("memory.weightLabel", { count: selectedMemory.weight })}
                </span>
                {(selectedMemory.metadata?.isPinned as boolean) && (
                  <span className="text-yellow-500 text-xs">
                    {t("memory.pinnedBadge")}
                  </span>
                )}
                {(selectedMemory.metadata?.accessLevel as
                  string | undefined) && (
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      isDark
                        ? "bg-gray-700 text-gray-400"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {selectedMemory.metadata!.accessLevel as string}
                  </span>
                )}
              </div>
              {selectedMemory.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {selectedMemory.tags.map((tag) => (
                    <span
                      key={tag}
                      className={`px-1.5 py-0.5 rounded text-xs ${
                        isDark
                          ? "bg-gray-700 text-gray-300"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <p
                className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {t("memory.createdAtLabel", {
                  date: formatDate(selectedMemory.createdAt),
                })}
                {" · "}
                {t("memory.updatedAtLabel", {
                  date: formatDate(selectedMemory.updatedAt),
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => togglePinMemory(selectedMemory.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  selectedMemory.metadata?.isPinned
                    ? "text-yellow-500"
                    : isDark
                      ? "bg-gray-700 text-gray-400 hover:bg-gray-600"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {selectedMemory.metadata?.isPinned
                  ? t("memory.pinned")
                  : t("memory.pin")}
              </button>
              <button
                onClick={() => handleEditStart(selectedMemory)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  isDark
                    ? "bg-blue-900/30 text-blue-400 hover:bg-blue-800/30"
                    : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                }`}
              >
                {t("common.edit")}
              </button>
              <button
                onClick={() => handleDelete(selectedMemory.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  isDark
                    ? "bg-red-900/30 text-red-400 hover:bg-red-800/30"
                    : "bg-red-50 text-red-600 hover:bg-red-100"
                }`}
              >
                {t("common.delete")}
              </button>
              <button
                onClick={() => setSelectedMemory(null)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  isDark
                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {t("common.close")}
              </button>
            </div>
          </div>
          <div
            className={`mt-4 p-4 rounded-lg ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
          >
            <h4
              className={`text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              {t("memory.contentTitle")}
            </h4>
            <p
              className={`text-sm whitespace-pre-wrap ${isDark ? "text-gray-300" : "text-gray-700"}`}
            >
              {selectedMemory.content}
            </p>
          </div>
          {selectedMemory.summary && (
            <div
              className={`mt-4 p-4 rounded-lg ${isDark ? "bg-gray-900" : "bg-blue-50"}`}
            >
              <h4
                className={`text-sm font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {t("memory.summary")}
              </h4>
              <p
                className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                {selectedMemory.summary}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 编辑弹窗 */}
      {editMemory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className={`w-full max-w-2xl mx-4 p-6 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
          >
            <h2
              className={`text-lg font-semibold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              {t("memory.editMemory")}
            </h2>

            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label
                    className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {t("memory.typeLabel")}
                  </label>
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as MemoryType)}
                    className={`w-full px-3 py-2 rounded-lg text-sm border ${
                      isDark
                        ? "bg-gray-700 border-gray-600 text-white"
                        : "bg-white border-gray-300 text-gray-700"
                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  >
                    {Object.entries(TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-48">
                  <label
                    className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {t("memory.weightValue", { count: editWeight })}
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={editWeight}
                    onChange={(e) => setEditWeight(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </div>
              </div>

              <div>
                <label
                  className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("memory.tagsLabel")}
                </label>
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg text-sm border ${
                    isDark
                      ? "bg-gray-700 border-gray-600 text-white"
                      : "bg-white border-gray-300 text-gray-700"
                  } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                />
              </div>

              <div>
                <label
                  className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("memory.content")}
                </label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={8}
                  className={`w-full p-3 rounded-lg text-sm border resize-y ${
                    isDark
                      ? "bg-gray-700 border-gray-600 text-white focus:border-blue-500"
                      : "bg-white border-gray-300 text-gray-900 focus:border-blue-500"
                  } focus:outline-none focus:ring-2 focus:ring-blue-500/20`}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={handleEditCancel}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  isDark
                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleEditSave}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white"
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 创建记忆弹窗 */}
      <MemoryCreateDialog
        isDark={isDark}
        isOpen={showCreateDialog}
        isCreating={false}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}

export default MemoryPage;
