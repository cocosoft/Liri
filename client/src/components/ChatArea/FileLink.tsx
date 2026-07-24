import React, { useCallback, useState } from "react";
import { createLogger } from "@/utils/logger";
import { getBackendBaseUrl, getApiSecret } from "../../services/backendUrl";
import { useSessionStore } from "../../stores/sessionStore";
import { getCacheKey, invalidateCacheEntry } from "./markdown/pathCache";

const logger = createLogger("components:fileLink");

interface FileLinkProps {
  filePath: string;
  onPreview?: (path: string) => void;
}

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

function FileLink({ filePath, onPreview }: FileLinkProps) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  const sessionId = useSessionStore((s) => s.currentSession?.id);

  /**
   * 构造带认证头的请求选项
   */
  const authHeaders = useCallback((): Record<string, string> => {
    const secret = getApiSecret();
    return secret ? { "X-API-Key": secret } : {};
  }, []);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (opening) return;
      setOpening(true);
      setError(false);

      try {
        if (onPreview) {
          onPreview(filePath);
        } else if (isTauri) {
          const { open } = await import("@tauri-apps/plugin-shell");
          await open(filePath);
        } else {
          const baseUrl = getBackendBaseUrl();
          const encodedPath = encodeURIComponent(filePath);
          const resp = await fetch(
            `${baseUrl}/api/file/open?path=${encodedPath}`,
            {
              headers: authHeaders(),
            },
          );
          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
          }
        }
      } catch (err) {
        logger.error("打开文件失败", err);
        setError(true);
        // 清除该路径的缓存，允许下次重新解析
        if (sessionId) {
          invalidateCacheEntry(getCacheKey(sessionId, filePath));
        }
        // 3 秒后自动清除错误状态
        setTimeout(() => setError(false), 3000);
      } finally {
        setOpening(false);
      }
    },
    [filePath, opening, onPreview, authHeaders, sessionId],
  );

  const handleOpenInSystem = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (opening) return;
      setOpening(true);
      setError(false);

      try {
        if (isTauri) {
          const { open } = await import("@tauri-apps/plugin-shell");
          await open(filePath);
        } else {
          const baseUrl = getBackendBaseUrl();
          const encodedPath = encodeURIComponent(filePath);
          const resp = await fetch(
            `${baseUrl}/api/file/open?path=${encodedPath}`,
            {
              headers: authHeaders(),
            },
          );
          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
          }
        }
      } catch (err) {
        logger.error("打开文件失败", err);
        setError(true);
        if (sessionId) {
          invalidateCacheEntry(getCacheKey(sessionId, filePath));
        }
        setTimeout(() => setError(false), 3000);
      } finally {
        setOpening(false);
      }
    },
    [filePath, opening, authHeaders, sessionId],
  );

  return (
    <span className="inline-flex items-center gap-1 group">
      <a
        href="#"
        onClick={handleClick}
        className={`file-link inline-flex items-center gap-1 underline cursor-pointer ${
          error
            ? "text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 line-through decoration-red-400"
            : "text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        }`}
        title={
          error ? `文件不存在或无法访问: ${filePath}` : `点击预览: ${filePath}`
        }
      >
        <FileIcon error={error} />
        <span>{filePath}</span>
        {error && (
          <span className="text-xs text-red-500 ml-1">(文件不存在)</span>
        )}
      </a>
      <button
        onClick={handleOpenInSystem}
        className={`p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors opacity-0 group-hover:opacity-100 ${
          error
            ? "text-red-400 hover:text-red-600"
            : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        }`}
        title={error ? "文件不存在，无法打开" : "在系统资源管理器中打开"}
        disabled={error}
      >
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </button>
    </span>
  );
}

function FileIcon({ error }: { error?: boolean }) {
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
      className={`inline-block flex-shrink-0 ${error ? "text-red-500" : ""}`}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export default FileLink;
