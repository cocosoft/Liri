import { useState, useEffect } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { helpService, mockCategories, mockArticles, HelpArticle } from '../../services/helpService';
import MarkdownRenderer from '../ChatArea/MarkdownRenderer';

function HelpPage() {
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === 'dark';
  const [categories] = useState(mockCategories);
  const [articles, setArticles] = useState(mockArticles);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'list' | 'search'>('list');

  useEffect(() => {
    loadConfig();
    fetchArticles();
  }, [loadConfig]);

  const fetchArticles = async (category?: string) => {
    try {
      const data = await helpService.getArticles(category);
      setArticles(data);
    } catch {
      setArticles(mockArticles);
    }
  };

  const handleCategoryClick = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setSelectedArticle(null);
    fetchArticles(categoryId);
  };

  const handleArticleClick = (article: HelpArticle) => {
    setSelectedArticle(article);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setActiveTab('search');
    try {
      const results = await helpService.searchArticles(searchQuery);
      setArticles(results);
    } catch {
      setArticles(mockArticles.filter((a) =>
        a.title.includes(searchQuery) || a.tags.some((t) => t.includes(searchQuery))
      ));
    }
  };

  const filteredArticles = selectedCategory
    ? articles.filter((a) => a.category === selectedCategory)
    : articles;

  return (
    <div className={`flex-1 overflow-y-auto ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              帮助中心
            </h1>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              查找答案和使用指南
            </p>
          </div>
        </div>

        <div className="flex gap-6">
          <div className={`w-64 flex-shrink-0 ${isDark ? 'bg-gray-800' : 'bg-white'} rounded-lg border ${isDark ? 'border-gray-700' : 'border-gray-200'} p-4`}>
            <h3 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              分类
            </h3>
            <div className="space-y-1">
              <button
                onClick={() => { setSelectedCategory(null); setSelectedArticle(null); setActiveTab('list'); }}
                className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                  !selectedCategory
                    ? 'bg-blue-600 text-white'
                    : isDark
                    ? 'text-gray-300 hover:bg-gray-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                全部
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => handleCategoryClick(category.id)}
                  className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors flex items-center justify-between ${
                    selectedCategory === category.id
                      ? 'bg-blue-600 text-white'
                      : isDark
                      ? 'text-gray-300 hover:bg-gray-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span>{category.icon} {category.name}</span>
                  <span className={`text-xs ${selectedCategory === category.id ? 'text-blue-200' : isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {category.articleCount}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1">
            <div className={`${isDark ? 'bg-gray-800' : 'bg-white'} rounded-lg border ${isDark ? 'border-gray-700' : 'border-gray-200'} p-4 mb-4`}>
              <div className="flex gap-2">
                <div className={`flex-1 relative ${isDark ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg`}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="搜索帮助文章..."
                    className={`w-full px-4 py-2 text-sm outline-none ${isDark ? 'bg-transparent text-white placeholder-gray-400' : 'bg-transparent text-gray-900 placeholder-gray-500'}`}
                  />
                  <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <button
                  onClick={handleSearch}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg"
                >
                  搜索
                </button>
              </div>
            </div>

            <div className={`${isDark ? 'bg-gray-800' : 'bg-white'} rounded-lg border ${isDark ? 'border-gray-700' : 'border-gray-200'} p-4`}>
              {selectedArticle ? (
                <div>
                  <button
                    onClick={() => setSelectedArticle(null)}
                    className={`mb-4 px-3 py-1 text-sm rounded-lg ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                  >
                    ← 返回列表
                  </button>
                  <div className={`prose max-w-none ${isDark ? 'prose-invert' : ''}`}>
                    <MarkdownRenderer content={selectedArticle.content} />
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    {selectedArticle.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`px-2 py-1 text-xs rounded-full ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}
                      >
                        {tag}
                      </span>
                    ))}
                    <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'} ml-auto`}>
                      更新于: {selectedArticle.lastUpdated}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {selectedCategory
                      ? categories.find((c) => c.id === selectedCategory)?.name + ' - 文章列表'
                      : activeTab === 'search'
                      ? '搜索结果'
                      : '所有文章'}
                  </h3>
                  {filteredArticles.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">暂无文章</p>
                  ) : (
                    filteredArticles.map((article) => (
                      <button
                        key={article.id}
                        onClick={() => handleArticleClick(article)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          isDark
                            ? 'border-gray-700 hover:bg-gray-700/50'
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <h4 className={`font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                          {article.title}
                        </h4>
                        <p className={`text-sm mt-1 line-clamp-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {article.content.replace(/[#`*]/g, '').substring(0, 100)}...
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            {categories.find((c) => c.id === article.category)?.icon}{' '}
                            {categories.find((c) => c.id === article.category)?.name}
                          </span>
                          <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            {article.lastUpdated}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HelpPage;