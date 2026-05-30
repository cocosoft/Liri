import { useNavigate } from 'react-router-dom';

function Header() {
  const navigate = useNavigate();

  return (
    <header className="h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📱</span>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Liri</h1>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/help')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm transition-colors"
        >
          <span>❓</span>
          <span>帮助中心</span>
        </button>

        <button
          onClick={() => navigate('/apikeys')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm transition-colors"
        >
          <span>👤</span>
          <span>用户中心</span>
        </button>
      </div>
    </header>
  );
}

export default Header;