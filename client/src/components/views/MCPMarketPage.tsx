import { useState, useEffect, useCallback } from 'react';
import { useConfigStore } from '../../stores/configStore';
import {
  mcpMarketplaceService,
  type SearchResult,
  type InstalledMCPServer,
  type ServerDetail,
} from '../../services/mcpMarketplaceService';
import { MCPMarketDetailModal } from './MCPMarketDetailModal';

const CATEGORIES = [
  { value: '', label: '全部' },
  { value: 'official', label: '官方' },
  { value: 'third_party', label: '第三方' },
];

function MCPMarketPage() {
  const { config } = useConfigStore();
  const isDark = config.theme === 'dark';

  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [installedServers, setInstalledServers] = useState<InstalledMCPServer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [selectedServer, setSelectedServer] = useState<ServerDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const loadInstalledServers = useCallback(async () => {
    try {
      const servers = await mcpMarketplaceService.getInstalledServers();
      setInstalledServers(servers);
    } catch {
    }
  }, []);

  useEffect(() => {
    loadInstalledServers();
  }, [loadInstalledServers]);

  useEffect(() => {
    if (!searchQuery) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const registry = categoryFilter === 'official' ? 'official'
          : categoryFilter === 'third_party' ? 'third_party'
          : undefined;
        const results = await mcpMarketplaceService.search({
          query: searchQuery,
          registry,
        });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, categoryFilter]);

  const isInstalled = (name: string): boolean => {
    return installedServers.some((s) => s.name === name);
  };

  const isEnabled = (name: string): boolean => {
    const server = installedServers.find((s) => s.name === name);
    return server ? server.enabled : false;
  };

  const handleInstall = async (serverId: string) => {
    setInstalling(serverId);
    try {
      await mcpMarketplaceService.install(serverId);
      await loadInstalledServers();
    } catch (error) {
      console.error('安装 MCP 服务器失败:', error);
    } finally {
      setInstalling(null);
    }
  };

  const handleUninstall = async (serverId: string) => {
    if (!window.confirm('确定要卸载这个 MCP 服务器吗？')) {
      return;
    }

    setInstalling(serverId);
    try {
      await mcpMarketplaceService.uninstall(serverId);
      await loadInstalledServers();
    } catch (error) {
      console.error('卸载 MCP 服务器失败:', error);
    } finally {
      setInstalling(null);
    }
  };

  const handleToggle = async (serverId: string, enabled: boolean) => {
    try {
      await mcpMarketplaceService.toggleServer(serverId, enabled);
      await loadInstalledServers();
    } catch (error) {
      console.error('切换 MCP 服务器状态失败:', error);
    }
  };

  const handleShowDetail = async (result: SearchResult) => {
    try {
      const detail = await mcpMarketplaceService.getServerDetail(result.server.name);
      if (detail) {
        setSelectedServer(detail);
        setShowDetail(true);
      }
    } catch {
      console.error('获取 MCP 服务器详情失败');
    }
  };

  const handleCloseDetail = () => {
    setShowDetail(false);
    setSelectedServer(null);
  };

  const getStatusBadge = (name: string) => {
    if (!isInstalled(name)) return null;

    const enabled = isEnabled(name);

    return (
      <span
        className={`px-2 py-0.5 text-xs rounded-full ${
          enabled
            ? isDark
              ? 'bg-green-900/30 text-green-400'
              : 'bg-green-100 text-green-700'
            : isDark
              ? 'bg-gray-700 text-gray-400'
              : 'bg-gray-100 text-gray-600'
        }`}
      >
        {enabled ? '已启用' : '已禁用'}
      </span>
    );
  };

  const getRegistryLabel = (server: SearchResult['server']) => {
    if (server.registry === 'official') {
      return '官方';
    }

    return server.sourceRegistry || '第三方';
  };

  const getRatingStars = (rating: number) => {
    const stars = Math.round(rating);
    return '★'.repeat(stars) + '☆'.repeat(5 - stars);
  };

  return (
    <div className={`flex-1 overflow-y-auto ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              MCP 服务器市场
            </h1>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              浏览和安装 MCP 服务器以扩展 AI 能力
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div
            className={`flex-1 relative ${isDark ? 'bg-gray-800' : 'bg-white'} rounded-lg border ${isDark ? 'border-gray-700' : 'border-gray-300'}`}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 MCP 服务器..."
              className={`w-full px-4 py-2 text-sm outline-none ${isDark ? 'bg-transparent text-white placeholder-gray-400' : 'bg-white text-gray-900 placeholder-gray-500'}`}
            />
            <svg
              className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map((category) => (
              <button
                key={category.value}
                onClick={() => setCategoryFilter(category.value)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  categoryFilter === category.value
                    ? 'bg-blue-600 text-white'
                    : isDark
                      ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
        >
          {loading ? (
            <div className="p-8 text-center text-gray-400">搜索中...</div>
          ) : !searchQuery ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-3">🔌</div>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                输入关键词搜索 MCP 服务器市场
              </p>
              <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                已安装 {installedServers.length} 个服务器
              </p>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              未找到匹配的 MCP 服务器
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {searchResults.map((result) => (
                <div
                  key={`${result.server.registry}:${result.server.name}`}
                  className="px-4 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  onClick={() => handleShowDetail(result)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDark ? 'bg-gray-700' : 'bg-gray-100'}`}
                      >
                        <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div>
                        <h4 className={`font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                          {result.server.title}
                        </h4>
                        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {result.server.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 ml-13 flex items-center gap-4">
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {getRegistryLabel(result.server)}
                      </span>
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        作者: {result.server.author}
                      </span>
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {getRatingStars(result.server.rating)}
                      </span>
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        安装: {result.server.installCount}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-4" onClick={(e) => e.stopPropagation()}>
                    {getStatusBadge(result.server.name)}
                    {isInstalled(result.server.name) ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleToggle(result.server.name, !isEnabled(result.server.name))}
                          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            isEnabled(result.server.name)
                              ? 'bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300'
                              : 'bg-blue-600 hover:bg-blue-700 text-white'
                          }`}
                        >
                          {isEnabled(result.server.name) ? '禁用' : '启用'}
                        </button>
                        <button
                          onClick={() => handleUninstall(result.server.name)}
                          className="px-3 py-1.5 text-sm rounded-lg bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 transition-colors"
                        >
                          卸载
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleInstall(result.server.name)}
                        disabled={installing === result.server.name}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                          installing === result.server.name
                            ? 'bg-blue-400 text-white cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                      >
                        {installing === result.server.name ? '安装中...' : '安装'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showDetail && selectedServer && (
        <MCPMarketDetailModal
          server={selectedServer}
          isInstalled={isInstalled(selectedServer.name)}
          isEnabled={isEnabled(selectedServer.name)}
          installing={installing === selectedServer.name}
          onClose={handleCloseDetail}
          onInstall={() => handleInstall(selectedServer.name)}
          onUninstall={() => handleUninstall(selectedServer.name)}
          onToggle={(enabled) => handleToggle(selectedServer.name, enabled)}
        />
      )}
    </div>
  );
}

export default MCPMarketPage;
