import { useEffect } from 'react';
import { useBackendStore } from '../../stores/backendStore';

function Footer() {
  const { status, checkStatus } = useBackendStore();

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const getStatusColor = () => {
    if (status.running) return '🟢';
    return '🔴';
  };

  const getStatusText = () => {
    if (status.running) return '运行中';
    return '已停止';
  };

  return (
    <footer className="h-8 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center px-4 text-xs text-gray-600 dark:text-gray-400">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span>{getStatusColor()}</span>
          <span>Backend {getStatusText()}</span>
        </div>

        {status.running && status.port && (
          <>
            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600" />
            <div className="flex items-center gap-1.5">
              <span>端口</span>
              <span className="font-medium">{status.port}</span>
            </div>
          </>
        )}

        {status.running && status.pid && (
          <>
            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600" />
            <div className="flex items-center gap-1.5">
              <span>PID</span>
              <span className="font-medium">{status.pid}</span>
            </div>
          </>
        )}
      </div>
    </footer>
  );
}

export default Footer;