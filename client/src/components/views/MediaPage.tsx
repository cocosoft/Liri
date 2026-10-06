/**
 * MediaPage — 统一媒体工作台（对标 Grok + Copilot）
 *
 * 布局（紧凑模式 / 完整模式自适应）:
 *   顶部: TemplateCarousel — I2I/I2I2V 模板轮播
 *   左侧: 画廊（Masonry 瀑布流 / Grid 列表视图）
 *   右侧: 预览区 + 任务进度 + 操作栏 + 信息面板
 *   底部: BottomInputBar — 图片|视频 切换 + 提示词 + 动态参数 + 生成按钮
 *
 * Phase 4-6 完善：类型筛选、排序、上传入口、右键菜单、批量选择
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { useRootStore } from "../../stores/root-store";
import { useMediaStore, type GalleryItem } from "../../stores/mediaStore";
import { useShallow } from "zustand/shallow";
import { useVideoTaskPolling } from "../../hooks/useVideoTaskPolling";
import { useSessionContextSync } from "../../hooks/useSessionContextSync";
import { GallerySearchBar } from "./media/GallerySearchBar";
import { GenerationTaskList } from "./media/TaskCard";
import { TemplateCarousel } from "./media/TemplateCarousel";
import { MasonryGallery } from "./media/MasonryGallery";
// 大文件拆分（spec file-size-debt-partition-plan §38）：网格视图 + 共享类型/纯函数外迁
import { MediaGridView } from "./media/MediaGridView";
import {
  extractFileName,
  ratioToSize,
  extractFormat,
  extractDate,
  formatFileSize,
  formatDate,
  type FilterType,
  type SortBy,
  type ImageApiItem,
  type VideoApiItem,
  type ImageMetadata,
} from "./media/mediaUtils";
import { BottomInputBar } from "./media/BottomInputBar";
import { EditLayer } from "./media/EditLayer";
import { videoService } from "../../services/videoService";
import { imageService } from "../../services/imageService";
import { modelService } from "../../services/modelService";
import { http } from "../../services/httpClient";
import { useToastStore } from "../../stores/toastStore";
import { createLogger } from "../../utils/logger";
import { friendlyErrorSummary } from "../../utils/friendlyError";
import ImageViewer from "../ChatArea/ImageViewer/ImageViewer";
import VideoPlayer from "./media/VideoPlayer";
import ImageUploadDrop from "./image/ImageUploadDrop";
import type { VideoMeta } from "./media/VideoPlayer";

const logger = createLogger("MediaPage");
const PAGE_SIZE = 30;

// `FilterType` / `SortBy` 定义已随共享类型外迁 `./media/mediaUtils`（spec §38）

// TODO: Phase 6.5 — 缩略图本地缓存（30 分钟 TTL），在 gallery 图片加载时使用
// import { getCachedThumb, setCachedThumb } from "./media/thumbCache";

/** 右键菜单位置 */
interface ContextMenuState {
  x: number;
  y: number;
  item: GalleryItem;
}

