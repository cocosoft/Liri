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
import { useConfigStore } from "../../stores/configStore";
import { useRootStore } from "../../stores/root-store";
import { useMediaStore, type GalleryItem } from "../../stores/mediaStore";
import { useVideoTaskPolling } from "../../hooks/useVideoTaskPolling";
import { useSessionContextSync } from "../../hooks/useSessionContextSync";
import { GallerySearchBar } from "./media/GallerySearchBar";
import { TaskList, GenerationTaskList } from "./media/TaskCard";
import { TemplateCarousel } from "./media/TemplateCarousel";
import { MasonryGallery } from "./media/MasonryGallery";
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

/** 筛选类型 */
type FilterType = "all" | "image" | "video" | "favorites";
/** 排序方式 */
type SortBy = "date_desc" | "date_asc" | "name";

// TODO: Phase 6.5 — 缩略图本地缓存（30 分钟 TTL），在 gallery 图片加载时使用
// import { getCachedThumb, setCachedThumb } from "./media/thumbCache";

/** 从 URL 路径提取文件名 */
function extractFileName(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1] || url;
}

/** 从文件名提取格式 */
function extractFormat(name: string): string {
  const ext = name.split(".").pop()?.toUpperCase();
  return ext || "未知";
}

/** 从 URL 路径提取日期 */
function extractDate(url: string): string {
  const match = url.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

/** 格式化文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 格式化时间戳为日期字符串 */
function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** 右键菜单位置 */
interface ContextMenuState {
  x: number;
  y: number;
  item: GalleryItem;
}

/** API 响应中的图片条目 */
interface ImageApiItem {
  path?: string;
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

/** API 响应中的视频条目 */
interface VideoApiItem {
  path?: string;
  url: string;
  duration?: number;
  width?: number;
  height?: number;
}

/** 元数据响应 */
interface ImageMetadata {
  path: string;
  size: number;
  format: string;
  width: number | null;
  height: number | null;
  createdAt: number;
  modifiedAt: number;
}

function MediaPage() {
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
  const setSearchParams = useMediaStore((s) => s.setSearchParams);
  const removeGalleryItem = useMediaStore((s) => s.removeGalleryItem);

  // ──── SessionHub 上下文同步（Phase 4）──
  // 保存/恢复媒体模块的 prompt、尺寸、风格、当前文件
  useSessionContextSync("media", {
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
  const setIntendedAction = useMediaStore((s) => s.setIntendedAction);
  const clearSelectedImage = useMediaStore((s) => s.clearSelectedImage);
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
      if (window.confirm("有未保存更改，确定离开？")) {
        setEditingImage(null);
      }
    };
    window.history.pushState({ editing: true }, "");
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isEditing, setEditingImage]);

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
  }, [galleryItems, filterType, sortBy, favoriteIds]);

  // ──── 类型计数 ────
  const typeCounts = useMemo(() => {
    const images = galleryItems.filter((i) => i.type === "image").length;
    const videos = galleryItems.filter((i) => i.type === "video").length;
    return {
      all: galleryItems.length,
      images,
      videos,
      favorites: favoriteIds.size,
    };
  }, [galleryItems, favoriteIds]);

  // ──── 加载图库（首次加载 / 分页追加） ────
  const loadGallery = useCallback(async (append = false) => {
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
        thumbnailUrl: vid.url,
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
      if (!append) {
        useMediaStore.setState({
          galleryItems: [],
          galleryLoading: false,
          galleryHasMore: false,
        });
      }
    }
  }, [galleryHasMore]);

  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true; // 同步设置，防止 StrictMode 双重调用
      loadGallery();
    }
  }, [loadGallery]);

  // 监听对话中 AI 生图完成事件（chatService 派发 pyapp:image_generated），
  // 自动刷新媒体库，与 ImagePage 的 useImageGallery 保持一致行为。
  useEffect(() => {
    const handler = () => {
      loadGallery();
    };
    window.addEventListener("pyapp:image_generated", handler);
    return () => {
      window.removeEventListener("pyapp:image_generated", handler);
    };
  }, [loadGallery]);

  // ──── 轮询 ────
  const handleTaskCompleted = useCallback(() => {
    loadGallery();
  }, [loadGallery]);

  const { activeTasks, submitTask } = useVideoTaskPolling(handleTaskCompleted);
  const generating = activeTasks.some((t) =>
    ["pending", "queued", "running"].includes(t.status),
  );

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
      .get<any>(`/v1/images/metadata?path=${encodedPath}`)
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
      addToast("error", "无法获取图片路径");
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
        addToast("success", "已识别图片内容，可直接生成");
        logger.info("识图成功", { descLen: analysis.description.length });
      } else {
        useMediaStore.getState().setMode("image");
        useMediaStore.getState().setSelectedImage(item.url, item.id);
        useMediaStore.getState().setPrompt("生成一张类似风格的图片");
        addToast("info", "识图返回空描述，已填入默认提示词");
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn("识图调用失败", { error: errMsg, path: imageMeta?.path });
      useMediaStore.getState().setMode("image");
      useMediaStore.getState().setSelectedImage(item.url, item.id);
      useMediaStore.getState().setPrompt("生成一张类似风格的图片");
      addToast("info", `识图失败(${errMsg.slice(0, 40)})，已填入默认提示词`);
    } finally {
      setAnalyzingImage(false);
    }
  }, [selectedId, galleryItems, imageMeta, addToast]);

  // ──── 上传完成回调 ────
  const handleUploaded = useCallback(
    (_result: { path: string; url: string }) => {
      addToast("success", "上传成功");
      loadGallery();
      setShowUpload(false);
    },
    [addToast, loadGallery],
  );

  // ──── 生成（图片 / 视频） ────
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() && !selectedImageUrl) return;

    if (mode === "image") {
      // 未配置生图模型时友好引导，避免直接报错
      if (modelHints?.image === false) {
        addToast(
          "warning",
          "未配置生图模型，请先到「模型」页中配置",
          "点击左侧导航「模型」进入模型管理",
        );
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
        const genOptions: Record<string, unknown> = { n: params.count || 1 };
        if (selectedImageUrl && imageMeta?.path) {
          genOptions.inputImage = imageMeta.path;
        }
        const result = await imageService.generate(
          prompt.trim() || "生成一张图片",
          genOptions as Parameters<typeof imageService.generate>[1],
        );
        if (result.images?.length > 0) {
          updateGenerationTask(taskId, {
            status: "completed",
            progress: 100,
            resultUrl: result.images[0].url,
          });
          addToast("success", `已生成 ${result.images.length} 张图片`);
          loadGallery();
          useMediaStore.getState().setPrompt("");
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        updateGenerationTask(taskId, {
          status: "failed",
          progress: 0,
          error: errMsg,
        });
        // 对用户显示友好信息，原始错误保留在任务详情中便于排查
        addToast("error", `图片生成失败：${friendlyErrorSummary(e)}`);
        logger.error("图片生成失败", { error: errMsg });
      }
    } else {
      // 未配置生视频模型时友好引导，避免直接报错
      if (modelHints?.video === false) {
        addToast(
          "warning",
          "未配置生视频模型，请先到「模型」页中配置",
          "点击左侧导航「模型」进入模型管理",
        );
        return;
      }
      // 视频生成（纳入任务队列）
      const taskId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      addGenerationTask({
        id: taskId,
        type: "video",
        status: "running",
        progress: 10,
        prompt: prompt.trim(),
        sourceImageUrl: selectedImageUrl || null,
        resultUrl: null,
        error: null,
        createdAt: Date.now(),
      });

      try {
        const result = await videoService.createVideoTask({
          mode: selectedImageUrl ? "image-to-video" : "text-to-video",
          prompt: prompt.trim(),
          imageUrl: selectedImageUrl || undefined,
          duration: params.duration || 5,
          aspectRatio: params.aspectRatio || "16:9",
        });
        if (result.taskId) {
          updateGenerationTask(taskId, { progress: 30 });
          submitTask(result.taskId);
          useMediaStore.getState().setPrompt("");
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        updateGenerationTask(taskId, {
          status: "failed",
          error: errMsg,
        });
        // 对用户显示友好信息，原始错误保留在任务详情中便于排查
        addToast("error", `视频生成失败：${friendlyErrorSummary(e)}`);
        logger.error("视频生成失败", { error: errMsg });
      }
    }
  }, [
    prompt,
    mode,
    selectedImageUrl,
    imageMeta,
    params,
    submitTask,
    addToast,
    loadGallery,
    addGenerationTask,
    updateGenerationTask,
    modelHints,
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
  const deleteMediaItem = useCallback(async (item: GalleryItem): Promise<void> => {
    if (item.type === "video") {
      const backendPath = item.url.replace(/^\/v1\/videos\/static\//, "");
      const ok = await videoService.deleteVideo(backendPath);
      if (!ok) throw new Error("video delete failed");
      return;
    }
    await imageService.deleteImage(item.url);
  }, []);

  const handleLightboxDelete = useCallback(async () => {
    const imageItems = galleryItems.filter((i) => i.type === "image");
    const currentUrl = imageItems[lightboxIndex]?.url;
    if (!currentUrl) return;
    const currentItem = galleryItems.find((i) => i.url === currentUrl);
    if (!currentItem) return;
    try {
      await deleteMediaItem(currentItem);
      removeGalleryItem(currentItem.id);
      addToast("success", "图片已删除");
      setLightboxOpen(false);
    } catch {
      addToast("error", "删除失败，请重试");
    }
  }, [lightboxIndex, galleryItems, deleteMediaItem, removeGalleryItem, addToast]);

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
      addToast("success", "已删除");
    } catch {
      addToast("error", "删除失败，请重试");
    }
  }, [deleteConfirming, deleteMediaItem, removeGalleryItem, addToast]);

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
    addToast("success", `已删除 ${success} 项`);
    setSelectedIds(new Set());
    setBatchMode(false);
  }, [selectedIds, galleryItems, deleteMediaItem, removeGalleryItem, addToast]);

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
  const selectedFormat = selectedItem ? extractFormat(selectedFileName) : "";
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
              {!modelHints.image && "未配置生图模型"}
              {!modelHints.image && !modelHints.video && " / "}
              {!modelHints.video && "未配置生视频模型"}
              ，请在「模型」页配置后再进行生成。
            </span>
            <button
              onClick={() => navigate("/models?tab=models")}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                isDark
                  ? "bg-amber-700 text-white hover:bg-amber-600"
                  : "bg-amber-500 text-white hover:bg-amber-600"
              }`}
            >
              前往模型管理
            </button>
            <button
              onClick={() => setHintDismissed(true)}
              className={`rounded px-1.5 py-0.5 transition-colors ${
                isDark
                  ? "text-amber-300 hover:bg-amber-800"
                  : "text-amber-600 hover:bg-amber-100"
              }`}
              aria-label="关闭提示"
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
                label="全部"
                count={typeCounts.all}
                active={filterType === "all"}
                onClick={() => {
                  setFilterType("all");
                  selectMedia("");
                }}
              />
              <FilterTab
                label="图片"
                count={typeCounts.images}
                active={filterType === "image"}
                onClick={() => {
                  setFilterType("image");
                  selectMedia("");
                }}
              />
              <FilterTab
                label="视频"
                count={typeCounts.videos}
                active={filterType === "video"}
                onClick={() => {
                  setFilterType("video");
                  selectMedia("");
                }}
              />
              <FilterTab
                label="⭐"
                count={typeCounts.favorites}
                active={filterType === "favorites"}
                onClick={() => {
                  setFilterType("favorites");
                  selectMedia("");
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
                <option value="date_desc">时间↓</option>
                <option value="date_asc">时间↑</option>
                <option value="name">名称</option>
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
                  title="瀑布流"
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
                  title="网格列表"
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
                ⬆️ 上传
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
                ☑️ 批量{selectedIds.size > 0 && ` (${selectedIds.size})`}
              </button>

              {batchMode && selectedIds.size > 0 && (
                <button
                  onClick={handleBatchDelete}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  🗑️ 删除选中
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
              />
            ) : (
              <GridView
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
                    图片对比
                    {compareIds[1] && " — 并排模式"}
                    {!compareIds[1] && " — 已选 1 张，请再选 1 张"}
                  </h3>
                  <button
                    onClick={() => setCompareIds(null)}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    ✕ 退出对比
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
                    点击左侧任意图片选择第二张，或点击卡片 ◧ 按钮
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
                      alt="预览"
                      className="w-full max-h-[50vh] cursor-pointer rounded-lg object-contain"
                      onClick={handleOpenLightbox}
                      title="点击放大查看"
                    />
                  )}
                </div>

                {/* 操作栏 — 常用操作紧跟预览，无需滚动 */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedItem.type === "image" && (
                    <>
                      <ActionButton
                        label="放大查看"
                        icon="🔍"
                        isDark={isDark}
                        onClick={handleOpenLightbox}
                      />
                      <ActionButton
                        label="对比"
                        icon="◧"
                        isDark={isDark}
                        onClick={() => handleCompareToggle(selectedItem.id)}
                      />
                      <ActionButton
                        label="图生视频"
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
                        label="编辑图片"
                        icon="✏️"
                        isDark={isDark}
                        onClick={() => {
                          editSessionRef.current++;
                          setEditingImage({
                            id: selectedItem.id,
                            url: selectedItem.url,
                          });
                        }}
                      />
                      <ActionButton
                        label={analyzingImage ? "识别中…" : "生成类似"}
                        icon={analyzingImage ? "⏳" : "✨"}
                        isDark={isDark}
                        onClick={handleGenerateSimilar}
                      />
                      <ActionButton
                        label="下载"
                        icon="⬇️"
                        isDark={isDark}
                        onClick={() => window.open(selectedItem.url, "_blank")}
                      />
                      <ActionButton
                        label="删除"
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
                        label="下载"
                        icon="⬇️"
                        isDark={isDark}
                        onClick={() => window.open(selectedItem.url, "_blank")}
                      />
                      <ActionButton
                        label="删除"
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
                    文件信息
                  </h3>
                  <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <InfoRow label="文件名" value={selectedFileName} />
                    <InfoRow
                      label="类型"
                      value={selectedItem.type === "video" ? "视频" : "图片"}
                    />
                    <InfoRow
                      label="格式"
                      value={imageMeta?.format || selectedFormat}
                    />
                    {imageMeta?.width && imageMeta?.height && (
                      <InfoRow
                        label="尺寸"
                        value={`${imageMeta.width} × ${imageMeta.height}`}
                      />
                    )}
                    {!imageMeta &&
                      selectedItem.width &&
                      selectedItem.height && (
                        <InfoRow
                          label="尺寸"
                          value={`${selectedItem.width} × ${selectedItem.height}`}
                        />
                      )}
                    {imageMeta?.size && (
                      <InfoRow
                        label="大小"
                        value={formatFileSize(imageMeta.size)}
                      />
                    )}
                    {selectedItem.duration && (
                      <InfoRow
                        label="时长"
                        value={`${selectedItem.duration}s`}
                      />
                    )}
                    {videoMeta && selectedItem.type === "video" && (
                      <InfoRow
                        label="分辨率"
                        value={`${videoMeta.width} × ${videoMeta.height}`}
                      />
                    )}
                    {imageMeta?.createdAt && (
                      <InfoRow
                        label="日期"
                        value={formatDate(imageMeta.createdAt)}
                      />
                    )}
                    {!imageMeta && selectedDate && (
                      <InfoRow label="日期" value={selectedDate} />
                    )}
                    <InfoRow label="路径" value={selectedItem.url} mono />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
                点击左侧媒体项以查看详情
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========== 浮动任务状态栏（始终可见） ========== */}
      {(generationTasks.length > 0 || activeTasks.length > 0) && (
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
          <div className="max-w-3xl mx-auto">
            <GenerationTaskList
              tasks={generationTasks}
              onDelete={(id) => removeGenerationTask(id)}
            />
            <TaskList
              tasks={activeTasks}
              onDelete={(taskId) => useMediaStore.getState().removeTask(taskId)}
            />
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
          onSaveSuccess={() => addToast("success", "图片已保存")}
          onClose={() => {
            const sessionId = editSessionRef.current;
            setEditingImage(null);
            // 竞态保护：只有当前 session 才刷新画廊
            if (sessionId === editSessionRef.current) {
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
            clearSelectedImage();
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
              window.open(item.url, "_blank");
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
                  addToast("success", "路径已复制");
                })
                .catch(() => {});
            } else if (action === "extract-audio") {
              addToast("info", "音频提取功能开发中");
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
                  ? "确定要删除此视频吗？此操作不可撤销。"
                  : "确定要删除此图片吗？此操作不可撤销。"}
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
                  取消
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="rounded bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600"
                >
                  删除
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
              label="编辑图像"
              icon="✏️"
              onClick={() => onAction("edit")}
            />
            <MenuItem
              label="图生视频"
              icon="🎬"
              onClick={() => onAction("generate-video")}
            />
          </>
        )}
        <MenuItem label="下载" icon="⬇️" onClick={() => onAction("download")} />
        <MenuItem
          label="复制路径"
          icon="📋"
          onClick={() => onAction("copy-path")}
        />
        {!isImage && (
          <MenuItem
            label="提取音频"
            icon="🎵"
            onClick={() => onAction("extract-audio")}
          />
        )}
        <div className="my-1 border-t border-gray-200 dark:border-gray-600" />
        <MenuItem
          label="删除"
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

/** 网格列表视图 */
const GridView: React.FC<{
  items: GalleryItem[];
  selectedId: string | null;
  isDark: boolean;
  onSelect: (id: string) => void;
  batchMode?: boolean;
  selectedIds?: Set<string> | null;
  favoriteIds?: Set<string> | null;
  onToggleFavorite?: (id: string) => void;
  onDragStart?: (e: React.DragEvent, item: GalleryItem) => void;
  onCompareToggle?: (id: string) => void;
}> = ({
  items,
  selectedId,
  isDark,
  onSelect,
  batchMode,
  selectedIds,
  favoriteIds,
  onToggleFavorite,
  onDragStart,
  onCompareToggle,
}) => (
  <div className="h-full overflow-y-auto p-3">
    <div className="grid grid-cols-3 gap-2">
      {items.map((item) => {
        const selected = batchMode
          ? selectedIds?.has(item.id)
          : selectedId === item.id;
        const isFav = favoriteIds?.has(item.id);
        const fileName = extractFileName(item.url);
        const fileDate = extractDate(item.url);

        return (
          <div
            key={item.id}
            onClick={() => onSelect(item.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              onSelect(item.id);
            }}
            draggable={item.type === "image"}
            onDragStart={(e) => onDragStart?.(e, item)}
            className={`relative cursor-pointer rounded-lg border-2 p-1.5 transition-all ${
              selected
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                : isDark
                  ? "border-gray-700 bg-gray-800 hover:border-gray-500"
                  : "border-gray-200 bg-white hover:border-gray-400"
            }`}
            style={{
              contentVisibility: "auto",
              containIntrinsicSize: "auto 150px",
            }}
          >
            {/* 批量选择复选框 */}
            {batchMode && (
              <div className="absolute left-1.5 top-1.5 z-10">
                <input
                  type="checkbox"
                  checked={selected || false}
                  onChange={() => onSelect(item.id)}
                  className="h-3.5 w-3.5 accent-blue-500"
                />
              </div>
            )}

            {/* 收藏星标 + 对比按钮 */}
            {!batchMode && (
              <div className="absolute right-1 top-1 z-10 flex gap-0.5">
                {onToggleFavorite && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(item.id);
                    }}
                    className={`rounded bg-black/30 p-0.5 text-[10px] transition-colors hover:bg-black/50 ${
                      isFav ? "text-yellow-400" : "text-white/60"
                    }`}
                    title={isFav ? "取消收藏" : "收藏"}
                  >
                    {isFav ? "★" : "☆"}
                  </button>
                )}
                {onCompareToggle && item.type === "image" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCompareToggle(item.id);
                    }}
                    className="rounded bg-black/30 p-0.5 text-[10px] text-white/60 transition-colors hover:bg-black/50"
                    title="加入对比"
                  >
                    ◧
                  </button>
                )}
              </div>
            )}

            {/* 缩略图 */}
            <div className="mb-1 aspect-square overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
              {item.type === "video" ? (
                <video
                  src={item.url}
                  muted
                  className="h-full w-full object-cover"
                  onMouseEnter={(e) => e.currentTarget.play()}
                  onMouseLeave={(e) => {
                    e.currentTarget.pause();
                    e.currentTarget.currentTime = 0;
                  }}
                />
              ) : (
                <img
                  src={item.thumbnailUrl || item.url}
                  alt={item.alt || ""}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              )}
            </div>

            <div className="overflow-hidden">
              <p
                className="truncate text-[10px] font-medium text-gray-700 dark:text-gray-300"
                title={fileName}
              >
                {fileName}
              </p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                {item.type === "video" ? "视频" : "图片"} · {fileDate}
              </p>
            </div>
          </div>
        );
      })}
    </div>
    {items.length === 0 && (
      <div className="flex items-center justify-center py-12 text-xs text-gray-400">
        暂无内容
      </div>
    )}
  </div>
);

export default MediaPage;

/** 对比图片面板 */
const CompareImage: React.FC<{
  item: GalleryItem | undefined;
  isDark: boolean;
}> = ({ item, isDark }) => {
  if (!item) {
    return (
      <div
        className={`flex aspect-square items-center justify-center rounded-lg border ${
          isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-gray-100"
        }`}
      >
        <span className="text-xs text-gray-400">未选择</span>
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
