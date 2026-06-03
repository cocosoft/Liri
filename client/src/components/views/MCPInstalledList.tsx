import { useCallback } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { useMCPStore } from '../../stores/mcpStore';
import { useToastStore } from '../../stores/toastStore';
import type { InstalledMCPServer } from '../../services/mcpMarketplaceService';

const TRANSPORT_LABELS: Record<string, string> = {
  http: 'HTTP',
  stdio: 'stdio',
  unknown: '?',
};

/**
 * 获取服务器状态（结合 connected + enabled 推断可读状态）
 */
function getServerStatus(s: InstalledMCPServer): { label: string; color: string } {
  if (s.connected) {
    return { label: '已连接', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
  }
  if (s.configInFile) {
    return { label: '配置文件', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
  }
  if (s.enabled) {
    return { label: '未连接', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' };
  }
  return { label: '已禁用', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' };
}

/**
 * MCPInstalledList — 已安装 MCP 服务器列表
 * 展示传输类型、连接状态、工具数量、操作按钮
 */
function MCPInstalledList() {
  const { config } = useConfigStore();
  const isDark = config.theme === 'dark';

  const {
    installedServers,
    operatingId,
    batchOperating,
    selectedServerNames,
    toggleServer,
    promptUninstall,
    loadInstalled,
    openConfigModal,
    toggleSelected,
    toggleSelectAll,
    clearSelection,
    batchEnable,
    batchDisable,
    batchUninstall,
  } = useMCPStore();

  const { addToast } = useToastStore();

  // 带 Toast 的操作封装
  const handleToggle = useCallback(
    async (serverId: string, enabled: boolean) => {
      await toggleServer(serverId, enabled);
      const server = installedServers.find((s) => s.name === serverId);
      const label = server?.title || serverId;
      addToast('info', `"${label}" ${enabled ? '已启用' : '已禁用'}`);
    },
    [toggleServer, installedServers, addToast]
  );

  if (installedServers.length === 0) {
    return (
      <div className={`rounded-lg border p-6 mb-6 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
            已安装服务器
          </h2>
        </div>
        <div className="text-center py-6">
          <div className="text-3xl mb-2">📦</div>
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            暂无已安装的 MCP 服务器
          </p>
          <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            在下方搜索市场安装，或手动添加服务器
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border mb-6 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      {/* 标题栏 */}
      <div className={`px-4 py-3 flex items-center justify-between border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="flex items-center gap-3">
          {/* 全选 checkbox */}
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={installedServers.length > 0 && installedServers.every((s) => selectedServerNames.has(s.name))}
              onChange={() => toggleSelectAll()}
              className="w-3.5 h-3.5 rounded"
            />
          </label>
          <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
            已安装服务器
          </h2>
          <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
            {installedServers.length}
          </span>
          {selectedServerNames.size > 0 && (
            <span className={`text-xs ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
              已选 {selectedServerNames.size}
            </span>
          )}
        </div>
        <button
          onClick={() => loadInstalled()}
          className={`p-1.5 rounded-lg transition-colors ${
            isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
          }`}
          title="刷新列表"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* 批量操作工具栏 */}
      {selectedServerNames.size > 0 && (
        <div className={`px-4 py-2 flex items-center gap-2 border-b ${isDark ? 'bg-gray-800/50 border-gray-700' : 'bg-blue-50 border-gray-200'}`}>
          <button
            onClick={() => clearSelection()}
            className={`text-xs hover:underline ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
          >
            取消选择
          </button>
          <button
            onClick={() => { batchEnable(); addToast('info', `已批量启用 ${selectedServerNames.size} 个服务器`); }}
            disabled={batchOperating}
            className="px-2 py-1 text-xs rounded bg-green-100 hover:bg-green-200 text-green-700 dark:bg-green-900/30 dark:hover:bg-green-900/50 dark:text-green-400 transition-colors disabled:opacity-50"
          >
            批量启用
          </button>
          <button
            onClick={() => { batchDisable(); addToast('info', `已批量禁用 ${selectedServerNames.size} 个服务器`); }}
            disabled={batchOperating}
            className="px-2 py-1 text-xs rounded bg-yellow-100 hover:bg-yellow-200 text-yellow-700 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/50 dark:text-yellow-400 transition-colors disabled:opacity-50"
          >
            批量禁用
          </button>
          <button
            onClick={() => { batchUninstall(); addToast('success', `已批量卸载 ${selectedServerNames.size} 个服务器`); }}
            disabled={batchOperating}
            className="px-2 py-1 text-xs rounded bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 transition-colors disabled:opacity-50"
          >
            批量卸载
          </button>
          {batchOperating && (
            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>操作中...</span>
          )}
        </div>
      )}

      {/* 服务器列表 */}
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {installedServers.map((server) => {
          const status = getServerStatus(server);
          const transport = server.transport || 'unknown';
          const toolCount = server.toolCount;

          return (
            <div
              key={server.name}
              className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {/* 行级选择 checkbox */}
                  <input
                    type="checkbox"
                    checked={selectedServerNames.has(server.name)}
                    onChange={() => toggleSelected(server.name)}
                    className="w-3.5 h-3.5 rounded"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className={`font-medium text-sm ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                    {server.title || server.name}
                  </span>

                  {/* 传输类型标签 */}
                  <span
                    className={`px-1.5 py-0.5 text-xs rounded font-mono ${
                      transport === 'http'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        : transport === 'stdio'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-500'
                    }`}
                  >
                    {TRANSPORT_LABELS[transport] || '?'}
                  </span>

                  {/* 来源标签 */}
                  {server.installedFrom !== 'builtin' && (
                    <span className={`px-1.5 py-0.5 text-xs rounded ${
                      server.installedFrom === 'official'
                        ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>
                      {server.installedFrom === 'official' ? '官方' : '第三方'}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {/* 名称 */}
                  <code className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {server.name}
                  </code>

                  {/* 状态标签 */}
                  <span className={`px-1.5 py-0.5 text-xs rounded-full ${status.color}`}>
                    {status.label}
                  </span>

                  {/* 工具数量 */}
                  {typeof toolCount === 'number' && (
                    <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {toolCount} 个工具
                    </span>
                  )}

                  {/* 版本 */}
                  {server.version && (
                    <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      v{server.version}
                    </span>
                  )}
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-2 ml-4" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => openConfigModal(server)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    isDark
                      ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                  title="编辑配置"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleToggle(server.name, !server.enabled)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    server.enabled
                      ? 'bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {server.enabled ? '禁用' : '启用'}
                </button>
                <button
                  onClick={() => promptUninstall(server.name)}
                  disabled={operatingId === server.name}
                  className="px-3 py-1.5 text-xs rounded-lg bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 transition-colors disabled:opacity-50"
                >
                  卸载
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MCPInstalledList;
