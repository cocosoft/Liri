import { useEffect, useRef } from 'react';
import { useFileStore } from '../../stores/fileStore';
import { useAppStore } from '../../stores/appStore';
import { SkeletonTable } from '../common/Skeleton';

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function FileExplorerPage() {
  const { entries, currentPath, isLoading, error, uploading, loadDir, navigateTo, goUp, uploadFile } = useFileStore();
  const setActivePage = useAppStore((s) => s.setActivePage);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDir(currentPath);
  }, []);

  const handleItemClick = (entry: { name: string; path: string; type: 'file' | 'directory' }) => {
    if (entry.type === 'directory') {
      navigateTo(entry.path);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
      e.target.value = '';
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              文件浏览器
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {currentPath}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleUploadClick}
              disabled={uploading}
              className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
            >
              {uploading ? '上传中...' : '上传文件'}
            </button>
            <button
              onClick={goUp}
              disabled={currentPath === '/'}
              className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40"
            >
              上级目录
            </button>
            <button
              onClick={() => setActivePage('chat')}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              返回聊天
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {isLoading ? (
            <div className="p-4">
              <SkeletonTable rows={5} />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              空目录
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase">
                  <th className="text-left px-4 py-3 font-medium">名称</th>
                  <th className="text-right px-4 py-3 font-medium w-24">大小</th>
                  <th className="text-right px-4 py-3 font-medium w-32">修改时间</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.path}
                    onClick={() => handleItemClick(entry)}
                    className={`border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                      entry.type === 'directory' ? 'cursor-pointer' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">
                          {entry.type === 'directory' ? '📁' : '📄'}
                        </span>
                        <span className="text-sm text-gray-900 dark:text-gray-100 truncate max-w-xs">
                          {entry.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500 dark:text-gray-400">
                      {entry.type === 'file' ? formatSize(entry.size) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(entry.modified_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default FileExplorerPage;
