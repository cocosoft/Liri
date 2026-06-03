import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../stores/appStore';
import { useConfigStore } from '../../stores/configStore';

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  path?: string;
  action?: () => void;
}

const HIGH_FREQUENCY_ITEMS: MenuItem[] = [
  { id: 'home', label: '首页', icon: '🏠', path: '/' },
  { id: 'chat', label: '聊天', icon: '💬', path: '/chat' },
  { id: 'tasks', label: '任务', icon: '🎯', path: '/tasks' },
  { id: 'cron', label: '定时', icon: '⏰', path: '/cron' },
  { id: 'channels', label: '渠道', icon: '📡', path: '/channels' },
  { id: 'skills', label: '技能', icon: '🔧', path: '/skills' },
  { id: 'skill-market', label: '市场', icon: '🛒', path: '/skill-market' },
  { id: 'knowledge', label: '知识库', icon: '📚', path: '/knowledge' },
  { id: 'dashboard', label: '仪表盘', icon: '📊', path: '/dashboard' },
];

const SYSTEM_ITEMS: MenuItem[] = [
  { id: 'buddy', label: '伙伴', icon: '🤝', path: '/buddy' },
  { id: 'theme', label: '主题', icon: '🌙' },
  { id: 'settings', label: '设置', icon: '⚙️', path: '/settings' },
];

function MenuButton({ item, isActive }: { item: MenuItem; isActive: boolean }) {
  const navigate = useNavigate();
  const setActivePage = useAppStore((s) => s.setActivePage);
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);
  const isDark = config.theme === 'dark';

  const handleClick = () => {
    if (item.path) {
      if (item.path === '/') {
        setActivePage('home');
      } else {
        const pageId = item.path.replace('/', '') || 'chat';
        setActivePage(pageId as any);
      }
      navigate(item.path);
    } else if (item.id === 'theme') {
      const newTheme = isDark ? 'light' : 'dark';
      setConfig('theme', newTheme);
    }
  };

  if (item.id === 'theme') {
    return (
      <button
        onClick={handleClick}
        className={`flex flex-col items-center justify-center py-2 px-2 rounded transition-colors h-14 w-full flex-shrink-0 ${
          isDark
            ? 'text-yellow-400 hover:bg-gray-700'
            : 'text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700'
        }`}
        title={isDark ? '切换到浅色模式' : '切换到深色模式'}
      >
        <span className="text-xl leading-none h-6 flex items-center justify-center">{isDark ? '☀️' : '🌙'}</span>
        <span className="text-xs mt-1 truncate w-full text-center h-4 flex items-center justify-center">
          {isDark ? '浅色' : '深色'}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={`flex flex-col items-center justify-center py-2 px-2 rounded transition-colors h-14 w-full flex-shrink-0 ${
        isActive
          ? 'bg-blue-600 text-white'
          : 'text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white'
      }`}
      title={item.label}
    >
      <span className="text-xl leading-none h-6 flex items-center justify-center">{item.icon}</span>
      <span className="text-xs mt-1 truncate w-full text-center h-4 flex items-center justify-center">{item.label}</span>
    </button>
  );
}

function Sidebar() {
  const location = useLocation();
  const activeRoute = location.pathname.replace('/', '') || 'home';

  const isActive = (path: string) => {
    const normalizedPath = path.replace('/', '') || 'home';
    return activeRoute === normalizedPath || activeRoute.startsWith(normalizedPath + '/');
  };

  return (
    <aside className="w-20 bg-gray-100 dark:bg-gray-900 flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-1">
        <div className="space-y-0.5">
          {HIGH_FREQUENCY_ITEMS.map((item) => (
            <MenuButton key={item.id} item={item} isActive={isActive(item.path || '')} />
          ))}
        </div>
      </div>

      <div className="p-1 border-t border-gray-300 dark:border-gray-700">
        <div className="space-y-0.5">
          {SYSTEM_ITEMS.map((item) => (
            <MenuButton key={item.id} item={item} isActive={isActive(item.path || '')} />
          ))}
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;