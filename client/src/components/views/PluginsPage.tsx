import { useState, useEffect } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { pluginService, mockPlugins, Plugin } from '../../services/pluginService';

function PluginsPage() {
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === 'dark';
  const [plugins, setPlugins] = useState<Plugin[]>(mockPlugins);
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadConfig();
    fetchPlugins();
  }, [loadConfig]);

  const fetchPlugins = async () => {
    try {
      const data = await pluginService.getPlugins();
      setPlugins(data);
    } catch {
      setPlugins(mockPlugins);
    }
  };

  const togglePlugin = async (plugin: Plugin) => {
    const newStatus = plugin.status === 'enabled' ? 'disabled' : 'enabled';
    setPlugins((prev) =>
      prev.map((p) => (p.id === plugin.id ? { ...p, status: newStatus } : p))
    );
    try {
      if (newStatus === 'enabled') {
        await pluginService.enablePlugin(plugin.id);
      } else {
        await pluginService.disablePlugin(plugin.id);
      }
    } catch {
      setPlugins((prev) =>
        prev.map((p) => (p.id === plugin.id ? { ...p, status: plugin.status } : p))
      );
    }
  };

  const categories = ['all', '搜索', '工具', '开发', '生活', '资讯'];

  const filteredPlugins = plugins.filter((plugin) => {
    const matchCategory = filter === 'all' || plugin.category === filter;
    const matchSearch =
      plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      plugin.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'enabled':
        return isDark ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-700';
      case 'disabled':
        return isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-600';
      case 'installing':
        return isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-700';
      case 'error':
        return isDark ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-700';
      default:
        return isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-600';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'enabled':
        return '已启用';
      case 'disabled':
        return '已禁用';
      case 'installing':
        return '安装中';
      case 'error':
        return '出错';
      default:
        return status;
    }
  };

  return (
    <div className={`flex-1 overflow-y-auto ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              插件管理
            </h1>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              管理和配置系统插件
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className={`flex-1 relative ${isDark ? 'bg-gray-800' : 'bg-white'} rounded-lg border border-gray-300 dark:border-gray-700`}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索插件..."
              className={`w-full px-4 py-2 text-sm outline-none ${isDark ? 'bg-transparent text-white placeholder-gray-400' : 'bg-white text-gray-900 placeholder-gray-500'}`}
            />
            <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div className="flex gap-2 flex-wrap">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setFilter(category)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  filter === category
                    ? 'bg-blue-600 text-white'
                    : isDark
                    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {category === 'all' ? '全部' : category}
              </button>
            ))}
          </div>
        </div>

        <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredPlugins.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                未找到匹配的插件
              </div>
            ) : (
              filteredPlugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className="px-4 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDark ? 'bg-gray-700' : 'bg-gray-100'}`}>
                        <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </div>
                      <div>
                        <h4 className={`font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                          {plugin.name}
                        </h4>
                        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {plugin.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 ml-13 flex items-center gap-4">
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        v{plugin.version}
                      </span>
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        作者: {plugin.author}
                      </span>
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        更新于: {plugin.lastUpdated}
                      </span>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                        {plugin.category}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(plugin.status)}`}>
                      {getStatusText(plugin.status)}
                    </span>
                    <button
                      onClick={() => togglePlugin(plugin)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                        plugin.status === 'enabled'
                          ? 'bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      {plugin.status === 'enabled' ? '禁用' : '启用'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PluginsPage;