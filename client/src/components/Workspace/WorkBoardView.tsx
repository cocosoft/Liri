import { useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import type { ProjectNode, ProjectViewMode, ProjectPriority } from "../../types/work";

/** 优先级颜色映射 */
const PRIORITY_COLORS: Record<ProjectPriority, string> = {
  P0: "text-red-500 bg-red-50 dark:bg-red-900/20",
  P1: "text-orange-500 bg-orange-50 dark:bg-orange-900/20",
  P2: "text-blue-500 bg-blue-50 dark:bg-blue-900/20",
  P3: "text-gray-400 bg-gray-50 dark:bg-gray-800",
};

/** 状态图标 */
const STATUS_ICONS: Record<string, string> = {
  planning: "📋",
  active: "🔄",
  paused: "⏸️",
  completed: "✅",
  archived: "📦",
};

/** 节点类型图标 */
const TYPE_ICONS: Record<string, string> = {
  project: "📊",
  phase: "📌",
  story: "🎯",
  task: "✅",
};

/**
 * 单个节点卡片
 */
function NodeCard({
 node,
  onClick,
}: {
  node: ProjectNode;
  onClick: (node: ProjectNode) => void;
}) {
  return (
    <div
      className="group cursor-pointer rounded-lg border border-gray-200 dark:border-gray-700 
                  hover:border-blue-300 dark:hover:border-blue-600 transition-all
                  bg-white dark:bg-gray-850 shadow-sm"
      onClick={() => onClick(node)}
    >
      <div className="px-3 py-2.5">
        {/* 顶部:类型图标 + 标题 + 优先级 */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base flex-shrink-0">{TYPE_ICONS[node.type]}</span>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1">
            {node.title}
          </span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[node.priority]}`}
          >
            {node.priority}
          </span>
        </div>

        {/* 描述 */}
        {node.description && (
          <p className="text-xs text-gray500 dark:text-gray-400 line-clamp-2 mb-2">
            {node.description}
          </p>
        )}

        {/* 底部:状态 + 进度 + 标签 */}
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <span>{STATUS_ICONS[node.status]} {node.status}</span>
          <span className="flex-1" />
          <div className="flex items-center gap-1.">
            <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  node.progress === 100
                    ? "bg-green-500"
                    : node.progress > 0
                    ? "bg-blue-500"
                    : "bg-gray-300 dark:bg-gray-600"
                }`}
                style={{ width: `${node.progress}%` }}
              />
            </div>
            <span className="text-gray-400">{node.progress}%</span>
          </div>
        </div>

        {/* 标签 */}
        {node.tags.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {node.tags.map((tag) => (
              <span
 key={tag}
                className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


/**
 * 递归渲染节点树
 */
function NodeTree({
  node,
  nodesMap,
  onClick,
  depth = 0,
}: {
  node: ProjectNode;
  nodesMap: Record<string, ProjectNode>;
  onClick: (node: ProjectNode) => void;
  depth?: number;
}) {
  const children = node.children
    .map((id) => nodesMap[id])
    .filter(Boolean) as ProjectNode[];

  return (
    <div className="space-y-2">
      <NodeCard node={node} onClick={onClick} />
      {children.length > 0 && (
        <div className="ml-6 pl-3 border-l-2 border-gray-100 dark:border-gray-700 space-y-2">
          {children.map((child) => (
            <NodeTree
              key={child.id}
              node={child}
              nodesMap={nodesMap}
              onClick={onClick}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 项目需求导入面板
 */
function ImportPanel({ onImport }: { onImport: (text: string) => void }) {
  const [text, setText] = useState("");
  const isDecomposing = useProjectStore((s) => s.isDecomposing);

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="max-w-lg w-full">
        <div className="text-4xl text-center mb-4">📋</div>
        <h2 className="text-lg font-semibold text-center text-gray-700 dark:text-gray-300 mb-2">
          导入项目需求
        </h2>
        <p className="text-sm text-gray-400 text-center mb-6">
          粘贴需求文档内容,AI 将自动分解为工作项网络
        </p>

        <textarea
          className="w-full h-40 p-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg
                     bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100
                     focus:outline-none focus:ring2 focus:ring-blue-400 resize-none"
          placeholder="输入项目需求描述..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <button
          className={`mt-4 w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
            isDecomposing
              ? "bg-blue-100 text-blue-400 cursor-wait"
              : "bg-blue-500 text-white hover:bg-blue-600"
          }`}
          onClick={() => onImport(text)}
          disabled={isDecomposing || !text.trim()}
        >
          {isDecomposing ? "🤔 AI 正在分解..." : "🚀 开始分解"}
        </button>
      </div>
    </div>
  );
}

/**
 * 项目看板主视图
 */
interface WorkBoardViewProps {
  className?: string;
  onNodeClick?: (node: ProjectNode) => void;
  projectId: string;
}

export function WorkBoardView({
  className,
  onNodeClick,
  projectId,
}: WorkBoardViewProps) {
  const project = useProjectStore((s) => s.projects[projectId]);
  const getRootNodes = useProjectStore((s) => s.getRootNodes);
  const importNodesDirect = useProjectStore((s) => s.importNodesDirect);
  const [viewMode, setViewMode] = useState<ProjectViewMode>("board");
  const [showImport, setShowImport] = useState(!project);

  const rootNodes = project ? getRootNodes(projectId) : [];

  const handleImport = async (text: string) => {
    const { projectDecomposer } = await import("../../services/projectDecomposer");
    const nodes = await projectDecomposer.decompose(text, { projectId: projectId });
    importNodesDirect("default", "流程穿透式诊断平台", text, nodes);
    setShowImport(false);
  };

  const handleNodeClick = (node: ProjectNode) => {
    onNodeClick?.(node);
  };

  if (showImport) {
    return (
      <div className={`${className || ""} flex flex-col h-full`}>
        <ImportPanel onImport={handleImport} />
      </div>
    );
  }

  return (
    <div className={`${className || ""} flex flex-col h-full`}>
      {/* 顶部:项目标题 + 统计 + 视图切换 */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {project?.name}
            </h2>
            <p className="text-xs text-gray-400">
              {Object.keys(project?.nodes || {}).length} 个工作项 · 进度 {project?.progress}%
            </p>
          </div>
          <div className="flex gap-1">
            {(["board", "list", "dag"] as ProjectViewMode[]).map((mode) => (
              <button
                key={mode}
                className={`px-2 py-1 text-xs rounded ${
                  viewMode === mode
                    ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300"
                    : "text-gray-400 hover:text-gray-600"
                }`}
                onClick={() => setViewMode(mode)}
              >
                {mode === "board" ? "📋 看板" : mode === "list" ? "📄 列表" : "🔗 依赖图"}
              </button>
            ))}
          </div>
        </div>

        {/* 统计条 */}
        <div className="flex gap-4 text-xs text-gray-500">
          <span>{rootNodes.length} 个阶段</span>
          <span>{Object.values(project?.nodes || {}).filter(n => n.type === "story").length} 个场景</span>
          <span>{Object.values(project?.nodes || {}).filter(n => n.type === "task").length} 个任务</span>
        </div>
      </div>

      {/* 内容区:树形展示 */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {rootNodes.length === 0 ? (
          <div className="text-center text-gray-400 mt-12">
            <p>暂无工作项</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {rootNodes.map((node) => (
              <NodeTree
                key={node.id}
                node={node}
                nodesMap={project?.nodes || {}}
                onClick={handleNodeClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