function MediaPage() {
  const { t } = useTranslation();
  const { config } = useConfigStore();
  const isDark = config.theme === "dark";
  const navigate = useNavigate();

  const enterModule = useRootStore((s) => s.enterModule);
  const leaveModule = useRootStore((s) => s.leaveModule);
  useEffect(() => {
    enterModule({ moduleType: "media" });
    return () => leaveModule();
  }, [enterModule, leaveModule]);

  // ──── 生图 / 生视频模型可用性检查（缺失时友好引导到模型管理） ────
  const [modelHints, setModelHints] = useState<{
    image: boolean;
    video: boolean;
  } | null>(null);
  const [hintDismissed, setHintDismissed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    modelService
      .list()
      .then((models) => {
        if (cancelled) return;
        const enabled = models.filter((m) => m.enabled);
        setModelHints({
          image: enabled.some((m) => m.type === "image"),
          video: enabled.some((m) => m.type === "video"),
        });
      })
      .catch(() => {
        // 后端未就绪等瞬时问题：不打扰用户，放行后续生成（由生成 API 报错兜底）
        if (!cancelled) setModelHints({ image: true, video: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ──── Store ────
  const galleryItems = useMediaStore((s) => s.galleryItems);
  const galleryLoading = useMediaStore((s) => s.galleryLoading);
  const galleryHasMore = useMediaStore((s) => s.galleryHasMore);
  const selectedId = useMediaStore((s) => s.selectedId);
  const selectedImageUrl = useMediaStore((s) => s.selectedImageUrl);
  const prompt = useMediaStore((s) => s.prompt);
  const mode = useMediaStore((s) => s.mode);
  const params = useMediaStore((s) => s.params);
  const searchParams = useMediaStore((s) => s.searchParams);

  const selectMedia = useMediaStore((s) => s.selectMedia);
  const clearSelectedImage = useMediaStore((s) => s.clearSelectedImage);
  const setSearchParams = useMediaStore((s) => s.setSearchParams);
  const removeGalleryItem = useMediaStore((s) => s.removeGalleryItem);

  // ──── SessionHub 上下文同步（Phase 4）──
  // 保存/恢复媒体模块的 prompt、尺寸、风格、当前文件
  // P0-3 修复：解构 scheduleSave，在 prompt/size/style/editingImage 变更时显式触发保存
  const { scheduleSave } = useSessionContextSync("media", {
    save: () => {
      const state = useMediaStore.getState();
      return {
        moduleType: "media" as const,
        prompt: state.prompt,
        size: state.params.aspectRatio,
        style: state.params.style,
        currentFile: state.editingImage?.url,
      };
    },
    restore: (ctx) => {
      if (ctx.moduleType !== "media") return;
      const state = useMediaStore.getState();
      if (ctx.prompt) state.setPrompt(ctx.prompt);
      if (ctx.size) state.setParams({ aspectRatio: ctx.size });
      if (ctx.style) state.setParams({ style: ctx.style });
    },
  });

  /** P0-3：prompt/size/style/editingImage 变更时触发保存 */
  // useShallow（2026-08-26）：selector 返回新对象字面量会导致 zustand v5 内部
  // useSyncExternalStore getSnapshot 不稳定 → "Maximum update depth exceeded" 无限重渲染
  const mediaState = useMediaStore(
    useShallow((s) => ({
      prompt: s.prompt,
      size: s.params.aspectRatio,
      style: s.params.style,
      editingImageUrl: s.editingImage?.url,
    })),
  );
  const prevMediaStateRef = useRef(mediaState);
  useEffect(() => {
    const prev = prevMediaStateRef.current;
    if (
      prev.prompt !== mediaState.prompt ||
      prev.size !== mediaState.size ||
      prev.style !== mediaState.style ||
      prev.editingImageUrl !== mediaState.editingImageUrl
    ) {
      prevMediaStateRef.current = mediaState;
      logger.debug("[P0-3:MediaPage] 媒体状态变更，触发 scheduleSave", {
        promptLength: mediaState.prompt?.length ?? 0,
        size: mediaState.size,
        style: mediaState.style,
        hasEditingImage: !!mediaState.editingImageUrl,
      });
      scheduleSave();
    }
  }, [mediaState, scheduleSave]);
  const setIntendedAction = useMediaStore((s) => s.setIntendedAction);
  const editingImage = useMediaStore((s) => s.editingImage);
  const isEditing = useMediaStore((s) => s.isEditing);
  const setEditingImage = useMediaStore((s) => s.setEditingImage);
  const generationTasks = useMediaStore((s) => s.generationTasks);
  const addGenerationTask = useMediaStore((s) => s.addGenerationTask);
  const updateGenerationTask = useMediaStore((s) => s.updateGenerationTask);
  const removeGenerationTask = useMediaStore((s) => s.removeGenerationTask);
  const addToast = useToastStore((s) => s.addToast);

  // ──── 本地 UI 状态 ────
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [sortBy, setSortBy] = useState<SortBy>("date_desc");
  const [viewMode, setViewMode] = useState<"masonry" | "grid">("masonry");
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  // BUG-5 修复：图片/视频各自独立分页计数。
  // 原实现用合并 offset 计算页码（offset+PAGE_SIZE 后 page 跳 1），
  // 图片与视频数量不均时必然跳页丢数据。
  const imgPageRef = useRef(1);
  const vidPageRef = useRef(1);
  const initialLoadDone = useRef(false);
  const [showUpload, setShowUpload] = useState(false);
  const [imageMeta, setImageMeta] = useState<ImageMetadata | null>(null);
  const [analyzingImage, setAnalyzingImage] = useState(false);
  // 删除确认：暂存待删除项
  const [deleteConfirming, setDeleteConfirming] = useState<GalleryItem | null>(
    null,
  );

  // 批量选择
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 图片对比
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null);

  // 编辑会话竞态保护：每次打开编辑时 +1
  const editSessionRef = useRef(0);
  /** 竞态保护修正（2026-08-26）：记录打开的编辑 session，关闭时比较 */
  const openedEditSessionRef = useRef(0);

  // 画廊滚动位置保存/恢复
  const galleryScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);

  // 滚动位置恢复：loadGallery 完成后还原 scrollTop
  useEffect(() => {
    if (pendingScrollTopRef.current !== null && galleryScrollRef.current) {
      const saved = pendingScrollTopRef.current;
      pendingScrollTopRef.current = null;
      // requestAnimationFrame 确保 DOM 已更新
      requestAnimationFrame(() => {
        if (galleryScrollRef.current) {
          galleryScrollRef.current.scrollTop = saved;
        }
      });
    }
  }, [galleryItems]);

  // 路由守卫：编辑中拦截 React Router 导航跳转
  useEffect(() => {
    if (!isEditing) return;
    // 使用 popstate 事件拦截浏览器回退/前进（history.block 的底层原理也需要配合）
    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      window.history.pushState({ editing: true }, "");
      if (window.confirm(t("media.unsavedLeaveConfirm"))) {
        setEditingImage(null);
      }
    };
    window.history.pushState({ editing: true }, "");
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isEditing, setEditingImage, t]);

  // ──── 拖拽到聊天区 ────
  const handleDragStart = useCallback(
    (e: React.DragEvent, item: GalleryItem) => {
      e.dataTransfer.setData("text/plain", item.url);
      e.dataTransfer.setData(
        "application/pyapp-media",
        JSON.stringify({
          url: item.url,
          type: item.type,
          id: item.id,
        }),
      );
      e.dataTransfer.effectAllowed = "copy";
    },
    [],
  );

  // ──── 图片对比 ────
  const handleCompareToggle = useCallback((id: string) => {
    setCompareIds((prev) => {
      if (!prev) return [id, ""] as [string, string];
      if (prev[0] === id) return null;
      if (!prev[1]) return [prev[0], id] as [string, string];
      // 已有两张，替换第二张
      return [prev[0], id] as [string, string];
    });
  }, []);

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // P0-3（2026-08-26）：右键触发点——瀑布流/网格卡片 onContextMenu 调用，
  // 此前 ContextMenu 组件完整但无任何触发点（死代码）
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, item: GalleryItem) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, item });
    },
    [],
  );

  // ──── 紧凑/完整模式 ────
  const isCompact = selectedId === null;

  // ──── 筛选 + 排序后的画廊项 ────
  const favoriteIds = useMediaStore((s) => s.favoriteIds);
  const toggleFavorite = useMediaStore((s) => s.toggleFavorite);

  const filteredItems = useMemo(() => {
    let items = galleryItems;
    if (filterType === "favorites") {
      items = items.filter((item) => favoriteIds.has(item.id));
    } else if (filterType !== "all") {
      items = items.filter((item) => item.type === filterType);
    }

    // P0-1（2026-08-26）：关键词 + 日期范围过滤（前端）
    const keyword = searchParams.keyword.trim().toLowerCase();
    if (keyword) {
      items = items.filter((item) => {
        const name = extractFileName(item.url).toLowerCase();
        const alt = (item.alt || "").toLowerCase();
        return name.includes(keyword) || alt.includes(keyword);
      });
    }
    if (searchParams.dateRange !== "all") {
      const now = new Date();
      const cutoff = new Date();
      if (searchParams.dateRange === "today") {
        cutoff.setHours(0, 0, 0, 0);
      } else if (searchParams.dateRange === "7days") {
        cutoff.setDate(now.getDate() - 7);
      } else if (searchParams.dateRange === "30days") {
        cutoff.setDate(now.getDate() - 30);
      }
      items = items.filter((item) => {
        const dateStr = extractDate(item.url);
        if (!dateStr) return false;
        return new Date(`${dateStr}T00:00:00`) >= cutoff;
      });
    }

    return [...items].sort((a, b) => {
      if (sortBy === "name") {
        return extractFileName(a.url).localeCompare(extractFileName(b.url));
      }
      const dateA = extractDate(a.url);
      const dateB = extractDate(b.url);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return sortBy === "date_desc"
        ? dateB.localeCompare(dateA)
        : dateA.localeCompare(dateB);
    });
  }, [
    galleryItems,
    filterType,
    sortBy,
    favoriteIds,
    searchParams.keyword,
    searchParams.dateRange,
  ]);

  // ──── 类型计数 ────
  const typeCounts = useMemo(() => {
    const images = galleryItems.filter((i) => i.type === "image").length;
    const videos = galleryItems.filter((i) => i.type === "video").length;
    return {
      all: galleryItems.length,
      images,
      videos,
      // BUG-13（2026-08-26）：按已加载页内收藏计，避免含未加载分页导致虚高
      favorites: galleryItems.filter((i) => favoriteIds.has(i.id)).length,
    };
  }, [galleryItems, favoriteIds]);

  // ──── 加载图库（首次加载 / 分页追加） ────
  const loadGallery = useCallback(
    async (append = false) => {
      if (append && !galleryHasMore) return; // 无更多数据时跳过

      // BUG-5 修复：图片/视频各自独立页码，不再从合并 offset 推算。
      const imgPage = append ? imgPageRef.current : 1;
      const vidPage = append ? vidPageRef.current : 1;
      useMediaStore.setState({ galleryLoading: true });

      try {
        const q = (page: number) => {
          const p = new URLSearchParams();
          p.set("pageSize", String(PAGE_SIZE));
          p.set("page", String(page));
          // P0-1 第二阶段：keyword 透传后端过滤（本地过滤保留做即时反馈）
          const kw = searchParams.keyword.trim();
          if (kw) p.set("keyword", kw);
          // BUG-E（2026-08-26）：dateRange 透传后端按 mtime 过滤，
          // 否则 hasMore 基于全量分页判断 → 筛选下无限滚动空转
          if (searchParams.dateRange !== "all") {
            p.set("dateRange", searchParams.dateRange);
          }
          return p.toString();
        };

        const [imgRes, vidRes] = await Promise.all([
          http.get<{ images: ImageApiItem[] }>(`/v1/images/list?${q(imgPage)}`),
          http.get<{ videos: VideoApiItem[] }>(`/v1/videos/list?${q(vidPage)}`),
        ]);

        const images: GalleryItem[] = (
          imgRes.ok && imgRes.data?.images ? imgRes.data.images : []
        ).map((img) => ({
          id: `img:${img.path || img.url}`,
          type: "image" as const,
          url: img.url,
          thumbnailUrl: img.url,
          width: img.width,
          height: img.height,
          alt: img.alt || "",
        }));

        const videos: GalleryItem[] = (
          vidRes.ok && vidRes.data?.videos ? vidRes.data.videos : []
        ).map((vid) => ({
          id: `vid:${vid.path || vid.url}`,
          type: "video" as const,
          url: vid.url,
          // BUG-5/10（2026-08-26）：视频 poster 用后端缩略图端点（mtime 缓存）
          thumbnailUrl: vid.url.startsWith("/v1/videos/static/")
            ? `/v1/videos/thumbnail?path=${encodeURIComponent(vid.url.slice("/v1/videos/static/".length))}`
            : vid.url,
          duration: vid.duration,
          width: vid.width,
          height: vid.height,
        }));

        const newItems = [...images, ...videos];
        // 图片/视频各自的 hasMore 分开判定，任一还有数据即可继续翻页
        const imgCount = imgRes.ok ? (imgRes.data?.images?.length ?? 0) : 0;
        const vidCount = vidRes.ok ? (vidRes.data?.videos?.length ?? 0) : 0;
        const hasMore = imgCount >= PAGE_SIZE || vidCount >= PAGE_SIZE;

        if (append) {
          // 本页已消费，页码前进；下一页继续各取各的
          imgPageRef.current += 1;
          vidPageRef.current += 1;
          useMediaStore.getState().appendGalleryItems(newItems, hasMore);
        } else {
          imgPageRef.current = 2;
          vidPageRef.current = 2;
          useMediaStore.setState({
            galleryItems: newItems,
            galleryLoading: false,
            galleryHasMore: hasMore,
            galleryOffset: newItems.length,
          });
        }
        logger.info("图库加载完成", {
          append,
          imgPage,
          vidPage,
          images: images.length,
          videos: videos.length,
        });
      } catch (e) {
        logger.warn("加载图库失败", { error: String(e) });
        // BUG-D（2026-08-26）：append 失败也必须重置 loading，
        // 否则 galleryLoading 永久 true → 无限滚动死锁无法重试
        if (!append) {
          useMediaStore.setState({
            galleryItems: [],
            galleryLoading: false,
            galleryHasMore: false,
          });
        } else {
          useMediaStore.setState({ galleryLoading: false });
        }
      }
    },
    [galleryHasMore, searchParams.keyword, searchParams.dateRange],
  );

  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true; // 同步设置，防止 StrictMode 双重调用
      loadGallery();
    }
  }, [loadGallery]);

  // P0-1（2026-08-26）：搜索变更 → 重置分页并重新加载第一页
  // 避免"本地过滤 N 条 + 翻页返回未过滤数据"错位
  const prevSearchKeyRef = useRef(
    `${searchParams.keyword}|${searchParams.dateRange}`,
  );
  useEffect(() => {
    const key = `${searchParams.keyword}|${searchParams.dateRange}`;
    if (prevSearchKeyRef.current === key) return;
    prevSearchKeyRef.current = key;
    imgPageRef.current = 1;
    vidPageRef.current = 1;
    loadGallery(false);
  }, [searchParams.keyword, searchParams.dateRange, loadGallery]);

  // 监听对话中 AI 生图完成事件（chatService 派发 pyapp:image_generated），
  // 自动刷新媒体库，与 ImagePage 的 useImageGallery 保持一致行为。
  useEffect(() => {
    const handler = () => {
      // 次要项（2026-08-26）：保存滚动位置，刷新后恢复，避免浏览深页被拉回顶部
      if (galleryScrollRef.current) {
        pendingScrollTopRef.current = galleryScrollRef.current.scrollTop;
      }
      loadGallery();
    };
    window.addEventListener("pyapp:image_generated", handler);
    return () => {
      window.removeEventListener("pyapp:image_generated", handler);
    };
  }, [loadGallery]);

  // ──── 轮询 ────
  // P0-2（2026-08-26）：onTaskCompleted 携带 taskId——同步 generationTask 为 completed
  // （此前只 loadGallery 不更新任务 → 视频任务永远卡"生成中"），再刷新画廊
  const handleTaskCompleted = useCallback(
    (taskId: string) => {
      // P2（2026-08-26）：generationTask.id 是本地 vid_xxx，回调携带后端 UUID，
      // 先按 remoteTaskId 匹配，找不到再按 id 匹配
      const tasks = useMediaStore.getState().generationTasks;
      const matched = tasks.find(
        (t) => t.remoteTaskId === taskId || t.id === taskId,
      );
      const targetId = matched ? matched.id : taskId;
      updateGenerationTask(targetId, { status: "completed", progress: 100 });
      loadGallery();
    },
    [updateGenerationTask, loadGallery],
  );

  const { submitTask, cancelTask } = useVideoTaskPolling(handleTaskCompleted);
  // MD-2（2026-10-06）：状态源已收敛为单一事实源 `generationTasks`（图片/视频统一）
  // ⇒ 「生成中」判定只看它（原实现还叠加 `activeTasks`，属双轨影子副本）
  const generating = generationTasks.some((t) => t.status === "running");

  // ──── 选中项切换时重置视频元数据 + 拉取图片元数据 ────
  useEffect(() => {
    setVideoMeta(null);
    setImageMeta(null);

    const selectedItem = galleryItems.find((i) => i.id === selectedId);
    if (!selectedItem) return;

    // P2-12 修复：仅图片项拉取 /v1/images/metadata。
    // 原实现未区分类型，选中视频时也发该请求 → 视频 URL 不匹配图片前缀 → 403 报错噪音。
    if (selectedItem.type !== "image") return;

    const encodedPath = encodeURIComponent(
      selectedItem.url.replace(/^\/v1\/images\/static\//, ""),
    );
    http
      .get<ImageMetadata>(`/v1/images/metadata?path=${encodedPath}`)
      .then((resp) => {
        if (resp.ok && resp.data) {
          setImageMeta(resp.data);
        }
      })
      .catch(() => {
        /* 图片元数据不可用时静默忽略 */
      });
  }, [selectedId]);

  /** "生成类似"：识图 → 生成 prompt → 切换图片模式 */
  const handleGenerateSimilar = useCallback(async () => {
    if (analyzingImage) return;
    const item = galleryItems.find((i) => i.id === selectedId);
    if (!item || !imageMeta?.path) {
      addToast("error", t("media.cannotGetImagePath"));
      return;
    }

    setAnalyzingImage(true);
    try {
      const analysis = await imageService.analyze(imageMeta.path, "vision", {
        prompt:
          "请详细描述这张图片的视觉内容，包括主题、风格、颜色、构图、光线等，以便用于生成一张类似风格的图片。",
      });

      if (analysis.description) {
        useMediaStore.getState().setMode("image");
        useMediaStore.getState().setSelectedImage(item.url, item.id);
        useMediaStore.getState().setPrompt(analysis.description);
        addToast("success", t("media.recognizedReady"));
        logger.info("识图成功", { descLen: analysis.description.length });
      } else {
        useMediaStore.getState().setMode("image");
        useMediaStore.getState().setSelectedImage(item.url, item.id);
        useMediaStore.getState().setPrompt("生成一张类似风格的图片");
        addToast("info", t("media.recognizeEmptyFilled"));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn("识图调用失败", { error: errMsg, path: imageMeta?.path });
      useMediaStore.getState().setMode("image");
      useMediaStore.getState().setSelectedImage(item.url, item.id);
      useMediaStore.getState().setPrompt("生成一张类似风格的图片");
      addToast(
        "info",
        t("media.recognizeFailedFilled", { err: errMsg.slice(0, 40) }),
      );
    } finally {
      setAnalyzingImage(false);
    }
  }, [selectedId, galleryItems, imageMeta, addToast, t]);

  // ──── 上传完成回调 ────
  const handleUploaded = useCallback(
    (_result: { path: string; url: string }) => {
      addToast("success", t("media.uploadSuccess"));
      loadGallery();
      setShowUpload(false);
    },
    [addToast, loadGallery, t],
  );

  // ──── 生成（图片 / 视频） ────
  /**
   * 提交视频生成任务（MD-10，2026-10-06 抽取：`handleGenerate` 与「重试」共用，
   * 避免同一提交流程两处实现 —— 见 `project_rules §1.3`「方法禁止重复」）。
   *
   * 写入 `generationTasks`（含 `videoParams` 供重试**忠实重放**）→ 调后端 →
   * 记录 `remoteTaskId` → 启动轮询（MD-2：轮询直接读写该列表，无影子副本）。
   */
  const submitVideoTask = useCallback(
    async (args: {
      prompt: string;
      imageUrl: string | null;
      duration: number;
      aspectRatio: string;
    }): Promise<void> => {
      const taskId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      addGenerationTask({
        id: taskId,
        type: "video",
        status: "running",
        progress: 10,
        prompt: args.prompt,
        videoParams: {
          duration: args.duration,
          aspectRatio: args.aspectRatio,
        },
        sourceImageUrl: args.imageUrl,
        resultUrl: null,
        error: null,
        createdAt: Date.now(),
      });

      try {
        const result = await videoService.createVideoTask({
          mode: args.imageUrl ? "image-to-video" : "text-to-video",
          prompt: args.prompt,
          imageUrl: args.imageUrl || undefined,
          duration: args.duration,
          aspectRatio: args.aspectRatio,
        });
        if (result.taskId) {
          // P2：记录后端 taskId（generationTask.id 是本地 vid_xxx，回调时需关联）
          updateGenerationTask(taskId, {
            progress: 30,
            remoteTaskId: result.taskId,
          });
          submitTask(result.taskId);
        } else {
          // 次要项（2026-08-26）：异常响应兜底，避免任务卡 running
          updateGenerationTask(taskId, {
            status: "failed",
            error: t("media.videoTaskNoId"),
          });
          addToast("error", t("media.videoGenerateNoIdFailed"));
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        updateGenerationTask(taskId, {
          status: "failed",
          error: errMsg,
        });
        // 对用户显示友好信息，原始错误保留在任务详情中便于排查
        addToast(
          "error",
          t("media.videoGenerateFailed", { error: friendlyErrorSummary(e) }),
        );
        logger.error("视频生成失败", { error: errMsg });
      }
    },
    [addGenerationTask, updateGenerationTask, submitTask, addToast, t],
  );

  /**
   * MD-10（2026-10-06）：失败任务「重试」。
   *
   * **仅视频任务**：原请求参数（`prompt` / `sourceImageUrl` / `videoParams`）已完整留存
   * ⇒ 可忠实重放。图片任务缺 model/size 等原始参数 ⇒ 不给按钮（避免用不同参数静默重跑）。
   */
  const handleRetryTask = useCallback(
    async (id: string) => {
      const task = useMediaStore
        .getState()
        .generationTasks.find((t) => t.id === id);
      if (!task || task.type !== "video") return;

      // 移除失败卡，避免新旧任务在任务栏重复占位
      removeGenerationTask(id);
      await submitVideoTask({
        prompt: task.prompt,
        imageUrl: task.sourceImageUrl,
        duration: task.videoParams?.duration ?? 5,
        aspectRatio: task.videoParams?.aspectRatio ?? "16:9",
      });
    },
    [removeGenerationTask, submitVideoTask],
  );

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() && !selectedImageUrl) return;

    if (mode === "image") {
      // 未配置生图模型时友好引导，避免直接报错
      if (modelHints?.image === false) {
        addToast(
          "warning",
          t("media.noImageModelHint"),
          t("media.noImageModelHintDesc"),
        );
        return;
      }
      // i2i 竞态（2026-08-26）：选中参考图但元数据异步未就绪时拦截，
      // 否则 inputImage 缺失 → 退化文生图
      if (selectedImageUrl && !imageMeta?.path) {
        addToast("info", t("media.loadingReferenceImage"));
        return;
      }
      // 图片生成（纳入任务队列）
      const taskId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      addGenerationTask({
        id: taskId,
        type: "image",
        status: "running",
        progress: 30,
        prompt: prompt.trim() || "生成一张图片",
        sourceImageUrl: selectedImageUrl || null,
        resultUrl: null,
        error: null,
        createdAt: Date.now(),
      });

      try {
        // 2026-08-26：长宽比 → 像素 size 传给后端（此前仅传 n，尺寸选择不生效）
        const genOptions: Record<string, unknown> = {
          n: params.count || 1,
          size: ratioToSize(params.aspectRatio || "1:1"),
        };
        if (selectedImageUrl && imageMeta?.path) {
          genOptions.inputImage = imageMeta.path;
        }
        const result = await imageService.generate(
          prompt.trim() || "生成一张图片",
          genOptions as Parameters<typeof imageService.generate>[1],
        );
        if (result.images?.length > 0) {
          const urls = result.images.map((img) => img.url);
          updateGenerationTask(taskId, {
            status: "completed",
            progress: 100,
            resultUrl: urls[0],
            // BUG-8（2026-08-26）：多图全量存入，不再只保留首张
            images: urls,
          });
          addToast(
            "success",
            t("media.generatedImages", { count: urls.length }),
          );
          // BUG-9（2026-08-26）：loadGallery 完成后自动选中首张新图
          // BUG-F（2026-08-26）：仅调用一次，此前 719/721 双重加载导致重复请求 + 竞态
          loadGallery().then(() => {
            const first = useMediaStore
              .getState()
              .galleryItems.find((i) => i.url === urls[0]);
            if (first) {
              useMediaStore.getState().setSelectedImage(first.url, first.id);
              // MD-9（2026-10-06）：补**自动定位** —— 此前仅自动选中，用户仍需在列表里
              // 自己找新图（报告 P2-9）。滚动到可见区，与选中形成完整反馈。
              scrollMediaItemIntoView(first.id);
            }
          });
          useMediaStore.getState().setPrompt("");
        } else {
          // P0-2（2026-08-26，BUG-14）：空结果兜底——此前无 else 分支导致任务永远 running
          updateGenerationTask(taskId, {
            status: "failed",
            progress: 0,
            error: t("media.emptyResultError"),
          });
          addToast("error", t("media.imageGenerateEmptyFailed"));
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        updateGenerationTask(taskId, {
          status: "failed",
          progress: 0,
          error: errMsg,
        });
        // 对用户显示友好信息，原始错误保留在任务详情中便于排查
        addToast(
          "error",
          t("media.imageGenerateFailed", { error: friendlyErrorSummary(e) }),
        );
        logger.error("图片生成失败", { error: errMsg });
      }
    } else {
      // 未配置生视频模型时友好引导，避免直接报错
      if (modelHints?.video === false) {
        addToast(
          "warning",
          t("media.noVideoModelHint"),
          t("media.noVideoModelHintDesc"),
        );
        return;
      }
      // 视频生成（纳入任务队列）—— MD-10：抽到 `submitVideoTask`，与「重试」共用同一实现
      await submitVideoTask({
        prompt: prompt.trim(),
        imageUrl: selectedImageUrl || null,
        duration: params.duration || 5,
        aspectRatio: params.aspectRatio || "16:9",
      });
      useMediaStore.getState().setPrompt("");
    }
  }, [
    prompt,
    mode,
    selectedImageUrl,
    imageMeta,
    params,
    submitVideoTask,
    addToast,
    loadGallery,
    addGenerationTask,
    updateGenerationTask,
    modelHints,
    t,
  ]);

  // ──── 打开 lightbox ────
  const handleOpenLightbox = useCallback(() => {
    const selectedItem = galleryItems.find((i) => i.id === selectedId);
    if (!selectedItem || selectedItem.type !== "image") return;
    const imageItems = galleryItems.filter((i) => i.type === "image");
    const imageUrls = imageItems.map((i) => i.url);
    const idx = imageUrls.indexOf(selectedItem.url);
    setLightboxIndex(idx >= 0 ? idx : 0);
    setLightboxOpen(true);
  }, [selectedId, galleryItems]);

  // ──── lightbox 删除 ────
  // BUG-2 修复：删除按类型分流。原实现一律调 imageService.deleteImage，
  // 视频 URL 不匹配图片前缀 → 后端 403 Access denied。
  const deleteMediaItem = useCallback(
    async (item: GalleryItem): Promise<void> => {
      if (item.type === "video") {
        const backendPath = item.url.replace(/^\/v1\/videos\/static\//, "");
        const ok = await videoService.deleteVideo(backendPath);
        if (!ok) throw new Error("video delete failed");
        return;
      }
      await imageService.deleteImage(item.url);
    },
    [],
  );

  const handleLightboxDelete = useCallback(async () => {
    const imageItems = galleryItems.filter((i) => i.type === "image");
    const currentUrl = imageItems[lightboxIndex]?.url;
    if (!currentUrl) return;
    const currentItem = galleryItems.find((i) => i.url === currentUrl);
    if (!currentItem) return;
    try {
      await deleteMediaItem(currentItem);
      removeGalleryItem(currentItem.id);
      addToast("success", t("media.imageDeleted"));
      // BUG-11（2026-08-26）：删除后选中相邻项，保留查看上下文
      const siblings = galleryItems.filter((i) => i.type === "image");
      const next = siblings[lightboxIndex + 1] || siblings[lightboxIndex - 1];
      if (next) {
        useMediaStore.getState().setSelectedImage(next.url, next.id);
      }
      setLightboxOpen(false);
    } catch {
      addToast("error", t("media.deleteFailed"));
    }
  }, [
    lightboxIndex,
    galleryItems,
    deleteMediaItem,
    removeGalleryItem,
    addToast,
    t,
  ]);

  // ──── 删除（单个，供右键菜单/面板使用） ────
  // 先弹确认框，确认后才执行删除
  const handleDeleteItem = useCallback((item: GalleryItem) => {
    setDeleteConfirming(item);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const item = deleteConfirming;
    if (!item) return;
    setDeleteConfirming(null);
    try {
      await deleteMediaItem(item);
      removeGalleryItem(item.id);
      addToast("success", t("media.deleted"));
    } catch {
      addToast("error", t("media.deleteFailed"));
    }
  }, [deleteConfirming, deleteMediaItem, removeGalleryItem, addToast, t]);

  // ──── 批量删除 ────
  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const items = galleryItems.filter((i) => ids.includes(i.id));
    let success = 0;
    for (const item of items) {
      try {
        await deleteMediaItem(item);
        removeGalleryItem(item.id);
        success++;
      } catch {
        // 继续删除其他项
      }
    }
    addToast("success", t("media.batchDeleted", { count: success }));
    setSelectedIds(new Set());
    setBatchMode(false);
  }, [
    selectedIds,
    galleryItems,
    deleteMediaItem,
    removeGalleryItem,
    addToast,
    t,
  ]);

  // ──── 批量选择切换 ────
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ──── 统一选择处理：对比模式中点击图片直接作为第2张 ────
  const handleGallerySelect = useCallback(
    (id: string) => {
      if (batchMode) {
        toggleSelect(id);
      } else if (compareIds && compareIds[0] && !compareIds[1]) {
        // 对比模式中（已选第1张），点击任意图片作为第2张
        handleCompareToggle(id);
      } else {
        selectMedia(id);
      }
    },
    [batchMode, compareIds, toggleSelect, selectMedia, handleCompareToggle],
  );

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu]);

  const selectedItem = galleryItems.find((i) => i.id === selectedId);
  const selectedFileName = selectedItem
    ? extractFileName(selectedItem.url)
    : "";
  const selectedFormat = selectedItem
    ? extractFormat(selectedFileName, t("media.unknown"))
    : "";
  const selectedDate = selectedItem ? extractDate(selectedItem.url) : "";

  return (
    <div
      className={`flex h-full w-full flex-col ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      {/* ========== 模型配置提示条（生图/生视频模型未配置时显示） ========== */}
      {modelHints &&
        !hintDismissed &&
        (!modelHints.image || !modelHints.video) && (
          <div
            className={`flex items-center gap-2 border-b px-3 py-1.5 text-xs ${
              isDark
                ? "border-amber-700 bg-amber-900/30 text-amber-200"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            <span aria-hidden="true">⚠️</span>
            <span className="flex-1">
              {!modelHints.image && t("media.hintBarNoImageModel")}
              {!modelHints.image && !modelHints.video && " / "}
              {!modelHints.video && t("media.hintBarNoVideoModel")}
              {t("media.hintBarSuffix")}
            </span>
            <button
              onClick={() => navigate("/models?tab=models")}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                isDark
                  ? "bg-amber-700 text-white hover:bg-amber-600"
                  : "bg-amber-500 text-white hover:bg-amber-600"
              }`}
            >
              {t("media.goModelManagement")}
            </button>
            <button
              onClick={() => setHintDismissed(true)}
              className={`rounded px-1.5 py-0.5 transition-colors ${
                isDark
                  ? "text-amber-300 hover:bg-amber-800"
                  : "text-amber-600 hover:bg-amber-100"
              }`}
              aria-label={t("media.dismissHint")}
            >
              ✕
            </button>
          </div>
        )}

      {/* ========== 顶部：模板轮播 ========== */}
      <TemplateCarousel isDark={isDark} />

      {/* ========== 主体：画廊 + 预览区 ========== */}
      <div className="flex flex-1 overflow-hidden">
        {/* ========== 左侧：画廊 ========== */}
        <div
          className={`flex flex-shrink-0 flex-col border-r border-gray-200 dark:border-gray-700 ${
            isCompact ? "flex-1" : "w-80"
          }`}
        >
          {/* 搜索栏 + 筛选 + 排序 + 上传 + 批量操作 */}
          <div className="space-y-2 p-3">
            <GallerySearchBar
              params={searchParams}
              onChange={setSearchParams}
              onRefresh={loadGallery}
            />

            {/* 类型筛选 + 排序 + 视图切换 */}
            <div className="flex items-center gap-1 flex-wrap">
              <FilterTab
                label={t("common.all")}
                count={typeCounts.all}
                active={filterType === "all"}
                onClick={() => {
                  setFilterType("all");
                  // BUG-C（2026-08-26）：selectMedia("") 会把 selectedId 置为 ""（≠ null）
                  // → isCompact 恒 false，右侧空预览区卡死；改用 clearSelectedImage 置 null
                  clearSelectedImage();
                }}
              />
              <FilterTab
                label={t("media.image")}
                count={typeCounts.images}
                active={filterType === "image"}
                onClick={() => {
                  setFilterType("image");
                  clearSelectedImage();
                }}
              />
              <FilterTab
                label={t("media.video")}
                count={typeCounts.videos}
                active={filterType === "video"}
                onClick={() => {
                  setFilterType("video");
                  clearSelectedImage();
                }}
              />
              <FilterTab
                label="⭐"
                count={typeCounts.favorites}
                active={filterType === "favorites"}
                onClick={() => {
                  setFilterType("favorites");
                  clearSelectedImage();
                }}
              />

              {/* 排序下拉 */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className={`ml-1 rounded border px-1.5 py-0.5 text-[10px] ${
                  isDark
                    ? "border-gray-600 bg-gray-700 text-gray-300"
                    : "border-gray-300 bg-white text-gray-600"
                }`}
              >
                <option value="date_desc">{t("media.sortDateDesc")}</option>
                <option value="date_asc">{t("media.sortDateAsc")}</option>
                <option value="name">{t("common.name")}</option>
              </select>

              {/* 视图切换 */}
              <div className="ml-auto flex items-center rounded border border-gray-300 dark:border-gray-600">
                <button
                  onClick={() => setViewMode("masonry")}
                  className={`px-1.5 py-0.5 text-xs ${
                    viewMode === "masonry"
                      ? "bg-blue-500 text-white"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                  title={t("media.viewMasonry")}
                >
                  ▦
                </button>
                <button
                  onClick={() => setViewMode("grid")}
                  className={`px-1.5 py-0.5 text-xs ${
                    viewMode === "grid"
                      ? "bg-blue-500 text-white"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                  title={t("media.viewGrid")}
                >
                  ⊞
                </button>
              </div>
            </div>

            {/* 上传 + 批量操作栏 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowUpload(!showUpload)}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                  showUpload
                    ? "bg-blue-500 text-white"
                    : isDark
                      ? "text-gray-400 hover:bg-gray-700"
                      : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                ⬆️ {t("media.uploadLabel")}
              </button>

              <button
                onClick={() => {
                  setBatchMode(!batchMode);
                  setSelectedIds(new Set());
                }}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                  batchMode
                    ? "bg-blue-500 text-white"
                    : isDark
                      ? "text-gray-400 hover:bg-gray-700"
                      : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                ☑️ {t("media.batchLabel")}
                {selectedIds.size > 0 && ` (${selectedIds.size})`}
              </button>

              {batchMode && selectedIds.size > 0 && (
                <button
                  onClick={handleBatchDelete}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  🗑️ {t("media.deleteSelected")}
                </button>
              )}
            </div>

            {/* 上传区域 */}
            {showUpload && <ImageUploadDrop onUploaded={handleUploaded} />}
          </div>

          {/* 画廊 — flex-1 min-h-0 撑满剩余高度，让 h-full 在 MasonryGallery 内生效 */}
          <div className="flex-1 min-h-0">
            {viewMode === "masonry" ? (
              <MasonryGallery
                items={filteredItems}
                selectedId={selectedId}
                hasMore={galleryHasMore}
                loading={galleryLoading}
                isDark={isDark}
                onSelect={handleGallerySelect}
                onLoadMore={() => loadGallery(true)}
                disabled={isEditing}
                scrollRef={galleryScrollRef}
                onContextMenu={handleContextMenu}
                onDragStart={handleDragStart}
              />
            ) : (
              <MediaGridView
                items={filteredItems}
                selectedId={selectedId}
                isDark={isDark}
                onSelect={handleGallerySelect}
                batchMode={batchMode}
                selectedIds={batchMode ? selectedIds : null}
                favoriteIds={favoriteIds}
                onToggleFavorite={toggleFavorite}
                onDragStart={handleDragStart}
                onCompareToggle={handleCompareToggle}
                onContextMenu={handleContextMenu}
                hasMore={galleryHasMore}
                loading={galleryLoading}
                onLoadMore={() => loadGallery(true)}
                disabled={isEditing}
              />
            )}
          </div>
        </div>

        {/* ========== 右侧：预览区 ========== */}
        {!isCompact && (
          <div className="flex flex-1 flex-col overflow-y-auto border-l border-gray-200 dark:border-gray-700">
            {/* 图片对比模式 */}
            {compareIds && compareIds[0] && (
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {t("media.compareTitle")}
                    {compareIds[1] && t("media.compareSideBySide")}
                    {!compareIds[1] && t("media.compareSelectSecond")}
                  </h3>
                  <button
                    onClick={() => setCompareIds(null)}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    {t("media.compareExit")}
                  </button>
                </div>
                {compareIds[1] ? (
                  <div className="grid grid-cols-2 gap-2">
                    {(() => {
                      const imgA = galleryItems.find(
                        (i) => i.id === compareIds[0],
                      );
                      const imgB = galleryItems.find(
                        (i) => i.id === compareIds[1],
                      );
                      return (
                        <>
                          <CompareImage item={imgA} isDark={isDark} />
                          <CompareImage item={imgB} isDark={isDark} />
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6 text-xs text-gray-400">
                    {t("media.comparePickHint")}
                  </div>
                )}
              </div>
            )}

            {(!compareIds || !compareIds[1]) && selectedItem ? (
              <div className="flex flex-1 flex-col p-4 min-h-0">
                {/* 预览 */}
                <div className="flex-shrink-0 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                  {selectedItem.type === "video" ? (
                    <VideoPlayer
                      src={selectedItem.url}
                      onMetaLoaded={(meta) => setVideoMeta(meta)}
                    />
                  ) : (
                    <img
                      src={selectedItem.url}
                      alt={t("common.preview")}
                      className="w-full max-h-[50vh] cursor-pointer rounded-lg object-contain"
                      onClick={handleOpenLightbox}
                      title={t("media.zoomInTitle")}
                    />
                  )}
                </div>

                {/* 操作栏 — 常用操作紧跟预览，无需滚动 */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedItem.type === "image" && (
                    <>
                      <ActionButton
                        label={t("media.zoomIn")}
                        icon="🔍"
                        isDark={isDark}
                        onClick={handleOpenLightbox}
                      />
                      <ActionButton
                        label={t("media.compare")}
                        icon="◧"
                        isDark={isDark}
                        onClick={() => handleCompareToggle(selectedItem.id)}
                      />
                      <ActionButton
                        label={t("media.imageToVideo")}
                        icon="🎬"
                        isDark={isDark}
                        onClick={() => {
                          setIntendedAction({
                            type: "generate-video",
                            sourceImage: {
                              id: selectedItem.id,
                              url: selectedItem.url,
                            },
                            autoSubmit: false,
                          });
                        }}
                      />
                      <ActionButton
                        label={t("media.editImage")}
                        icon="✏️"
                        isDark={isDark}
                        onClick={() => {
                          // 竞态保护修正（2026-08-26）：记录本次打开的 session，
                          // 关闭时比较是否仍是同一 session（此前恒真，保护失效）
                          openedEditSessionRef.current =
                            ++editSessionRef.current;
                          setEditingImage({
                            id: selectedItem.id,
                            url: selectedItem.url,
                          });
                        }}
                      />
                      <ActionButton
                        label={
                          analyzingImage
                            ? t("media.recognizing")
                            : t("media.generateSimilar")
                        }
                        icon={analyzingImage ? "⏳" : "✨"}
                        isDark={isDark}
                        onClick={handleGenerateSimilar}
                      />
                      <ActionButton
                        label={t("common.download")}
                        icon="⬇️"
                        isDark={isDark}
                        onClick={() => window.open(selectedItem.url, "_blank")}
                      />
                      <ActionButton
                        label={t("common.delete")}
                        icon="🗑️"
                        isDark={isDark}
                        danger
                        onClick={() => handleDeleteItem(selectedItem)}
                      />
                    </>
                  )}
                  {selectedItem.type === "video" && (
                    <>
                      <ActionButton
                        label={t("common.download")}
                        icon="⬇️"
                        isDark={isDark}
                        onClick={() => window.open(selectedItem.url, "_blank")}
                      />
                      <ActionButton
                        label={t("common.delete")}
                        icon="🗑️"
                        isDark={isDark}
                        danger
                        onClick={() => handleDeleteItem(selectedItem)}
                      />
                    </>
                  )}
                </div>

                {/* 信息面板 */}
                <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <h3 className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {t("media.fileInfo")}
                  </h3>
                  <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <InfoRow
                      label={t("media.fileName")}
                      value={selectedFileName}
                    />
                    <InfoRow
                      label={t("media.fileType")}
                      value={
                        selectedItem.type === "video"
                          ? t("media.video")
                          : t("media.image")
                      }
                    />
                    <InfoRow
                      label={t("media.format")}
                      value={imageMeta?.format || selectedFormat}
                    />
                    {imageMeta?.width && imageMeta?.height && (
                      <InfoRow
                        label={t("media.dimension")}
                        value={`${imageMeta.width} × ${imageMeta.height}`}
                      />
                    )}
                    {!imageMeta &&
                      selectedItem.width &&
                      selectedItem.height && (
                        <InfoRow
                          label={t("media.dimension")}
                          value={`${selectedItem.width} × ${selectedItem.height}`}
                        />
                      )}
                    {imageMeta?.size && (
                      <InfoRow
                        label={t("media.fileSize")}
                        value={formatFileSize(imageMeta.size)}
                      />
                    )}
                    {selectedItem.duration && (
                      <InfoRow
                        label={t("media.duration")}
                        value={`${selectedItem.duration}s`}
                      />
                    )}
                    {videoMeta && selectedItem.type === "video" && (
                      <InfoRow
                        label={t("media.resolution")}
                        value={`${videoMeta.width} × ${videoMeta.height}`}
                      />
                    )}
                    {imageMeta?.createdAt && (
                      <InfoRow
                        label={t("media.date")}
                        value={formatDate(imageMeta.createdAt)}
                      />
                    )}
                    {!imageMeta && selectedDate && (
                      <InfoRow label={t("media.date")} value={selectedDate} />
                    )}
                    <InfoRow
                      label={t("media.path")}
                      value={selectedItem.url}
                      mono
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
                {t("media.pickMediaHint")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========== 浮动任务状态栏（始终可见） ========== */}
      {generationTasks.length > 0 && (
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
          <div className="max-w-3xl mx-auto">
            <GenerationTaskList
              tasks={generationTasks}
              onDelete={(id) => {
                const task = generationTasks.find((t) => t.id === id);
                // P2（2026-08-26）：删除进行中的视频任务时，同步取消后端任务
                if (
                  task?.type === "video" &&
                  task.remoteTaskId &&
                  ["pending", "queued", "running"].includes(task.status)
                ) {
                  cancelTask(task.remoteTaskId);
                }
                removeGenerationTask(id);
              }}
              onRetry={handleRetryTask}
            />
            {/* P0-2（2026-08-26）：展示源收敛——任务进度/完成态统一由 generationTasks 展示，
                移除 TaskList 重复渲染（双卡问题）；MD-2（2026-10-06）进一步删除 activeTasks 影子副本 */}
          </div>
        </div>
      )}

      {/* ========== 底部：统一输入栏 ========== */}
      <BottomInputBar
        isDark={isDark}
        generating={generating}
        onGenerate={handleGenerate}
      />

      {/* ========== EditLayer 编辑模态层 ========== */}
      {editingImage && (
        <EditLayer
          imageUrl={editingImage.url}
          imageId={editingImage.id}
          onSaveSuccess={() => addToast("success", t("media.imageSaved"))}
          onClose={() => {
            setEditingImage(null);
            // 竞态保护修正（2026-08-26）：仅当仍是本 session 打开时才刷新画廊
            // （此前读取当前值比较恒真，保护逻辑失效）
            if (openedEditSessionRef.current === editSessionRef.current) {
              // 保存当前滚动位置，loadGallery 完成后自动恢复
              if (galleryScrollRef.current) {
                pendingScrollTopRef.current =
                  galleryScrollRef.current.scrollTop;
              }
              loadGallery();
            }
          }}
        />
      )}

      {/* ========== ImageViewer lightbox ========== */}
      {lightboxOpen && selectedItem && (
        <ImageViewer
          images={galleryItems
            .filter((i) => i.type === "image")
            .map((i) => i.url)}
          initialIndex={lightboxIndex}
          onClose={() => {
            setLightboxOpen(false);
            // BUG-11（2026-08-26）：仅关闭 lightbox，保留选中项上下文（预览区继续显示）
          }}
          onDelete={handleLightboxDelete}
        />
      )}

      {/* ========== 右键菜单 ========== */}
      {contextMenu && (
        <ContextMenu
          item={contextMenu.item}
          x={contextMenu.x}
          y={contextMenu.y}
          isDark={isDark}
          onAction={(action) => {
            setContextMenu(null);
            const item = contextMenu.item;
            if (action === "download") {
              // P2（2026-08-26）：下载改 blob 保存，替代直接打开新标签页
              fetch(item.url)
                .then((resp) => resp.blob())
                .then((blob) => {
                  const objUrl = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = objUrl;
                  a.download = extractFileName(item.url) || "download";
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(objUrl);
                })
                .catch(() => {
                  // 降级：直接打开
                  window.open(item.url, "_blank");
                });
            } else if (action === "delete") {
              handleDeleteItem(item);
            } else if (action === "edit" || action === "generate-video") {
              setIntendedAction({
                type: action === "edit" ? "edit-image" : "generate-video",
                sourceImage: { id: item.id, url: item.url },
                autoSubmit: false,
              });
            } else if (action === "copy-path") {
              navigator.clipboard
                .writeText(item.url)
                .then(() => {
                  addToast("success", t("media.pathCopied"));
                })
                .catch(() => {});
            } else if (action === "extract-audio") {
              // P0-3 第二步（2026-08-26）：接通 POST /v1/videos/extract-audio
              if (item.type !== "video") return;
              const relPath = item.url.startsWith("/v1/videos/static/")
                ? decodeURIComponent(
                    item.url.slice("/v1/videos/static/".length),
                  )
                : item.url;
              http
                .post<{ success: boolean; url: string }>(
                  `/v1/videos/extract-audio?path=${encodeURIComponent(relPath)}`,
                )
                .then((r) => {
                  if (r.ok && r.data?.url) {
                    addToast("success", t("media.audioExtracted"));
                    window.open(r.data.url, "_blank");
                  } else {
                    addToast("error", t("media.audioExtractFailed"));
                  }
                })
                .catch((e) =>
                  addToast(
                    "error",
                    t("media.audioExtractFailedDetail", {
                      error: friendlyErrorSummary(e),
                    }),
                  ),
                );
            }
          }}
        />
      )}

      {/* 删除确认弹窗 — Portal 到 body 避免被卡片容器裁剪 */}
      {deleteConfirming &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => setDeleteConfirming(null)}
          >
            <div
              className={`rounded-lg p-4 shadow-xl ${isDark ? "bg-gray-700 text-gray-200" : "bg-white text-gray-700"}`}
              style={{ minWidth: 280 }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="mb-3 text-sm">
                {deleteConfirming.type === "video"
                  ? t("media.confirmDeleteVideo")
                  : t("media.confirmDeleteImage")}
              </p>
              <p
                className="mb-3 text-xs text-gray-400 truncate"
                title={extractFileName(deleteConfirming.url)}
              >
                {extractFileName(deleteConfirming.url)}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeleteConfirming(null)}
                  className={`rounded px-3 py-1 text-xs ${isDark ? "bg-gray-600 hover:bg-gray-500" : "bg-gray-100 hover:bg-gray-200"}`}
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="rounded bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600"
                >
                  {t("common.delete")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ──── 子组件 ────────────────────────────────────────────

/** 筛选 Tab */
const FilterTab: React.FC<{
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}> = ({ label, count, active, onClick }) => (
  <button
    onClick={onClick}
    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? "bg-blue-500 text-white"
        : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600"
    }`}
  >
    {label}
    <span className={`ml-1 ${active ? "text-white/70" : "text-gray-400"}`}>
      {count}
    </span>
  </button>
);

/** 信息行 */
const InfoRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <div className="flex items-start gap-2">
    <span className="min-w-[3em] text-gray-400 dark:text-gray-500">
      {label}
    </span>
    <span
      className={`truncate ${mono ? "font-mono text-[10px]" : ""}`}
      title={value}
    >
      {value}
    </span>
  </div>
);

/** 操作栏按钮 */
const ActionButton: React.FC<{
  label: string;
  icon: string;
  isDark: boolean;
  onClick: () => void;
  danger?: boolean;
}> = ({ label, icon, isDark, onClick, danger }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs transition-colors ${
      danger
        ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
        : isDark
          ? "text-gray-300 hover:bg-gray-700"
          : "text-gray-600 hover:bg-gray-100"
    }`}
  >
    <span>{icon}</span>
    <span>{label}</span>
  </button>
);

/** 右键菜单 */
const ContextMenu: React.FC<{
  item: GalleryItem;
  x: number;
  y: number;
  isDark: boolean;
  onAction: (action: string) => void;
}> = ({ item, x, y, isDark, onAction }) => {
  const { t } = useTranslation();
  const isImage = item.type === "image";

  return (
    <div
      className="fixed z-50 rounded-lg border py-1 shadow-xl"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={
          isDark
            ? "border-gray-600 bg-gray-700 text-gray-200"
            : "border-gray-200 bg-white text-gray-700"
        }
      >
        {isImage && (
          <>
            <MenuItem
              label={t("media.editImageMenu")}
              icon="✏️"
              onClick={() => onAction("edit")}
            />
            <MenuItem
              label={t("media.imageToVideo")}
              icon="🎬"
              onClick={() => onAction("generate-video")}
            />
          </>
        )}
        <MenuItem
          label={t("common.download")}
          icon="⬇️"
          onClick={() => onAction("download")}
        />
        <MenuItem
          label={t("media.copyPath")}
          icon="📋"
          onClick={() => onAction("copy-path")}
        />
        {!isImage && (
          <MenuItem
            label={t("media.extractAudio")}
            icon="🎵"
            onClick={() => onAction("extract-audio")}
          />
        )}
        <div className="my-1 border-t border-gray-200 dark:border-gray-600" />
        <MenuItem
          label={t("common.delete")}
          icon="🗑️"
          danger
          onClick={() => onAction("delete")}
        />
      </div>
    </div>
  );
};

/** 右键菜单项 */
const MenuItem: React.FC<{
  label: string;
  icon: string;
  onClick: () => void;
  danger?: boolean;
}> = ({ label, icon, onClick, danger }) => (
  <button
    onClick={onClick}
    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
      danger ? "text-red-500" : ""
    }`}
  >
    <span>{icon}</span>
    <span>{label}</span>
  </button>
);

