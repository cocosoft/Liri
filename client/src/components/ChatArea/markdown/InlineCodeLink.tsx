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
import { useState, useEffect, useRef } from "react";
import FileLink from "../FileLink";
import { createLogger } from "@/utils/logger";
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

const logger = createLogger("components:inlineCodeLink");

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
  /** BUG-6 修复：验证失败时间戳（冷却 5s），防止 finally setChecking 触发 effect 重跑导致无限重试 */
  const lastFailRef = useRef(0);
  /** P1-4 修复：请求取消标记（竞态防护） */
  const cancelledRef = useRef(false);
  const sessionId = useSessionStore((s) => s.currentSession?.id);

  useEffect(() => {
    // P1-4 修复：重置取消标记
    cancelledRef.current = false;
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
    // BUG-2 修复：强制至少一个路径分隔符（[\\/]+），排除 useState/React/config 等纯单词
    const pathLike =
      /^(?:[A-Za-z]:)?[\\/]+(?:[\p{L}\p{N}\w\-.]+[\\/])*[\p{L}\p{N}\w\-.]+(?:\.[a-zA-Z0-9]{1,10})$/u;
    if (pathLike.test(codeContent) && !checking) {
      // BUG-6 修复：失败后冷却期内不重试（避免 finally setChecking 触发 effect 重跑无限循环）
      if (Date.now() - lastFailRef.current < 5000) return;
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
          // P1-4 修复：竞态防护——若组件已取消（codeContent 变化），丢弃旧结果
          if (cancelledRef.current) return;
          // BUG-1 修复：后端对不存在的路径也返回 resolvedPath（猜测路径）+ exists:false（HTTP 200），
          // 必须检查 exists/restricted（与 filePathResolver.ts 对齐），否则任意被误判为路径的文本
          // 都被渲染成 FileLink（点击报"文件不存在"）。
          if (data?.exists === false || data?.restricted) {
            const now = performance.now();
            pathResolveCache.set(cacheKey, {
              canonical: "",
              aliases: new Set(),
              createdAt: now,
              isNegative: true,
            });
            return;
          }
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
        .catch((err: unknown) => {
          // 修复：网络/后端不可达时**不写负缓存**——原实现把基础设施故障
          // 伪装成"文件不存在"（TTL 30s），后端临时不可达时所有代码路径
          // 都渲染成纯 <code> 且旧链接显示红字"文件不存在"，误导用户。
          // 三态语义：确认存在→正缓存；确认不存在（res.ok 且无 resolvedPath）
          // →负缓存；验证失败（网络错误）→不缓存，等待下次触发重试。
          lastFailRef.current = Date.now();
          logger.warn(
            "InlineCodeLink: 路径验证失败（网络/后端异常），不写缓存",
            {
              codeContent,
              error: err instanceof Error ? err.message : String(err),
            },
          );
        })
        .finally(() => {
          pathResolvePending.delete(cacheKey);
          // BUG-6 修复：释放 checking 锁——此前失败后 checking 恒 true 永不重试；
          // 配合失败冷却（lastFailRef 5s）避免 effect 重跑无限循环
          setChecking(false);
        });
    }
  }, [codeContent, knownFilePaths, checking]); // sessionId 不在依赖中：缓存 key 已含 sessionId，切换会话时组件随消息重新挂载，无需重触发

  // P1-4 修复：cleanup 时标记取消，丢弃旧请求的晚返回结果
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, [codeContent]);

  if (confirmedPath) {
    return <FileLink filePath={confirmedPath} onPreview={onPreviewFile} />;
  }

  return <code>{codeContent}</code>;
}
