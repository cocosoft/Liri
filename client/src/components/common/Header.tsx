import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function Header() {
  const navigate = useNavigate();
  const [showHelpMenu, setShowHelpMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowHelpMenu(false);
      }
    };
    if (showHelpMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHelpMenu]);

  return (
    <header className="h-14 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <img
            src="/liri_logo.png"
            alt="Liri Logo"
            className="h-7 w-7 object-contain"
          />
          <h1 className="text-[32px] font-bold text-gray-900 dark:text-white">Liri</h1>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowHelpMenu(!showHelpMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm transition-colors"
          >
            <span>❓</span>
            <span>帮助中心</span>
            <svg className={`w-3.5 h-3.5 transition-transform ${showHelpMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showHelpMenu && (
            <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-50">
              <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 font-medium border-b border-gray-100 dark:border-gray-700">
                帮助与反馈
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => navigate('/terminal')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm transition-colors"
        >
          <span>💻</span>
          <span>终端</span>
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