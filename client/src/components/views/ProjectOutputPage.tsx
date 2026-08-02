/**
 * ProjectOutputPage — 项目输出子页（/projects/:projectId/output/:outputType）
 *
 * 通用组件，通过 URL 参数 :outputType 区分 5 种输出类型：
 *   summary     → 摘要
 *   podcast     → 播客
 *   study-guide → 学习指南
 *   quiz        → 测验
 *   flashcards  → 闪卡
 *
 * 布局（沿用 Copilot Projects 页面功能结构，但使用 Liri 样式）：
 *   ┌────────────────────────────────────────────┐
 *   │ 顶部：返回 ← + 输出类型图标与标题 + 操作按钮  │
 *   ├────────────────────────────────────────────┤
 *   │ 左侧：历史生成列表（暂空占位）               │
 *   │ 右侧：生成表单 / 生成结果展示区              │
 *   └────────────────────────────────────────────┘
 */
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRootStore } from "@/stores/root-store";
import {
  DashboardIcon,
  ZapIcon,
  KnowledgeIcon,
  FileIcon,
  ModelIcon,
  UsersIcon,
} from "@/assets/icons";
import { getCreationItem } from "./ProjectsPage";

/* ---------- 类型 ---------- */

/** 历史生成记录（未来可落地到 DB，当前为空数组占位） */
interface OutputHistoryItem {
  id: string;
  title: string;
  createdAt: string;
}

/* ---------- 图标映射（独立副本，避免 import 循环依赖） ---------- */

const OUTPUT_ICON_MAP: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  summary: ZapIcon,
  podcast: UsersIcon,
  "study-guide": KnowledgeIcon,
  quiz: ModelIcon,
  flashcards: FileIcon,
};

/* ---------- 组件 ---------- */

export default function ProjectOutputPage() {
  const navigate = useNavigate();
  const { projectId, outputType } = useParams<{
    projectId: string;
    outputType: string;
  }>();

  const worktrees = useRootStore((s) => s.worktrees);
  const project = projectId ? worktrees[projectId] : undefined;
  const creation = outputType ? getCreationItem(outputType) : undefined;

  // 占位：未来接入真实历史，当前留空
  const [history] = useState<OutputHistoryItem[]>([]);
  const [generating, setGenerating] = useState(false);

  const Icon = useMemo(() => {
    if (!outputType) return DashboardIcon;
    return OUTPUT_ICON_MAP[outputType] ?? DashboardIcon;
  }, [outputType]);

  /* ---- 无效参数处理 ---- */
  if (!projectId || !outputType) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
        参数缺失
      </div>
    );
  }

  if (!project) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
        <DashboardIcon
          size={40}
          className="mb-3 text-gray-300 dark:text-gray-700"
        />
        <p className="font-medium mb-1 text-gray-700 dark:text-gray-300">
          项目不存在
        </p>
        <button
          onClick={() => navigate("/projects")}
          className="mt-3 text-sm text-blue-600 dark:text-blue-500 hover:underline"
        >
          返回到项目列表
        </button>
      </div>
    );
  }

  if (!creation) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
        <ModelIcon
          size={40}
          className="mb-3 text-gray-300 dark:text-gray-700"
        />
        <p className="font-medium mb-1 text-gray-700 dark:text-gray-300">
          不支持的输出类型：{outputType}
        </p>
        <button
          onClick={() => navigate(`/projects/${projectId}`)}
          className="mt-3 text-sm text-blue-600 dark:text-blue-500 hover:underline"
        >
          返回项目
        </button>
      </div>
    );
  }

  /* ---- 占位生成动作：点击后显示 loading，3s 后给出空结果（Phase 2 接入真实后端） ---- */
  const handleGenerate = () => {
    setGenerating(true);
    // TODO: CS05-ROOTFIX — 接入统一的 Workflow / ModelRouter，按 outputType 构造 prompt 并持久化。
    //   Phase 2: POST /v1/projects/{projectId}/outputs { type: summary }
    setTimeout(() => setGenerating(false), 1800);
  };

  return (
    <div className="flex flex-1 h-full bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* ======================================== */}
      {/*  左栏：项目列表（保持与 ProjectsPage 一致） */}
      {/* ======================================== */}
      <aside className="w-56 border-r border-gray-200 dark:border-gray-700 flex flex-col flex-shrink-0 bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between px-3 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
            <DashboardIcon
              size={16}
              className="text-gray-500 dark:text-gray-400"
            />
            项目
          </h2>
        </div>
        <div className="px-3 py-4 text-center">
          <button
            onClick={() => navigate(`/projects/${projectId}`)}
            className="w-full text-left px-3 py-2 rounded-md border-2 border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-gray-800 dark:text-gray-100 text-sm font-medium"
          >
            ← 返回「{project.name}」
          </button>
        </div>
      </aside>

      {/* ======================================== */}
      {/*  中栏：输出主区域                          */}
      {/* ======================================== */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* 顶部栏 */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-1.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-base font-medium text-gray-800 dark:text-gray-100 truncate">
                {creation.label}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {project.name}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors font-medium flex items-center gap-2"
            >
              {generating ? (
                <svg
                  className="w-4 h-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="opacity-25"
                  />
                  <path
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
                    className="opacity-75"
                  />
                </svg>
              ) : null}
              {generating ? "生成中..." : `生成${creation.label}`}
            </button>
          </div>
        </header>

        {/* 内容：左历史列表 + 右生成区 */}
        <div className="flex flex-1 min-h-0">
          {/* 历史生成侧边列表（当前占位） */}
          <aside className="w-56 border-r border-gray-200 dark:border-gray-700 flex-shrink-0 bg-white dark:bg-gray-900/50 flex flex-col">
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700">
              历史生成
            </div>
            <div className="flex-1 overflow-y-auto">
              {history.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-gray-400 dark:text-gray-500">
                  暂无记录
                  <br />
                  点击「生成{creation.label}」开始
                </div>
              ) : (
                history.map((h) => (
                  <button
                    key={h.id}
                    className="w-full text-left px-3 py-2 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                  >
                    <div className="text-sm text-gray-800 dark:text-gray-200 truncate">
                      {h.title}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {h.createdAt}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* 主生成区 / 结果展示区 */}
          <section className="flex-1 flex flex-col min-w-0 bg-white dark:bg-gray-900">
            <div className="px-8 py-10 flex-1 overflow-y-auto">
              <div className="max-w-2xl mx-auto">
                {/* 顶部说明卡片 */}
                <div className="p-5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 mb-6">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-md bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-500 shadow-sm">
                      <Icon size={20} />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">
                        {creation.label}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                        {creation.description}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 生成配置表单（Phase 2 再细化字段，当前仅占位入口） */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      生成范围
                    </label>
                    <select
                      disabled={generating}
                      className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">全部项目输入（推荐）</option>
                      <option value="selected">仅选择的输入项</option>
                      <option value="current">当前会话上下文</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      语言
                    </label>
                    <select
                      disabled={generating}
                      className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="zh">中文</option>
                      <option value="en">English</option>
                      <option value="bilingual">中英双语</option>
                    </select>
                  </div>
                  <div className="pt-2">
                    <button
                      onClick={handleGenerate}
                      disabled={generating}
                      className="w-full px-4 py-2.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors font-medium"
                    >
                      {generating
                        ? "正在生成，请稍候..."
                        : `开始生成 ${creation.label}`}
                    </button>
                    <p className="mt-2 text-xs text-gray-400 dark:text-gray-500 text-center">
                      Phase 2 接入后端 Workflow，当前为前端占位流程
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