/**
 * MD-9（2026-10-06，`.pyapp/output/媒体页排查报告.md` P2-9）：把指定画廊项滚动到可见区。
 *
 * 生成完成 → `loadGallery()` 全量刷新会重建列表 ⇒ 需**等两帧**（React 提交 DOM 后）
 * 再查询；卡片以 `data-media-id` 标注（瀑布流与网格视图均已加）。
 * 用 `block:'nearest'` 避免整页跳动（只保证"可见"，不强制置顶）。
 */
function scrollMediaItemIntoView(id: string): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-media-id="${id}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  });
}

export default MediaPage;

/** 对比图片面板 */
const CompareImage: React.FC<{
  item: GalleryItem | undefined;
  isDark: boolean;
}> = ({ item, isDark }) => {
  const { t } = useTranslation();
  if (!item) {
    return (
      <div
        className={`flex aspect-square items-center justify-center rounded-lg border ${
          isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-gray-100"
        }`}
      >
        <span className="text-xs text-gray-400">{t("media.notSelected")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <img
          src={item.url}
          alt={item.alt || ""}
          className="w-full object-contain"
          loading="lazy"
        />
      </div>
      <p
        className="truncate text-[10px] text-gray-500 dark:text-gray-400"
        title={extractFileName(item.url)}
      >
        {extractFileName(item.url)}
      </p>
      {item.width && item.height && (
        <p className="text-[10px] text-gray-400">
          {item.width}×{item.height}
        </p>
      )}
    </div>
  );
};
