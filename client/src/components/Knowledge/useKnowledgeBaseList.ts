/**
 * useKnowledgeBaseList — KnowledgeBaseList 的编排逻辑 (Phase 1 W1)
 *
 * P3-1: 状态已全部收编进 knowledgeStore（list slice + search slice），
 *       本 hook 只做：读 store 状态 + 异步编排（service 调用） + dispatchList 透传。
 *       搜索状态统一为 store.search（query/listResults/isListSearching），
 *       与 KnowledgePage 右侧面板同源，不再手动同步。
 */
import { useEffect, useCallback, useRef } from "react";
import { knowledgeService } from "../../services/knowledgeService";
import { useCompilePolling } from "./useCompilePolling";
import {
  useKnowledgeStore,
  type KnowledgeListAction,
} from "../../stores/knowledgeStore";
import { createLogger } from "@/utils/logger";
import { handleClientError } from "../../utils/handleError";
import { toastError } from "../../stores/toastStore";

const logger = createLogger("components:knowledgeBaseList");

export type { KnowledgeListAction };

export interface UseKnowledgeBaseListOpts {
  selectedBase: string | null;
  onSelectBase: (name: string | null) => void;
  onRefreshBases?: () => void;
}

export function useKnowledgeBaseList(opts: UseKnowledgeBaseListOpts) {
  const { selectedBase, onSelectBase, onRefreshBases } = opts;

  // P3-1: 单一事实来源 — 全部读 store
  const list = useKnowledgeStore((s) => s.list);
  const search = useKnowledgeStore((s) => s.search);
  const dispatchList = useKnowledgeStore((s) => s.dispatchList);

  const {
    bases,
    files,
    loading,
    showCreateModal,
    newBaseName,
    newBaseLabel,
    newBaseIcon,
    createStatus,
    editingBase,
    editLabel,
    sortBy,
    selectedCategory,
    selectedSource,
    selectedFileIds,
    showBatchTagModal,
    batchTagInput,
    batchTagStatus,
    compileStatus,
    compileProgress,
    compileMessage,
    searchTags,
    total,
    page,
    pageSize,
  } = list;

  // P3-1: 搜索三态统一为 store.search
  const searchQuery = search.query;
  const searchResults = search.listResults;
  const searching = search.isListSearching;

  // P2-8: 搜索竞态序号，只采纳最后一次请求的结果
  const searchSeqRef = useRef(0);
  // KB-C5：重命名知识库 in-flight 防重（Enter 提交后 blur 二次进入）
  const renameInFlightRef = useRef(false);

  // ── 数据加载 ──
  useEffect(() => {
    loadBases();
  }, []);
  // C5/B1：切 base 时若不在第 1 页则重置 page（由下方 [page] effect 触发加载），
  // 否则直接加载——避免第 3 页切到 1 页新库越界返回空列表
  useEffect(() => {
    if (selectedBase === undefined) return;
    if (page !== 0) {
      dispatchList({ type: "SET_PAGE", page: 0 });
    } else {
      loadFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBase]);
  // C5：分页按钮 dispatch(SET_PAGE) 后由本 effect 触发加载，消除 stale-page
  //（原实现按钮内 dispatch + loadFiles()，loadFiles 闭包捕获旧 page）
  const prevPageRef = useRef(page);
  useEffect(() => {
    if (page === prevPageRef.current) return;
    prevPageRef.current = page;
    loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  // KB-C6：排序下移服务端后，sortBy 变化需重新加载（原客户端排序即时生效）
  const prevSortByRef = useRef(sortBy);
  useEffect(() => {
    if (sortBy === prevSortByRef.current) return;
    prevSortByRef.current = sortBy;
    if (page !== 0) {
      dispatchList({ type: "SET_PAGE", page: 0 });
    } else {
      loadFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);
  // KB-前端刷新信号：编辑保存/删除/标签更新后递增 refreshTick，重载列表保证左侧名称同步
  const refreshTick = list.refreshTick;
  const refreshTickRef = useRef(refreshTick);
  useEffect(() => {
    if (refreshTick === refreshTickRef.current) return;
    refreshTickRef.current = refreshTick;
    loadFiles();
  }, [refreshTick]);

  async function loadBases() {
    dispatchList({ type: "SET_LOADING", loading: true });
    try {
      const data = await knowledgeService.listBases();
      dispatchList({ type: "SET_BASES", bases: data });
      if (data.length > 0 && !selectedBase) onSelectBase(data[0].name);
    } catch (err) {
      logger.error("加载知识库列表失败", err);
    } finally {
      dispatchList({ type: "SET_LOADING", loading: false });
    }
  }

  async function loadFiles() {
    try {
      // KB-DOC（2026-08-27）：列表不需要全文，includeContent=false 让后端裁剪
      // content（200 字符），文档打开时再由 KnowledgePage 走 getDoc 拉全文
      // KB-C6：排序下移服务端（sortBy 透传），修复原前端仅排当前页跨页错乱
      const data = await knowledgeService.listFiles(
        selectedBase || undefined,
        page * pageSize,
        pageSize,
        false,
        sortBy,
      );
      dispatchList({ type: "SET_FILES", files: data.items, total: data.total });
    } catch (err) {
      logger.error("加载知识文件失败", err);
      // F1（Liri 第四轮确认遗漏）：加载失败≠空库——明确提示，避免误判"知识库为空"
      toastError("加载知识文件失败，请检查后端连接后重试");
      dispatchList({ type: "SET_FILES", files: [], total: 0 });
    }
  }

  function handleRefresh() {
    loadBases();
    onRefreshBases?.();
  }

  // ── W3: 服务端搜索 + U1: 结果写入 store.search（P3-1 单一事实） ──
  const handleSearch = useCallback(
    async (query: string, base: string | null, searchTags?: string[]) => {
      if (!query.trim()) return;
      const seq = ++searchSeqRef.current;
      // KB-C3/KB-P2：发起搜索 → 标记已提交并清除上次错误（失败时由 catch 重新设置）
      dispatchList({ type: "SET_SEARCH_SUBMITTED", submitted: true });
      dispatchList({ type: "SET_SEARCH_ERROR", error: null });
      dispatchList({ type: "SET_SEARCHING", searching: true });
      try {
        const hits = await knowledgeService.hybridSearch(
          query.trim(),
          base || undefined,
          undefined, // domain
          searchTags,
        );
        if (seq !== searchSeqRef.current) return; // P2-8: 过期响应丢弃
        // KB-C2：保留 KnowledgeSearchHit 元数据（score/matchType/domain），供 SearchHitCard 渲染
        dispatchList({ type: "SET_SEARCH_RESULTS", results: hits });
      } catch (err) {
        if (seq !== searchSeqRef.current) return; // P2-8: 过期响应丢弃
        logger.error("搜索失败", err);
        // KB-P2：搜索失败 ≠ 真实无结果 —— 明确提示，避免右侧误显示"未找到匹配文档"
        dispatchList({
          type: "SET_SEARCH_ERROR",
          error: "搜索失败，请检查后端连接后重试",
        });
        dispatchList({ type: "SET_SEARCH_RESULTS", results: [] });
      }
    },
    // dispatchList 是 zustand 稳定 action，加入 deps 仅为满足 exhaustive-deps
    [dispatchList],
  );

  // KB-TAGSEARCH（2026-08-27）：标签点击只 setSearch({query}) 不触发真实搜索，
  // 右侧会误显示「未找到匹配文档」。监听 requestSeq 自增并复用 handleSearch 执行搜索
  const searchRequestSeq = search.requestSeq;
  const lastSearchRequestRef = useRef(searchRequestSeq);
  useEffect(() => {
    if (
      searchRequestSeq === 0 ||
      searchRequestSeq === lastSearchRequestRef.current
    )
      return;
    lastSearchRequestRef.current = searchRequestSeq;
    handleSearch(search.query, selectedBase ?? null);
    // selectedBase 变化不触发（requestSeq 未变），handleSearch 稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRequestSeq]);

  // ── 编译（Phase 0：统一 useCompilePolling，修复 C1/C2/C3 竞态/超时误报）──
  // Phase 2-13：CLEAR_COMPILE 定时器存 ref，卸载时清理
  const compileClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(() => {
    return () => {
      if (compileClearTimerRef.current) {
        clearTimeout(compileClearTimerRef.current);
      }
    };
  }, []);
  const { start: startCompile } = useCompilePolling({
    onProgress: (progress) =>
      dispatchList({ type: "SET_COMPILE_PROGRESS", progress }),
    onResult: (r) => {
      dispatchList({
        type: "SET_COMPILE_STATUS",
        status: r.hasError ? "error" : "success",
      });
      dispatchList({ type: "SET_COMPILE_MESSAGE", message: r.message });
    },
    onFinished: () => {
      loadFiles();
      // 成功/失败消息展示 5 秒后清除
      compileClearTimerRef.current = setTimeout(
        () => dispatchList({ type: "CLEAR_COMPILE" }),
        5000,
      );
    },
  });

  async function handleCompile() {
    // 防重：store 状态 + hook 模块级互斥（两处编译入口共用）
    if (useKnowledgeStore.getState().list.compileStatus === "compiling") return;
    dispatchList({ type: "SET_COMPILE_STATUS", status: "compiling" });
    dispatchList({ type: "SET_COMPILE_PROGRESS", progress: 0 });
    dispatchList({ type: "SET_COMPILE_MESSAGE", message: "" });
    const started = await startCompile();
    if (!started) {
      // 被其他入口（如抽屉"全部编译"）的互斥挡住，复位状态
      dispatchList({ type: "SET_COMPILE_STATUS", status: "idle" });
    }
  }

  // ── 创建/删除/重命名知识库 ──
  async function handleCreateBase() {
    const name = newBaseName.trim();
    const label = newBaseLabel.trim() || name;
    if (!name) return;
    dispatchList({ type: "SET_CREATE_STATUS", status: "creating" });
    try {
      await knowledgeService.createBase(
        name,
        label,
        newBaseIcon.trim() || undefined,
      );
      dispatchList({ type: "CLOSE_CREATE_MODAL" });
      dispatchList({ type: "SET_CREATE_STATUS", status: "idle" });
      await loadBases();
    } catch (e) {
      handleClientError(e, {
        module: "components:knowledge:KnowledgeBaseList",
        action: "handleCreateBase",
      });
      dispatchList({ type: "SET_CREATE_STATUS", status: "error" });
    }
  }

  async function handleDeleteBase(name: string) {
    if (
      !confirm(
        `确定要删除知识库 "${name}" 吗？相关文件不会被删除，但知识库将不再显示。`,
      )
    )
      return;
    try {
      await knowledgeService.deleteBase(name);
      if (selectedBase === name) onSelectBase(null);
      await loadBases();
    } catch (err) {
      logger.error("删除知识库失败", err);
    }
  }

  async function handleCloneBase(name: string) {
    const newName = prompt(
      "请输入新知识库名称（克隆含文档和索引）:",
      `${name}-clone`,
    );
    if (!newName?.trim()) return;
    try {
      await knowledgeService.cloneBase(name, newName.trim());
      await loadBases();
    } catch (err) {
      logger.error("克隆知识库失败", err);
      toastError(
        new Error(
          `克隆失败: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  async function handleDuplicateBase(name: string) {
    const newName = prompt(
      "请输入新知识库名称（仅复制配置，不含文档）:",
      `${name}-copy`,
    );
    if (!newName?.trim()) return;
    try {
      await knowledgeService.duplicateBase(name, newName.trim());
      await loadBases();
    } catch (err) {
      logger.error("复制知识库配置失败", err);
      toastError(
        new Error(
          `复制失败: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  async function handleRenameBase(name: string) {
    // KB-C5：Enter 提交后 input 卸载触发 blur 会二次进入，防重避免重复提交
    if (renameInFlightRef.current) return;
    const label = editLabel.trim();
    if (!label || label === bases.find((b) => b.name === name)?.label) {
      dispatchList({ type: "CANCEL_EDIT_BASE" });
      return;
    }
    renameInFlightRef.current = true;
    try {
      await knowledgeService.updateBase(name, { label });
      dispatchList({ type: "CANCEL_EDIT_BASE" });
      await loadBases();
    } catch (err) {
      logger.error("重命名知识库失败", err);
    } finally {
      renameInFlightRef.current = false;
    }
  }

  // ── 批量标签 ──
  async function handleBatchTag() {
    if (selectedFileIds.size === 0) return;
    const tags = batchTagInput
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) return;
    dispatchList({ type: "SET_BATCH_TAG_STATUS", status: "saving" });
    try {
      await knowledgeService.batchTag([...selectedFileIds], tags);
      dispatchList({ type: "CLOSE_BATCH_TAG_MODAL" });
      dispatchList({ type: "SET_BATCH_TAG_STATUS", status: "idle" });
      dispatchList({ type: "CLEAR_SELECTION" });
      loadFiles();
    } catch (err) {
      logger.error("批量加标签失败", err);
      dispatchList({ type: "SET_BATCH_TAG_STATUS", status: "error" });
    }
  }

  return {
    // state（来自 store.list + store.search）
    bases,
    files,
    loading,
    searching,
    searchQuery,
    searchResults,
    showCreateModal,
    newBaseName,
    newBaseLabel,
    newBaseIcon,
    createStatus,
    editingBase,
    editLabel,
    sortBy,
    selectedCategory,
    selectedSource,
    selectedFileIds,
    showBatchTagModal,
    batchTagInput,
    batchTagStatus,
    compileStatus,
    compileProgress,
    compileMessage,
    searchTags,
    total,
    page,
    pageSize,
    // dispatch（P3-1: 透传 store.dispatchList）
    dispatch: dispatchList,
    // handlers
    loadFiles,
    handleRefresh,
    handleSearch,
    handleCompile,
    handleCreateBase,
    handleDeleteBase,
    handleCloneBase,
    handleDuplicateBase,
    handleRenameBase,
    handleBatchTag,
  };
}
