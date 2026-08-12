/**
 * 渐进式文件路径链接组件 — MarkdownRenderer V1/V2 共享
 * MIT License
 *
 * 对标 cline InlineCodeWithFileCheck：
 *
 *1. 同步：如果 codeContent 匹配 knownFilePaths → 立即渲染 FileLink
 * 2. 异步：先渲染 code 样式，后台验证文件存在后升级为 FileLink
 * 3. 始终非阻塞，主线程零卡顿
 */
import { useState, useEffect } from "react";
import FileLink from "../FileLink";
import { getBackendBaseUrl, getApiSecret } from "../../../services/backendUrl";
import {
  matchFilePath,
  pathResolveCache,
  pathResolvePending,
  setPathCache,
  getCacheKey,
  getCacheEntry,
} from "./pathCache";
import { useSessionStore } from "../../../stores/sessionStore";

interface InlineCodeLinkProps {
  codeContent: string;
  knownFilePaths: string[] | undefined;
  onPreviewFile: ((path: string) => void) | undefined;
}

export function InlineCodeLink({
  codeContent,
  knownFilePaths,
  onPreviewFile,
}: InlineCodeLinkProps) {
  const [confirmedPath, setConfirmedPath] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const sessionId = useSessionStore((s) => s.currentSession?.id);

  useEffect(() => {
    // 阶段 1 同步匹配 — 在 knownFilePaths 中查找，命中则立即渲染 FileLink
    if (knownFilePaths && knownFilePaths.length > 0) {
      const matched = matchFilePath(codeContent, knownFilePaths);
      if (matched) {
        setConfirmedPath(matched);
        return;
      }
    }

    //阶段 2: 验证 — 即使 knownFilePaths 为空也执行
    // 通过 /api/file/resolve-path 后端 API 验证路径是否存在
    // 支持正斜杠 / 和反斜杠 \ 两种路径分隔符
    // \p{L} = 任意 Unicode 字母（含中文），\p{N} = 任意 Unicode 数字
    const pathLike =
      /^(?:[A-Za-z]:)?[\\/]?(?:[\p{L}\p{N}\w\-.]+[\\/])*[\p{L}\p{N}\w\-.]+(?:\.[a-zA-Z0-9]{1,10})?$/u;
    if (pathLike.test(codeContent) && !checking) {
      const cacheKey = sessionId
        ? getCacheKey(sessionId, codeContent)
        : codeContent;

      // 先查缓存（含别名匹配 + TTL 过期检查），命中则直接使用
      const cached = getCacheEntry(cacheKey);
      if (cached) {
        setConfirmedPath(cached.canonical);
        return;
      }
      // 检查是否已有相同路径的请求在进行中
      if (pathResolvePending.has(cacheKey)) return;

      setChecking(true);
      pathResolvePending.add(cacheKey);
      const baseUrl = getBackendBaseUrl();
      const encodedPath = encodeURIComponent(codeContent);
      const apiSecret = getApiSecret();
      const headers: Record<string, string> = {};
      if (apiSecret) {
        headers["X-API-Key"] = apiSecret;
      }
      fetch(`${baseUrl}/api/file/resolve-path?path=${encodedPath}`, { headers })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const resolved = data?.resolvedPath || null;
          if (resolved) {
            if (sessionId) {
              setPathCache(sessionId, codeContent, resolved);
            } else {
              // 无 sessionId 时退化为全局缓存（monotonic clock）
              const now = performance.now();
              pathResolveCache.set(cacheKey, {
                canonical: resolved,
                aliases: new Set(),
                createdAt: now,
                isNegative: false,
              });
            }
            setConfirmedPath(resolved);
          } else {
            const now = performance.now();
            pathResolveCache.set(cacheKey, {
              canonical: "",
              aliases: new Set(),
              createdAt: now,
              isNegative: true,
            });
          }
        })
        .catch(() => {
          // 修复：网络/后端不可达时**不写负缓存**——原实现把基础设施故障
          // 伪装成"文件不存在"（TTL 30s），后端临时不可达时所有代码路径
          // 都渲染成纯 <code> 且旧链接显示红字"文件不存在"，误导用户。
          // 三态语义：确认存在→正缓存；确认不存在（res.ok 且无 resolvedPath）
          // →负缓存；验证失败（网络错误）→不缓存，等待下次触发重试。
        })
        .finally(() => {
          pathResolvePending.delete(cacheKey);
        });
    }
  }, [codeContent, knownFilePaths, checking]); // sessionId 不在依赖中：缓存 key 已含 sessionId，切换会话时组件随消息重新挂载，无需重触发

  if (confirmedPath) {
    return <FileLink filePath={confirmedPath} onPreview={onPreviewFile} />;
  }

  return <code>{codeContent}</code>;
}
