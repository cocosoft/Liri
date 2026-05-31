import { useState, useEffect, useCallback } from 'react';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { useConfigStore } from '../../stores/configStore';
import { knowledgeService } from '../../services/knowledgeService';
import type { KnowledgeFile, KnowledgeSearchResult } from '../../types';
import KnowledgeBaseList from '../Knowledge/KnowledgeBaseList';
import KnowledgeEditor from '../Knowledge/KnowledgeEditor';
import PendingCompilePanel from '../Knowledge/PendingCompilePanel';
import { SkeletonCard } from '../common/Skeleton';

type ActiveTab = 'knowledge' | 'search-demo' | 'stats';

function KnowledgePage() {
  const store = useKnowledgeStore();
  const { items, loadItems } = store;
  const { config } = useConfigStore();
  const isDark = config.theme === 'dark';

  const [activeTab, setActiveTab] = useState<ActiveTab>('knowledge');
  const [selectedBase, setSelectedBase] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<KnowledgeFile | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  const [demoQuery, setDemoQuery] = useState('');
  const [demoResults, setDemoResults] = useState<KnowledgeSearchResult[]>([]);
  const [isDemoSearching, setIsDemoSearching] = useState(false);
  const [demoSearchDone, setDemoSearchDone] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [editTagsInput, setEditTagsInput] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const bgClass = isDark ? 'bg-gray-900' : 'bg-gray-50';
  const cardBg = isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const textPrimary = isDark ? 'text-gray-100' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-500';
  const inputBg = isDark
    ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400';
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200';
  const dividerColor = isDark ? 'divide-gray-700' : 'divide-gray-100';

  useEffect(() => {
    loadItems();
  }, [loadItems]);

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
      await knowledgeService.updateDoc(selectedFile.id, selectedFile.content, selectedFile.title, { tags });
      setSelectedFile({ ...selectedFile, tags });
      setEditingTags(false);
    } catch (err) {
      console.error('保存标签失败', err);
    }
  }

  async function handleExportToNotebook() {
    if (!selectedFile) return;
    try {
      const result = await knowledgeService.exportToNotebook(
        selectedFile.docPath || selectedFile.id,
        selectedFile.title
      );
      setNotification({
        type: 'success',
        message: `已导出到 Notebook: ${result.fileName}`,
      });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      setNotification({
        type: 'error',
        message: `导出失败: ${err instanceof Error ? err.message : String(err)}`,
      });
      setTimeout(() => setNotification(null), 3000);
    }
  }

  function startEditTags() {
    if (!selectedFile) return;
    setEditTagsInput(selectedFile.tags?.join(', ') || '');
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
      console.error('保存失败', err);
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
      console.error('删除失败', err);
    }
  }

  function cancelEditing() {
    setIsEditing(false);
    if (selectedFile) {
      setEditTitle(selectedFile.title);
      setEditContent(selectedFile.content);
    }
  }

  const handleDemoSearch = useCallback(async () => {
    if (!demoQuery.trim()) return;
    setIsDemoSearching(true);
    setDemoSearchDone(false);
    try {
      const results = await knowledgeService.hybridSearch(demoQuery.trim(), selectedBase || undefined);
      setDemoResults(results);
    } catch {
      setDemoResults([]);
    }
    setIsDemoSearching(false);
    setDemoSearchDone(true);
  }, [demoQuery, selectedBase]);

  const totalItems = items.length;
  const totalCategories = new Set(items.flatMap((i) => i.tags || [])).size;
  const recentItems = [...items]
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, 5);

  const tabs: { key: ActiveTab; label: string }[] = [
    { key: 'knowledge', label: '知识库' },
    { key: 'search-demo', label: '检索演示' },
    { key: 'stats', label: '知识统计' },
  ];

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0B';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  function formatDateTime(ts: number): string {
    if (!ts) return '未知';
    return new Date(ts).toLocaleString('zh-CN');
  }

  const sourceLabels: Record<string, string> = {
    manual: '手动创建',
    'auto-memory': '自动记忆',
    upload: '文件上传',
    'chat-save': '聊天保存',
    dream: '梦境生成',
    compiled: 'LLM编译',
  };

  return (
    <div className={`flex-1 overflow-y-auto ${bgClass}`}>
      <div className="h-full flex flex-col">
        {/* 标签导航 */}
        <div className={`flex items-center justify-between px-6 py-3 border-b ${borderColor} flex-shrink-0`}>
          <div className="flex gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`text-sm font-medium transition-colors pb-1 border-b-2 ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-500'
                    : `border-transparent ${textSecondary} hover:text-gray-700 dark:hover:text-gray-300`
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ========== 标签1: 知识库（双栏工作台） ========== */}
        {activeTab === 'knowledge' && (
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
                <div className={`flex items-center justify-center h-full ${textSecondary}`}>
                  <div className="text-center">
                    <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-sm">选择一个知识文档查看详情</p>
                    <p className="text-xs mt-1 opacity-60">左侧列表列出了当前知识库下的所有文档</p>
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
                        notification.type === 'success'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                      }`}
                    >
                      {notification.message}
                    </div>
                  )}
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex-1 min-w-0">
                      <h2 className={`text-xl font-bold ${textPrimary} break-words`}>
                        {selectedFile.title || '未命名文档'}
                      </h2>
                      <div className="flex items-center gap-3 mt-2">
                        <span className={`text-xs ${textSecondary}`}>
                          {formatFileSize(selectedFile.size)}
                        </span>
                        <span className={`text-xs ${textSecondary}`}>
                          更新于 {formatDateTime(selectedFile.updated_at)}
                        </span>
                        {selectedFile.source && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {sourceLabels[selectedFile.source] || selectedFile.source}
                          </span>
                        )}
                        {selectedFile.base && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-600'
                          }`}>
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

                  <div className={`prose prose-sm max-w-none dark:prose-invert ${isDark ? 'text-gray-300' : 'text-gray-700'} whitespace-pre-wrap break-words leading-relaxed`}>
                    {selectedFile.content || '（无内容）'}
                  </div>

                  <div className={`mt-8 pt-4 border-t ${borderColor}`}>
                    <h4 className={`text-sm font-medium ${textPrimary} mb-2`}>详细信息</h4>
                    <div className={`grid grid-cols-2 gap-2 text-xs ${textSecondary}`}>
                      <div>文档路径: {selectedFile.docPath}</div>
                      <div>来源: {sourceLabels[selectedFile.source] || selectedFile.source || '未知'}</div>
                      {selectedFile.updated_at > 0 && (
                        <div>最后更新: {formatDateTime(selectedFile.updated_at)}</div>
                      )}
                      {selectedFile.category && (
                        <div>分类: {selectedFile.category}</div>
                      )}
                    </div>

                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`text-xs font-medium ${textSecondary}`}>标签</span>
                        {!editingTags && selectedFile.tags && selectedFile.tags.length > 0 && (
                          <button
                            onClick={startEditTags}
                            className={`text-[10px] ${textSecondary} hover:${isDark ? 'text-gray-300' : 'text-gray-700'}`}
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
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSaveTags();
                              }
                              if (e.key === 'Escape') setEditingTags(false);
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
                              className={`px-2 py-0.5 text-[10px] ${textSecondary} hover:${isDark ? 'text-gray-300' : 'text-gray-700'}`}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedFile.tags && selectedFile.tags.length > 0 ? (
                            selectedFile.tags.map((tag, idx) => (
                              <span
                                key={idx}
                                className={`px-2 py-0.5 text-[10px] rounded-full ${
                                  isDark
                                    ? 'bg-gray-700 text-gray-300'
                                    : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {tag}
                              </span>
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
        {activeTab === 'search-demo' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              <div className={`${cardBg} rounded-lg p-4`}>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="text"
                    value={demoQuery}
                    onChange={(e) => setDemoQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleDemoSearch()}
                    placeholder="输入检索内容，查看混合搜索效果..."
                    className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inputBg}`}
                  />
                  <button
                    onClick={handleDemoSearch}
                    disabled={isDemoSearching || !demoQuery.trim()}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
                  >
                    {isDemoSearching ? '检索中...' : '检索'}
                  </button>
                </div>
                <p className={`text-xs ${textSecondary}`}>
                  使用 HybridKnowledgeRouter 进行混合检索（关键词匹配 + 语义相似度），结果按相关性评分排序
                </p>
              </div>

              {isDemoSearching && (
                <div className={`${cardBg} rounded-lg p-6`}>
                  <div className="space-y-3">
                    <SkeletonCard count={3} />
                  </div>
                </div>
              )}

              {!isDemoSearching && demoResults.length === 0 && demoSearchDone && (
                <div className={`${cardBg} rounded-lg p-6 text-center ${textSecondary}`}>
                  未找到匹配的知识条目
                </div>
              )}

              {!isDemoSearching && demoResults.length > 0 && (
                <div className={`${cardBg} rounded-lg`}>
                  <div className="px-4 py-3 border-b ${borderColor} flex items-center justify-between">
                    <h3 className={`text-sm font-semibold ${textPrimary}`}>
                      检索结果
                    </h3>
                    <span className={`text-xs ${textSecondary}`}>
                      共 {demoResults.length} 条结果
                    </span>
                  </div>
                  <div className={`divide-y ${dividerColor}`}>
                    {demoResults.map((result, idx) => (
                      <div key={result.id} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className={`text-xs font-mono ${textSecondary} w-5`}>#{idx + 1}</span>
                            <h4 className={`text-sm font-medium ${textPrimary} truncate`}>
                              {result.title}
                            </h4>
                          </div>
                          <div className="flex items-center gap-2 ml-2 shrink-0">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              result.matchType === 'semantic'
                                ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                                : result.matchType === 'keyword'
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                            }`}>
                              {result.matchType === 'semantic' ? '语义' : result.matchType === 'keyword' ? '关键词' : result.matchType}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-mono`}>
                              {(result.score * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        <p className={`text-xs ${textSecondary} line-clamp-2 mt-1`}>
                          {result.content}
                        </p>
                        <div className={`text-xs ${textSecondary} mt-1`}>
                          分类: {result.category || '根目录'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!isDemoSearching && !demoSearchDone && (
                <div className={`${cardBg} rounded-lg p-8 text-center ${textSecondary}`}>
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p className="text-sm">在上方输入关键词后点击「检索」，查看知识库的混合搜索效果</p>
                  <p className="text-xs mt-2">
                    系统会同时使用关键词匹配和语义相似度双通道检索，并显示每条结果的匹配类型和相关性评分
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========== 标签3: 知识统计 ========== */}
        {activeTab === 'stats' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className={`${cardBg} rounded-lg p-4`}>
                  <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>知识库概览</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className={`text-sm ${textSecondary}`}>总条目数</span>
                      <span className={`text-sm font-medium ${textPrimary}`}>{totalItems}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={`text-sm ${textSecondary}`}>标签分类数</span>
                      <span className={`text-sm font-medium ${textPrimary}`}>{totalCategories}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={`text-sm ${textSecondary}`}>检索匹配数</span>
                      <span className={`text-sm font-medium ${textPrimary}`}>
                        {demoSearchDone ? demoResults.length : '-'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className={`${cardBg} rounded-lg p-4`}>
                  <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>关于知识库</h3>
                  <div className="space-y-2 text-sm ${textSecondary}">
                    <p className={textSecondary}>
                      知识库是 AI 助手的「外部记忆」，您添加的知识会在对话中被自动检索和引用。
                    </p>
                    <p className={textSecondary}>
                      系统使用混合检索策略（关键词 + 语义），确保最相关的内容被优先匹配。
                    </p>
                  </div>
                </div>
              </div>

              <div className={`${cardBg} rounded-lg`}>
                <div className="px-4 py-3 border-b ${borderColor}">
                  <h3 className={`text-sm font-semibold ${textPrimary}`}>最近更新</h3>
                </div>
                {recentItems.length === 0 ? (
                  <div className={`px-4 py-6 text-center ${textSecondary} text-sm`}>
                    暂无知识条目
                  </div>
                ) : (
                  <div className={`divide-y ${dividerColor}`}>
                    {recentItems.map((item) => (
                      <div key={item.id} className="px-4 py-2.5 flex items-center justify-between">
                        <span className={`text-sm ${textPrimary} truncate`}>{item.title}</span>
                        <span className={`text-xs ${textSecondary} ml-2 shrink-0`}>
                          {item.updated_at ? new Date(item.updated_at).toLocaleDateString('zh-CN') : '-'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={`${cardBg} rounded-lg p-4`}>
                <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>标签分布</h3>
                {totalCategories === 0 ? (
                  <p className={`text-sm ${textSecondary}`}>暂无标签</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {Array.from(new Set(items.flatMap((i) => i.tags || []))).map((tag) => {
                      const count = items.filter((i) => (i.tags || []).includes(tag)).length;
                      return (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full"
                        >
                          {tag}
                          <span className="text-blue-400 dark:text-blue-500">({count})</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default KnowledgePage;
