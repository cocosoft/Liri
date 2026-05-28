import { useState, useEffect } from 'react';
import { useConfigStore } from '../../stores/configStore';

interface OAuthProvider {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

interface OAuthSession {
  id: string;
  provider: string;
  userId: string;
  userName: string;
  expiresAt: string;
  scopes: string[];
}

function OAuthPage() {
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === 'dark';
  const [providers, setProviders] = useState<OAuthProvider[]>([
    { id: 'google', name: 'Google', icon: 'G', enabled: true, clientId: 'client-id-123', clientSecret: '******', redirectUri: 'http://localhost:3000/oauth/callback/google', scopes: ['openid', 'email', 'profile'] },
    { id: 'github', name: 'GitHub', icon: 'GH', enabled: true, clientId: 'client-id-456', clientSecret: '******', redirectUri: 'http://localhost:3000/oauth/callback/github', scopes: ['user:email', 'repo'] },
    { id: 'azure', name: 'Azure', icon: 'AZ', enabled: true, clientId: 'client-id-789', clientSecret: '******', redirectUri: 'http://localhost:3000/oauth/callback/azure', scopes: ['User.Read', 'Mail.Read'] },
  ]);
  const [sessions, setSessions] = useState<OAuthSession[]>([
    { id: '1', provider: 'Google', userId: 'user123', userName: 'john.doe@example.com', expiresAt: '2026-05-30 12:00', scopes: ['openid', 'email'] },
    { id: '2', provider: 'Azure', userId: 'user456', userName: 'jane.smith@example.com', expiresAt: '2026-05-29 18:00', scopes: ['User.Read'] },
  ]);
  const [activeTab, setActiveTab] = useState<'providers' | 'sessions'>('providers');
  const [selectedProvider, setSelectedProvider] = useState<OAuthProvider | null>(null);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const toggleProvider = (providerId: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === providerId ? { ...p, enabled: !p.enabled } : p))
    );
  };

  const revokeSession = (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  };

  const getProviderIcon = (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    return provider?.icon || '?';
  };

  const getProviderColor = (providerId: string) => {
    switch (providerId) {
      case 'google':
        return isDark ? 'bg-gray-700 text-gray-300' : 'bg-white text-gray-800';
      case 'github':
        return isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-900 text-white';
      case 'azure':
        return 'bg-blue-600 text-white';
      default:
        return isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className={`flex-1 overflow-y-auto ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              OAuth 认证管理
            </h1>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              管理第三方 OAuth 提供商和认证会话
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab('providers')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'providers'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            提供商配置
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'sessions'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            活动会话
          </button>
        </div>

        {activeTab === 'providers' && (
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1 space-y-2">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedProvider(provider)}
                  className={`w-full p-3 rounded-lg border transition-colors ${
                    selectedProvider?.id === provider.id
                      ? isDark
                        ? 'border-blue-500 bg-blue-900/20'
                        : 'border-blue-500 bg-blue-50'
                      : isDark
                      ? 'border-gray-700 bg-gray-800 hover:bg-gray-700'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded flex items-center justify-center text-sm font-bold ${getProviderColor(provider.id)}`}>
                      {provider.icon}
                    </span>
                    <div className="text-left">
                      <div className={`font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        {provider.name}
                      </div>
                      <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {provider.enabled ? '已启用' : '已禁用'}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="col-span-2">
              {selectedProvider ? (
                <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-6`}>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold ${getProviderColor(selectedProvider.id)}`}>
                        {selectedProvider.icon}
                      </span>
                      <div>
                        <h3 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                          {selectedProvider.name}
                        </h3>
                        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          OAuth 2.0 认证配置
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleProvider(selectedProvider.id)}
                      className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                        selectedProvider.enabled
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : isDark
                          ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                          : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                      }`}
                    >
                      {selectedProvider.enabled ? '已启用' : '已禁用'}
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        Client ID
                      </label>
                      <input
                        type="text"
                        value={selectedProvider.clientId}
                        readOnly
                        className={`w-full px-3 py-2 text-sm border rounded-lg ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
                      />
                    </div>

                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        Client Secret
                      </label>
                      <input
                        type="password"
                        value={selectedProvider.clientSecret}
                        readOnly
                        className={`w-full px-3 py-2 text-sm border rounded-lg ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
                      />
                    </div>

                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        Redirect URI
                      </label>
                      <input
                        type="text"
                        value={selectedProvider.redirectUri}
                        readOnly
                        className={`w-full px-3 py-2 text-sm border rounded-lg ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
                      />
                    </div>

                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        授权范围 (Scopes)
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {selectedProvider.scopes.map((scope) => (
                          <span
                            key={scope}
                            className={`px-2 py-1 text-xs rounded-full ${isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-700'}`}
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-12 text-center`}>
                  <p className={`${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    请从左侧选择一个提供商查看详情
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-6`}>
            {sessions.length === 0 ? (
              <div className="text-center py-12">
                <p className={`${isDark ? 'text-gray-400' : 'text-gray-500'}`}>暂无活动会话</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`flex items-center justify-between p-4 rounded-lg ${isDark ? 'bg-gray-700/50' : 'bg-gray-50'}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 rounded flex items-center justify-center text-sm font-bold ${getProviderColor(session.provider.toLowerCase())}`}>
                        {getProviderIcon(session.provider.toLowerCase())}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            {session.userName}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? 'bg-gray-600 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                            {session.provider}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>用户ID: {session.userId}</span>
                          <span>过期: {session.expiresAt}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {session.scopes.map((scope) => (
                            <span
                              key={scope}
                              className={`text-xs px-1.5 py-0.5 rounded ${isDark ? 'bg-gray-600 text-gray-400' : 'bg-gray-200 text-gray-600'}`}
                            >
                              {scope}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => revokeSession(session.id)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${isDark ? 'bg-red-900/30 hover:bg-red-900/50 text-red-400' : 'bg-red-50 hover:bg-red-100 text-red-600'}`}
                    >
                      撤销授权
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default OAuthPage;