import { useState, useEffect, useCallback } from "react";
import { useKnowledgeStore } from "../../stores/knowledgeStore";
import { useConfigStore } from "../../stores/configStore";
import { knowledgeService } from "../../services/knowledgeService";
import type { KnowledgeFile, KnowledgeSearchResult } from "../../types";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:knowledge");
import KnowledgeBaseList from "../Knowledge/KnowledgeBaseList";
import KnowledgeEditor from "../Knowledge/KnowledgeEditor";
import PendingCompilePanel from "../Knowledge/PendingCompilePanel";
import SemanticIndexPage from "./SemanticIndexPage";
import { formatFileSize, formatDateTime } from "../Knowledge/shared/utils";
import { sourceLabels } from "../Knowledge/shared/constants";
import SearchPanel from "../Knowledge/SearchPanel";
import StatsPanel from "../Knowledge/StatsPanel";
import VersionHistory from "../Knowledge/VersionHistory";
import MarkdownRenderer from "../ChatArea/MarkdownRenderer";

type ActiveTab = "knowledge" | "search-demo" | "stats" | "semantic";

function KnowledgePage() {
  const store = useKnowledgeStore();
  const { items, loadItems } = store;
  const { config } = useConfigStore();
  const isDark = config.theme === "dark";

  const [activeTab, setActiveTab] = useState<ActiveTab>("knowledge");
  const [selectedBase, setSelectedBase] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<KnowledgeFile | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  const [demoQuery, setDemoQuery] = useState("");
  const [demoResults, setDemoResults] = useState<KnowledgeSearchResult[]>([]);
  const [isDemoSearching, setIsDemoSearching] = useState(false);
  const [demoSearchDone, setDemoSearchDone] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [editTagsInput, setEditTagsInput] = useState("");
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const bgClass = isDark ? "bg-gray-900" : "bg-gray-50";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const inputBg = isDark
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "bg-white border-gray-300 text-gray-900 placeholder-gray-400";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";

  // 仅在 stats Tab 激活时加载统计所需数据
  useEffect(() => {
    if (activeTab === "stats") {
      loadItems();
    }
  }, [activeTab, loadItems]);

  function handleSelectBase(baseName: string | null) {
    setSelectedBase(baseName);
    setSelectedFile(null);
    setIsEditing(false);
  }

  function handleSelectFile(file: KnowledgeFile) {
    if (selectedFile?.id === file.id) return;
    setSelectedFile(file);
    setIsEditing(false);
    setEditTitle(file.title);
    setEditContent(file.content);
  }

  function handleSearchResultClick(result: { id: string; title: string; content: string; category?: string }) {
    const file: KnowledgeFile = {
      id: result.id,
      title: result.title,
      content: result.content,
      category: result.category || "知识库",
      tags: [],
      docPath: "",
      base: "",
      size: 0,
      source: "manual" as const,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    setActiveTab("knowledge");
    setSelectedFile(file);
    setIsEditing(false);
    setEditTitle(result.title);
    setEditContent(result.content);
    // 延迟滚动到编辑器（等 DOM 渲染）
    setTimeout(() => {
      const el = document.querySelector('[data-editor-textarea]');
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }

  function startEditing() {
    if (!selectedFile) return;
    setIsEditing(true);
    setEditTitle(selectedFile.title);
    setEditContent(selectedFile.content);
  }

  async function handleSaveTags() {
    if (!selectedFile) return;
    const tags = editTagsInput
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      await knowledgeService.updateDoc(
        selectedFile.id,
        selectedFile.content,
        selectedFile.title,
        { tags },
      );
      setSelectedFile({ ...selectedFile, tags });
      setEditingTags(false);
    } catch (err) {
      logger.error("保存标签失败", err);
    }
  }

  async function handleExportToNotebook() {
    if (!selectedFile) return;
    try {
      const result = await knowledgeService.exportToNotebook(
        selectedFile.docPath || selectedFile.id,
        selectedFile.title,
      );
      setNotification({
        type: "success",
        message: `已导出到 Notebook: ${result.fileName}`,
      });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      setNotification({
        type: "error",
        message: `导出失败: ${err instanceof Error ? err.message : String(err)}`,
      });
      setTimeout(() => setNotification(null), 3000);
    }
  }

  function startEditTags() {
    if (!selectedFile) return;
    setEditTagsInput(selectedFile.tags?.join(", ") || "");
    setEditingTags(true);
  }

  async function handleSaveEdit(title: string, content: string) {
    if (!selectedFile) return;

    const docPath = selectedFile.id;
    try {
      await knowledgeService.updateDoc(docPath, content, title);
      setSelectedFile({
        ...selectedFile,
        title,
        content,
        updated_at: Date.now(),
      });
      setIsEditing(false);
    } catch (err) {
      logger.error("保存失败", err);
    }
  }

  async function handleDeleteFile() {
    if (!selectedFile) return;
    const docPath = selectedFile.id;
    try {
      await knowledgeService.delete(docPath);
      setSelectedFile(null);
      setIsEditing(false);
    } catch (err) {
      logger.error("删除失败", err);
    }
  }

  function cancelEditing() {
    setIsEditing(false);
    if (selectedFile) {
      setEditTitle(selectedFile.title);
      setEditContent(selectedFile.content);
    }
  }

  const handleDemoSearch = useCallback(async (domain?: string) => {
    if (!demoQuery.trim()) return;
    setIsDemoSearching(true);
    setDemoSearchDone(false);
    try {
      const results = await knowledgeService.hybridSearch(
        demoQuery.trim(),
        selectedBase || undefined,
        domain,
      );
      setDemoResults(results);
    } catch {
      setDemoResults([]);
    }
    setIsDemoSearching(false);
    setDemoSearchDone(true);
  }, [demoQuery, selectedBase]);

  const tabs: { key: ActiveTab; label: string }[] = [
    { key: "knowledge", label: "知识库" },
    { key: "search-demo", label: "检索演示" },
    { key: "semantic", label: "语义索引" },
    { key: "stats", label: "知识统计" },
  ];



  return (
    <div className={`flex-1 overflow-y-auto ${bgClass}`}>
      <div className="h-full flex flex-col">
        {/* 标签导航 */}
        <div
          className={`flex items-center justify-between px-6 py-3 border-b ${borderColor} flex-shrink-0`}
        >
          <div className="flex gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`text-sm font-medium transition-colors pb-1 border-b-2 ${
                  activeTab === tab.key
                    ? "border-blue-500 text-blue-500"
                    : `border-transparent ${textSecondary} hover:text-gray-700 dark:hover:text-gray-300`
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ========== 标签1: 知识库（双栏工作台） ========== */}
        {activeTab === "knowledge" && (
          <div className="flex-1 flex overflow-hidden">
            {/* 左侧：知识库列表 */}
            <div className="w-80 lg:w-96 flex-shrink-0 border-r ${borderColor} flex flex-col overflow-hidden">
              <div className="overflow-y-auto flex-1">
                <KnowledgeBaseList
                  isDark={isDark}
                  selectedBase={selectedBase}
                  onSelectBase={handleSelectBase}
                  onSelectFile={handleSelectFile}
                  selectedFileId={selectedFile?.id || null}
                  externalSearchQuery={searchQuery}
                />
              </div>
              <PendingCompilePanel
                isDark={isDark}
                onCompileComplete={() => {
                  loadItems();
                }}
              />
            </div>

            {/* 右侧：文件预览/编辑 */}
            <div className="flex-1 overflow-y-auto">
              {!selectedFile ? (
                <div
                  className={`flex items-center justify-center h-full ${textSecondary}`}
                >
                  <div className="text-center">
                    <svg
                      className="w-16 h-16 mx-auto mb-4 opacity-30"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <p className="text-sm">选择一个知识文档查看详情</p>
                    <p className="text-xs mt-1 opacity-60">
                      左侧列表列出了当前知识库下的所有文档
                    </p>
                    <div className="flex items-center justify-center gap-3 mt-4">
                      <button
                        onClick={() => setActiveTab("search-demo")}
                        className="px-3 py-1.5 text-xs border rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        检索知识
                      </button>
                      <button
                        onClick={() => {
                          const el = document.querySelector<HTMLButtonElement>(
                            '[data-testid="file-upload-trigger"]'
                          );
                          el?.click();
                        }}
                        className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                      >
                        上传文档
                      </button>
                      <button
                        onClick={() => setActiveTab("stats")}
                        className="px-3 py-1.5 text-xs border rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        查看统计
                      </button>
                    </div>
                  </div>
                </div>
              ) : isEditing ? (
                <KnowledgeEditor
                  title={editTitle}
                  content={editContent}
                  isDark={isDark}
                  onSave={handleSaveEdit}
                  onCancel={cancelEditing}
                />
              ) : (
                <div className="p-6 max-w-3xl mx-auto">
                  {/* 操作通知 */}
                  {notification && (
                    <div
                      className={`mb-4 px-4 py-2 rounded-md text-sm ${
                        notification.type === "success"
                          ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800"
                          : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
                      }`}
                    >
                      {notification.message}
                    </div>
                  )}
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex-1 min-w-0">
                      <h2
                        className={`text-xl font-bold ${textPrimary} break-words`}
                      >
                        {selectedFile.title || "未命名文档"}
                      </h2>
                      <div className="flex items-center gap-3 mt-2">
                        <span className={`text-xs ${textSecondary}`}>
                          {formatFileSize(selectedFile.size)}
                        </span>
                        <span className={`text-xs ${textSecondary}`}>
                          更新于 {formatDateTime(selectedFile.updated_at)}
                        </span>
                        {selectedFile.source && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              isDark
                                ? "bg-gray-700 text-gray-300"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {sourceLabels[selectedFile.source] ||
                              selectedFile.source}
                          </span>
                        )}
                        {selectedFile.base && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              isDark
                                ? "bg-blue-900/30 text-blue-400"
                                : "bg-blue-50 text-blue-600"
                            }`}
                          >
                            {selectedFile.base}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                      <button
                        onClick={handleExportToNotebook}
                        title="导出为 Notebook 兼容的 Markdown 文件"
                        className="px-3 py-1.5 text-sm text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-md hover:bg-green-50 dark:hover:bg-green-900/30"
                      >
                        导出到 Notebook
                      </button>
                      <button
                        onClick={startEditing}
                        className="px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/30"
                      >
                        编辑
                      </button>
                      <button
                        onClick={handleDeleteFile}
                        className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30"
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  <div
                    className="prose prose-sm max-w-none dark:prose-invert"
                  >
                    {selectedFile.content ? (
                      <MarkdownRenderer content={selectedFile.content} />
                    ) : (
                      <span className="text-gray-400">（无内容）</span>
                    )}
                  </div>

                  {selectedFile.title && (
                    <VersionHistory
                      isDark={isDark}
                      title={selectedFile.title}
                      currentContent={selectedFile.content}
                      onRestored={() => {
                        // 恢复后重新加载选中文档
                        setEditTitle(selectedFile.title);
                        setEditContent(selectedFile.content);
                      }}
                    />
                  )}

                  <div className={`mt-8 pt-4 border-t ${borderColor}`}>
                    <h4 className={`text-sm font-medium ${textPrimary} mb-2`}>
                      详细信息
                    </h4>
                    <div
                      className={`grid grid-cols-2 gap-2 text-xs ${textSecondary}`}
                    >
                      <div>文档路径: {selectedFile.docPath}</div>
                      <div>
                        来源:{" "}
                        {sourceLabels[selectedFile.source] ||
                          selectedFile.source ||
                          "未知"}
                      </div>
                      {selectedFile.updated_at > 0 && (
                        <div>
                          最后更新: {formatDateTime(selectedFile.updated_at)}
                        </div>
                      )}
                      {selectedFile.category && (
                        <div>分类: {selectedFile.category}</div>
                      )}
                    </div>

                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className={`text-xs font-medium ${textSecondary}`}
                        >
                          标签
                        </span>
                        {!editingTags &&
                          selectedFile.tags &&
                          selectedFile.tags.length > 0 && (
                            <button
                              onClick={startEditTags}
                              className={`text-[10px] ${textSecondary} hover:${isDark ? "text-gray-300" : "text-gray-700"}`}
                            >
                              编辑
                            </button>
                          )}
                      </div>

                      {editingTags ? (
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            value={editTagsInput}
                            onChange={(e) => setEditTagsInput(e.target.value)}
                            placeholder="输入标签，用逗号分隔"
                            className={`w-full px-2 py-1 text-xs border rounded ${inputBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSaveTags();
                              }
                              if (e.key === "Escape") setEditingTags(false);
                            }}
                            autoFocus
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleSaveTags}
                              className="px-2 py-0.5 text-[10px] bg-blue-600 text-white rounded"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => setEditingTags(false)}
                              className={`px-2 py-0.5 text-[10px] ${textSecondary} hover:${isDark ? "text-gray-300" : "text-gray-700"}`}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedFile.tags && selectedFile.tags.length > 0 ? (
                            selectedFile.tags.map((tag, idx) => (
                              <button
                                key={idx}
                                onClick={() => {
                                  setActiveTab("knowledge");
                                  // 通过 searchQuery 传递标签筛选
                                  setSearchQuery(tag);
                                }}
                                title={`点击筛选标签: ${tag}`}
                                className={`px-2 py-0.5 text-[10px] rounded-full cursor-pointer transition-colors ${
                                  isDark
                                    ? "bg-blue-900/30 text-blue-400 hover:bg-blue-800/40"
                                    : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                                }`}
                              >
                                {tag}
                              </button>
                            ))
                          ) : (
                            <button
                              onClick={startEditTags}
                              className={`text-[10px] ${textSecondary} px-2 py-0.5 rounded border border-dashed ${borderColor} hover:opacity-80`}
                            >
                              + 添加标签
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========== 标签2: 检索演示 ========== */}
        {activeTab === "search-demo" && (
          <SearchPanel
            isDark={isDark}
            demoQuery={demoQuery}
            onQueryChange={setDemoQuery}
            onSearch={handleDemoSearch}
            isSearching={isDemoSearching}
            results={demoResults}
            searchDone={demoSearchDone}
            onResultClick={handleSearchResultClick}
          />
        )}

        {/* ========== 语义索引 ========== */}
        {activeTab === "semantic" && (
          <div className="flex-1 overflow-y-auto">
            <SemanticIndexPage />
          </div>
        )}

        {/* ========== 标签3: 知识统计 ========== */}
        {activeTab === "stats" && (
          <StatsPanel
            isDark={isDark}
            items={items}
            demoSearchDone={demoSearchDone}
            demoResultCount={demoResults.length}
          />
        )}
      </div>
    </div>
  );
}

export default KnowledgePage;
