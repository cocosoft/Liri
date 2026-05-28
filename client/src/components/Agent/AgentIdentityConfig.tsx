interface AgentIdentity {
  name?: string;
  description?: string;
  avatar?: string;
  personality?: string;
  fastMode?: boolean;
  remoteAgents?: string[];
}

interface AgentIdentityConfigProps {
  isDark: boolean;
  config?: AgentIdentity;
  onUpdate: (identity: AgentIdentity) => void;
}

function AgentIdentityConfig({ isDark, config, onUpdate }: AgentIdentityConfigProps) {
  const identity = config || {};

  const handleChange = (key: keyof AgentIdentity, value: string | boolean | string[]) => {
    onUpdate({ ...identity, [key]: value });
  };

  return (
    <div className="space-y-6">
      <h2 className={`text-lg font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
        Agent 身份配置
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            Agent 名称
          </label>
          <input
            type="text"
            value={identity.name || ''}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="输入 Agent 名称"
            className={`w-full px-3 py-2 rounded-lg border ${
              isDark
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
        </div>

        <div>
          <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            头像 URL
          </label>
          <input
            type="text"
            value={identity.avatar || ''}
            onChange={(e) => handleChange('avatar', e.target.value)}
            placeholder="输入头像 URL"
            className={`w-full px-3 py-2 rounded-lg border ${
              isDark
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
        </div>
      </div>

      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          描述
        </label>
        <textarea
          value={identity.description || ''}
          onChange={(e) => handleChange('description', e.target.value)}
          placeholder="描述 Agent 的角色和能力"
          rows={3}
          className={`w-full px-3 py-2 rounded-lg border resize-none ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
        />
      </div>

      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          个性 / 行为特征
        </label>
        <textarea
          value={identity.personality || ''}
          onChange={(e) => handleChange('personality', e.target.value)}
          placeholder="描述 Agent 的个性特征和行为模式"
          rows={3}
          className={`w-full px-3 py-2 rounded-lg border resize-none ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
        />
      </div>

      <div className={`p-4 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
        <div className="flex items-center justify-between">
          <div>
            <label className={`block text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              快速模式 (Fast Mode)
            </label>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              启用后跳过详细思考过程，加快响应速度
            </p>
          </div>
          <button
            onClick={() => handleChange('fastMode', !identity.fastMode)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              identity.fastMode
                ? 'bg-blue-500'
                : isDark
                ? 'bg-gray-600'
                : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                identity.fastMode ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          远程 Agent 列表
        </label>
        <div className="space-y-2">
          {(identity.remoteAgents || []).map((agent, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={agent}
                onChange={(e) => {
                  const newAgents = [...(identity.remoteAgents || [])];
                  newAgents[index] = e.target.value;
                  handleChange('remoteAgents', newAgents);
                }}
                placeholder="输入远程 Agent 地址"
                className={`flex-1 px-3 py-2 rounded-lg border ${
                  isDark
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                } focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
              <button
                onClick={() => {
                  const newAgents = (identity.remoteAgents || []).filter((_, i) => i !== index);
                  handleChange('remoteAgents', newAgents);
                }}
                className={`p-2 rounded-lg ${
                  isDark ? 'hover:bg-gray-700 text-red-400' : 'hover:bg-gray-200 text-red-500'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              const newAgents = [...(identity.remoteAgents || []), ''];
              handleChange('remoteAgents', newAgents);
            }}
            className={`w-full px-3 py-2 rounded-lg border border-dashed text-sm ${
              isDark
                ? 'border-gray-600 text-gray-400 hover:border-gray-500'
                : 'border-gray-300 text-gray-500 hover:border-gray-400'
            }`}
          >
            + 添加远程 Agent
          </button>
        </div>
      </div>
    </div>
  );
}

export default AgentIdentityConfig;