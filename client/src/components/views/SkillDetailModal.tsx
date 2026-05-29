import { useEffect } from 'react';
import { useConfigStore } from '../../stores/configStore';
import type { ClawHubSkillMeta } from '../../services/skillMarketService';

interface SkillDetailModalProps {
  skill: ClawHubSkillMeta;
  isInstalled: boolean;
  isEnabled: boolean;
  installing: boolean;
  onClose: () => void;
  onInstall: () => void;
  onUninstall: () => void;
  onToggle: (enabled: boolean) => void;
}

const PERMISSION_LABELS: Record<string, string> = {
  network: '网络访问',
  filesystem: '文件系统',
  browser: '浏览器',
  shell: 'Shell 执行',
  notifications: '通知',
  vault: 'Vault 存储',
  voice: '语音录制',
};

export function SkillDetailModal({
  skill,
  isInstalled,
  isEnabled,
  installing,
  onClose,
  onInstall,
  onUninstall,
  onToggle,
}: SkillDetailModalProps) {
  const { config } = useConfigStore();
  const isDark = config.theme === 'dark';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        className={`relative w-full max-w-lg mx-4 rounded-lg shadow-xl border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
      >
        <div className={`px-6 py-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center justify-between">
            <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              {skill.name}
            </h2>
            <button
              onClick={onClose}
              className={`p-1 rounded-lg transition-colors ${
                isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            {skill.description || '暂无描述'}
          </p>

          <div className={`grid grid-cols-2 gap-3 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            <div>
              <span className="font-semibold">版本</span>
              <p className={isDark ? 'text-gray-200' : 'text-gray-800'}>v{skill.version}</p>
            </div>
            <div>
              <span className="font-semibold">作者</span>
              <p className={isDark ? 'text-gray-200' : 'text-gray-800'}>{skill.author}</p>
            </div>
            {skill.license && (
              <div>
                <span className="font-semibold">许可</span>
                <p className={isDark ? 'text-gray-200' : 'text-gray-800'}>{skill.license}</p>
              </div>
            )}
            {skill.category && (
              <div>
                <span className="font-semibold">分类</span>
                <p className={isDark ? 'text-gray-200' : 'text-gray-800'}>{skill.category}</p>
              </div>
            )}
          </div>

          {skill.tags && skill.tags.length > 0 && (
            <div>
              <span className={`text-sm font-semibold ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                标签
              </span>
              <div className="flex flex-wrap gap-2 mt-1">
                {skill.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {skill.permissions && skill.permissions.length > 0 && (
            <div>
              <span className={`text-sm font-semibold ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                权限声明
              </span>
              <div className="flex flex-wrap gap-2 mt-1">
                {skill.permissions.map((perm) => (
                  <span
                    key={perm}
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      isDark
                        ? 'bg-yellow-900/30 text-yellow-400'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {PERMISSION_LABELS[perm] || perm}
                  </span>
                ))}
              </div>
            </div>
          )}

          {skill.dependencies && skill.dependencies.length > 0 && (
            <div>
              <span className={`text-sm font-semibold ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                依赖
              </span>
              <ul className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {skill.dependencies.map((dep) => (
                  <li key={dep} className="ml-4 list-disc">
                    {dep}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className={`px-6 py-4 border-t flex justify-end gap-3 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          {isInstalled ? (
            <>
              <button
                onClick={() => onToggle(!isEnabled)}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  isEnabled
                    ? 'bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isEnabled ? '禁用' : '启用'}
              </button>
              <button
                onClick={onUninstall}
                className="px-4 py-2 text-sm rounded-lg bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 transition-colors"
              >
                卸载
              </button>
            </>
          ) : (
            <button
              onClick={onInstall}
              disabled={installing}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                installing
                  ? 'bg-blue-400 text-white cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {installing ? '安装中...' : '安装'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
