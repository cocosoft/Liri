import React, { useCallback, useState } from 'react';

interface FileLinkProps {
  filePath: string;
  onPreview?: (path: string) => void;
}

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

function FileLink({ filePath, onPreview }: FileLinkProps) {
  const [opening, setOpening] = useState(false);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (opening) return;
    setOpening(true);

    try {
      if (onPreview) {
        onPreview(filePath);
      } else if (isTauri) {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(filePath);
      } else {
        const encodedPath = encodeURIComponent(filePath);
        await fetch(`/api/file/open?path=${encodedPath}`);
      }
    } catch (err) {
      console.error('打开文件失败:', err);
    } finally {
      setOpening(false);
    }
  }, [filePath, opening, onPreview]);

  const handleOpenInSystem = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (opening) return;
    setOpening(true);

    try {
      if (isTauri) {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(filePath);
      } else {
        const encodedPath = encodeURIComponent(filePath);
        await fetch(`/api/file/open?path=${encodedPath}`);
      }
    } catch (err) {
      console.error('打开文件失败:', err);
    } finally {
      setOpening(false);
    }
  }, [filePath, opening]);

  return (
    <span className="inline-flex items-center gap-1 group">
      <a
        href="#"
        onClick={handleClick}
        className="file-link inline-flex items-center gap-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline cursor-pointer"
        title={`点击预览: ${filePath}`}
      >
        <FileIcon />
        <span>{filePath}</span>
      </a>
      <button
        onClick={handleOpenInSystem}
        className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors opacity-0 group-hover:opacity-100"
        title="在系统资源管理器中打开"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </button>
    </span>
  );
}

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block flex-shrink-0"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export default FileLink;
