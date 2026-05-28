import { useState, useEffect, useRef } from 'react';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { useConfigStore } from '../../stores/configStore';

type TabType = 'documents' | 'categories' | 'rag' | 'test';

interface KnowledgeCategory {
  id: string;
  name: string;
  description: string;
  count: number;
}

function KnowledgeEnhancedPage() {
  const { items, loadItems, isLoading } = useKnowledgeStore();
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === 'dark';

  const [activeTab, setActiveTab] = useState<TabType>('documents');
  const [categories] = useState<KnowledgeCategory[]>([
    { id: '1', name: '技术文档', description: '技术相关文档', count: 12 },
    { id: '2', name: '产品说明', description: '产品手册和指南', count: 8 },
    { id: '3', name: '常见问题', description: 'FAQ 文档', count: 5 },
    { id: '4', name: '内部知识', description: '内部知识库', count: 15 },
  ]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [ragConfig, setRagConfig] = useState({
    enabled: true,
    chunkSize: 1000,
    chunkOverlap: 200,
    retrievalLimit: 5,
    rerankEnabled: false,
  });
  const [testQuery, setTestQuery] = useState('');
  const [testResults, setTestResults] = useState<any[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadItems();
    loadConfig();
  }, [loadItems, loadConfig]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setUploadProgress(0);
    const totalFiles = files.length;
    let completed = 0;

    for (let i = 0; i < totalFiles; i++) {
      await new Promise((resolve) => {
        setTimeout(() => {
          completed++;
          setUploadProgress(Math.round((completed / totalFiles) * 100));
          resolve(null);
        }, 500);
      });
    }

    setUploadProgress(null);
  };

  const handleTestSearch = async () => {
    if (!testQuery.trim()) return;
    setIsTesting(true);
    setTestResults([]);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const mockResults = items
      .filter((item) =>
        item.title.toLowerCase().includes(testQuery.toLowerCase()) ||
        item.content.toLowerCase().includes(testQuery.toLowerCase())
      )
      .slice(0, ragConfig.retrievalLimit)
      .map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content.substring(0, 200) + '...',
        score: Math.random() * 0.3 + 0.7,
      }));

    setTestResults(mockResults);
    setIsTesting(false);
  };

  const tabs: { key: TabType; label: string }[] = [
    { key: 'documents', label: '文档管理' },
    { key: 'categories', label: '分类管理' },
    { key: 'rag', label: 'RAG 配置' },
    { key: 'test', label: '检索测试' },
  ];

  return (
    <div className={`flex-1 overflow-hidden flex flex-col ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-6xl mx-auto w-full p-6">
        <div className="mb-6">
          <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
            知识库增强
          </h1>
          <p className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            知识库文档管理、分类配置和 RAG 检索增强
          </p>
        </div>

        <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-500'
                  : isDark
                  ? 'border-transparent text-gray-400 hover:text-gray-300'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'documents' && (
          <div className="space-y-4">
            <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-4`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-lg font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                  文档上传
                </h3>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  选择文件
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".md,.txt,.pdf,.doc,.docx,.html"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e.target.files)}
                />
              </div>

              {uploadProgress !== null && (
                <div className="mb-4">
                  <div className={`text-sm mb-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    上传进度: {uploadProgress}%
                  </div>
                  <div className={`w-full h-2 rounded-full ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                支持格式: Markdown, TXT, PDF, Word, HTML
              </div>
            </div>

            <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <h3 className={`text-lg font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                  文档列表
                </h3>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {isLoading ? (
                  <div className="p-4 text-center text-gray-400">加载中...</div>
                ) : items.length === 0 ? (
                  <div className="p-4 text-center text-gray-400">暂无文档</div>
                ) : (
                  items.slice(0, 10).map((item) => (
                    <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <h4 className={`font-medium truncate ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                          {item.title}
                        </h4>
                        <p className={`text-xs truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {item.content.substring(0, 100)}...
                        </p>
                      </div>
                      <span className={`ml-4 px-2 py-0.5 text-xs rounded-full ${
                        isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {(item.tags || []).slice(0, 2).join(', ')}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                新增分类
              </button>
            </div>

            <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className={`px-4 py-3 flex items-center justify-between cursor-pointer ${
                      selectedCategory === cat.id
                        ? isDark
                          ? 'bg-gray-700/50'
                          : 'bg-gray-50'
                        : ''
                    }`}
                    onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                  >
                    <div>
                      <h4 className={`font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        {cat.name}
                      </h4>
                      <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {cat.description}
                      </p>
                    </div>
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {cat.count} 篇
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'rag' && (
          <div className="space-y-4">
            <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-4`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-lg font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                  RAG 检索增强配置
                </h3>
                <button
                  onClick={() => setRagConfig({ ...ragConfig, enabled: !ragConfig.enabled })}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    ragConfig.enabled ? 'bg-blue-500' : isDark ? 'bg-gray-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      ragConfig.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    分块大小 (Chunk Size)
                  </label>
                  <input
                    type="number"
                    value={ragConfig.chunkSize}
                    onChange={(e) => setRagConfig({ ...ragConfig, chunkSize: parseInt(e.target.value, 10) || 1000 })}
                    className={`w-32 px-3 py-1.5 text-sm border rounded ${
                      isDark
                        ? 'bg-gray-700 border-gray-600 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  />
                  <span className={`ml-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    文档分块时每个块包含的字符数
                  </span>
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    块重叠 (Chunk Overlap)
                  </label>
                  <input
                    type="number"
                    value={ragConfig.chunkOverlap}
                    onChange={(e) => setRagConfig({ ...ragConfig, chunkOverlap: parseInt(e.target.value, 10) || 200 })}
                    className={`w-32 px-3 py-1.5 text-sm border rounded ${
                      isDark
                        ? 'bg-gray-700 border-gray-600 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  />
                  <span className={`ml-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    相邻块之间的重叠字符数
                  </span>
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    检索数量限制
                  </label>
                  <input
                    type="number"
                    value={ragConfig.retrievalLimit}
                    onChange={(e) => setRagConfig({ ...ragConfig, retrievalLimit: parseInt(e.target.value, 10) || 5 })}
                    className={`w-32 px-3 py-1.5 text-sm border rounded ${
                      isDark
                        ? 'bg-gray-700 border-gray-600 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  />
                  <span className={`ml-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    每次检索返回的最相关文档数量
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setRagConfig({ ...ragConfig, rerankEnabled: !ragConfig.rerankEnabled })}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      ragConfig.rerankEnabled ? 'bg-blue-500' : isDark ? 'bg-gray-600' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        ragConfig.rerankEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    启用 Rerank 重排序
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'test' && (
          <div className="space-y-4">
            <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-4`}>
              <h3 className={`text-lg font-medium mb-4 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                检索测试
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={testQuery}
                  onChange={(e) => setTestQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTestSearch()}
                  placeholder="输入检索 query..."
                  className={`flex-1 px-3 py-2 border rounded-lg ${
                    isDark
                      ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                  }`}
                />
                <button
                  onClick={handleTestSearch}
                  disabled={isTesting}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
                >
                  {isTesting ? '检索中...' : '检索'}
                </button>
              </div>
            </div>

            {testResults.length > 0 && (
              <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <h3 className={`text-lg font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    检索结果 ({testResults.length})
                  </h3>
                </div>
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {testResults.map((result) => (
                    <div key={result.id} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className={`font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                          {result.title}
                        </h4>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-700'
                        }`}>
                          相似度: {(result.score * 100).toFixed(1)}%
                        </span>
                      </div>
                      <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {result.content}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default KnowledgeEnhancedPage;