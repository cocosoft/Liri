import { useState, useCallback, useRef } from "react";
import { useProjectStore } from "../../stores/projectStore";
import type {
  ProjectNode,
  ProjectViewMode,
  ProjectPriority,
  ProjectStatus,
} from "../../types/work";

/** 优先级颜色映射 */
const PRIORITY_COLORS: Record<ProjectPriority, string> = {
  P0: "text-red-500 bg-red-50 dark:bg-red-900/20",
  P1: "text-orange-500 bg-orange-50 dark:bg-orange-900/20",
  P2: "text-blue-500 bg-blue-50 dark:bg-blue-900/20",
  P3: "text-gray-400 bg-gray-50 dark:bg-gray-800",
};

/** 状态图标 */
const STATUS_ICONS: Record<string, string> = {
  planning: "\u{1F4CB}",
  active: "\u{1F504}",
  paused: "\u23F8\uFE0F",
  completed: "\u2705",
  archived: "\u{1F4E6}",
};

/** 状态中文名 */
const STATUS_LABELS: Record<string, string> = {
  planning: "规划中",
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  archived: "已归档",
};

/** 节点类型图标 */
const TYPE_ICONS: Record<string, string> = {
  project: "\u{1F4CA}",
  phase: "\u{1F4CC}",
  story: "\u{1F3AF}",
  task: "\u2705",
};

/** 看板列配置：按状态分组，显示所有有节点的状态列 */
const BOARD_COLUMNS: ProjectStatus[] = [
  "planning",
  "active",
  "paused",
  "completed",
  "archived",
];

/** 看板列背景色 */
const COLUMN_BG: Record<string, string> = {
  planning: "bg-gray-50 dark:bg-gray-800/50",
  active: "bg-blue-50 dark:bg-blue-900/10",
  paused: "bg-yellow-50 dark:bg-yellow-900/10",
  completed: "bg-green-50 dark:bg-green-900/10",
  archived: "bg-gray-100 dark:bg-gray-800",
};

/** 列头颜色 */
const COLUMN_HEADER_BG: Record<string, string> = {
  planning: "bg-gray-200 dark:bg-gray-700",
  active: "bg-blue-200 dark:bg-blue-800",
  paused: "bg-yellow-200 dark:bg-yellow-800",
  completed: "bg-green-200 dark:bg-green-800",
  archived: "bg-gray-300 dark:bg-gray-600",
};

/**
 * 单个节点卡片（看板模式 + 拖拽）
 */
function DraggableCard({
  node,
  onClick,
}: {
  node: ProjectNode;
  onClick: (node: ProjectNode) => void;
}) {
  /**
   * 拖拽开始：将被拖节点 ID 存入 dataTransfer
   */
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.dataTransfer.setData("text/plain", node.id);
      e.dataTransfer.effectAllowed = "move";
      // 设置拖拽中半透明效果
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.style.opacity = "0.5";
      }
    },
    [node.id],
  );

  /**
   * 拖拽结束：恢复透明度
   */
  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
  }, []);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className="group cursor-grab active:cursor-grabbing rounded-lg border border-gray-200
                 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600
                 transition-all bg-white dark:bg-gray-850 shadow-sm hover:shadow-md"
      onClick={() => onClick(node)}
    >
      <div className="px-3 py-2.5">
        {/* 顶部:类型图标 + 标题 + 优先级 */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base flex-shrink-0">
            {TYPE_ICONS[node.type]}
          </span>
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
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">
            {node.description}
          </p>
        )}

        {/* 底部:进度 + 标签 */}
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <div className="flex items-center gap-1.5 flex-1">
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
          {/* 依赖数 */}
          {node.dependsOn.length > 0 && (
            <span
              className="text-gray-400"
              title={`依赖 ${node.dependsOn.length} 个前置节点`}
            >
              {"\u{1F517}"}
              {node.dependsOn.length}
            </span>
          )}
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
 * 看板列：按状态分组的卡片列表，支持拖拽放置
 */
function KanbanColumn({
  status,
  nodes,
  onNodeClick,
  onDropNode,
}: {
  status: ProjectStatus;
  nodes: ProjectNode[];
  onNodeClick: (node: ProjectNode) => void;
  onDropNode: (nodeId: string, newStatus: ProjectStatus) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  /**
   * 拖拽悬浮：阻止默认行为以允许放置
   */
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }, []);

  /**
   * 拖拽离开：取消高亮
   */
  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  /**
   * 放置：读取被拖节点 ID，调用更新状态
   */
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const nodeId = e.dataTransfer.getData("text/plain");
      if (nodeId) {
        onDropNode(nodeId, status);
      }
    },
    [status, onDropNode],
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col rounded-lg min-w-[220px] max-w-[260px] flex-shrink-0
                  ${COLUMN_BG[status]}
                  ${dragOver ? "ring-2 ring-blue-400 dark:ring-blue-500" : ""}
                  transition-all duration-150`}
    >
      {/* 列头 */}
      <div className={`px-3 py-2 rounded-t-lg ${COLUMN_HEADER_BG[status]}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{STATUS_ICONS[status]}</span>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              {STATUS_LABELS[status]}
            </span>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-gray-800/50 px-1.5 py-0.5 rounded-full">
            {nodes.length}
          </span>
        </div>
      </div>

      {/* 卡片列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[60px]">
        {nodes.length === 0 ? (
          <div className="flex items-center justify-center h-12 text-xs text-gray-400 dark:text-gray-500 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
            拖拽至此
          </div>
        ) : (
          nodes.map((node) => (
            <DraggableCard key={node.id} node={node} onClick={onNodeClick} />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * 看板模式主组件
 */
function KanbanBoard({
  nodesList,
  onNodeClick,
  onDropNode,
}: {
  nodesList: ProjectNode[];
  onNodeClick: (node: ProjectNode) => void;
  onDropNode: (nodeId: string, newStatus: ProjectStatus) => void;
}) {
  /** 按状态分组 */
  const grouped = BOARD_COLUMNS.reduce(
    (acc, status) => {
      acc[status] = nodesList.filter((n) => n.status === status);
      return acc;
    },
    {} as Record<string, ProjectNode[]>,
  );

  return (
    <div className="flex gap-3 h-full overflow-x-auto pb-2">
      {BOARD_COLUMNS.map((status) => (
        <KanbanColumn
          key={status}
          status={status}
          nodes={grouped[status]}
          onNodeClick={onNodeClick}
          onDropNode={onDropNode}
        />
      ))}
    </div>
  );
}

/**
 * 列表模式：递归树形展示
 */
function ListView({
  rootNodes,
  nodesMap,
  onNodeClick,
}: {
  rootNodes: ProjectNode[];
  nodesMap: Record<string, ProjectNode>;
  onNodeClick: (node: ProjectNode) => void;
}) {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {rootNodes.map((node) => (
        <NodeTree
          key={node.id}
          node={node}
          nodesMap={nodesMap}
          onClick={onNodeClick}
        />
      ))}
    </div>
  );
}

/**
 * 单个节点卡片（列表模式，无拖拽）
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
          <span className="text-base flex-shrink-0">
            {TYPE_ICONS[node.type]}
          </span>
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
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">
            {node.description}
          </p>
        )}

        {/* 底部:状态 + 进度 + 标签 */}
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <span>
            {STATUS_ICONS[node.status]}{" "}
            {STATUS_LABELS[node.status] || node.status}
          </span>
          <span className="flex-1" />
          <div className="flex items-center gap-1.5">
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
 * 递归渲染节点树（列表模式）
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
 * DAG 依赖图模式
 * 使用简单网格布局展示节点及其依赖关系
 */
function DagView({
  nodesList,
  nodesMap,
  onNodeClick,
}: {
  nodesList: ProjectNode[];
  nodesMap: Record<string, ProjectNode>;
  onNodeClick: (node: ProjectNode) => void;
}) {
  /**
   * 按拓扑层分组
   */
  const layers = buildLayers(nodesList, nodesMap);

  return (
    <div className="overflow-auto px-4 py-6">
      {layers.length === 0 ? (
        <div className="text-center text-gray-400 mt-12">暂无工作项</div>
      ) : (
        <div className="flex flex-col items-center gap-6 min-w-[600px]">
          {layers.map((layer, layerIdx) => (
            <div key={layerIdx} className="flex flex-col items-center w-full">
              {/* 层标签 */}
              <span className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                层级 {layerIdx + 1}
              </span>

              {/* 层内节点 */}
              <div className="flex justify-center gap-4 flex-wrap">
                {layer.map((node) => {
                  /** 计算依赖在左侧的起始位置，用于画连接线 */
                  const hasDeps = node.dependsOn.length > 0;
                  return (
                    <div
                      key={node.id}
                      className="flex flex-col items-center relative"
                    >
                      {/* 如果有依赖，从上方连线 */}
                      {hasDeps && layerIdx > 0 && (
                        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600" />
                      )}
                      <div
                        onClick={() => onNodeClick(node)}
                        className={`cursor-pointer rounded-lg border-2 transition-all w-48
                                    ${getStatusBorder(node.status)}
                                    bg-white dark:bg-gray-850 shadow-sm hover:shadow-md`}
                      >
                        <div className="px-3 py-2">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span>{TYPE_ICONS[node.type]}</span>
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1">
                              {node.title}
                            </span>
                            <span
                              className={`text-xs px-1 rounded font-medium ${PRIORITY_COLORS[node.priority]}`}
                            >
                              {node.priority}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-400">
                            <span>{STATUS_ICONS[node.status]}</span>
                            <span>{node.progress}%</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 层间连接线 */}
              {layerIdx < layers.length - 1 && (
                <div className="flex justify-center mt-2">
                  <svg
                    width="20"
                    height="20"
                    className="text-gray-300 dark:text-gray-600"
                  >
                    <line
                      x1="10"
                      y1="0"
                      x2="10"
                      y2="20"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <polygon points="6,16 10,20 14,16" fill="currentColor" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 按拓扑顺序分层
 */
function buildLayers(
  nodesList: ProjectNode[],
  nodesMap: Record<string, ProjectNode>,
): ProjectNode[][] {
  if (nodesList.length === 0) return [];

  const visited = new Set<string>();
  const layers: ProjectNode[][] = [];
  let currentLayer = nodesList.filter((n) => n.dependsOn.length === 0);

  while (currentLayer.length > 0) {
    for (const n of currentLayer) {
      visited.add(n.id);
    }
    layers.push(currentLayer);

    const nextIds = new Set<string>();
    for (const n of currentLayer) {
      for (const childId of n.children) {
        if (!visited.has(childId) && nodesMap[childId]) {
          // 检查子节点的所有依赖是否都已访问
          const child = nodesMap[childId];
          const allDepsVisited = child.dependsOn.every((d) => visited.has(d));
          if (allDepsVisited) {
            nextIds.add(childId);
          }
        }
      }
    }
    currentLayer = Array.from(nextIds)
      .map((id) => nodesMap[id])
      .filter(Boolean) as ProjectNode[];
  }

  return layers;
}

/**
 * 根据状态返回 DAG 节点的边框颜色
 */
function getStatusBorder(status: ProjectStatus): string {
  switch (status) {
    case "planning":
      return "border-gray-300 dark:border-gray-600";
    case "active":
      return "border-blue-400 dark:border-blue-500";
    case "paused":
      return "border-yellow-400 dark:border-yellow-500";
    case "completed":
      return "border-green-400 dark:border-green-500";
    case "archived":
      return "border-gray-400 dark:border-gray-500";
    default:
      return "border-gray-300 dark:border-gray-600";
  }
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
        <div className="text-4xl text-center mb-4">{"\u{1F4CB}"}</div>
        <h2 className="text-lg font-semibold text-center text-gray-700 dark:text-gray-300 mb-2">
          导入项目需求
        </h2>
        <p className="text-sm text-gray-400 text-center mb-6">
          粘贴需求文档内容，AI 将自动分解为工作项网络
        </p>

        <textarea
          className="w-full h-40 p-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg
                     bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100
                     focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
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
          {isDecomposing ? "AI 正在分解..." : "开始分解"}
        </button>
      </div>
    </div>
  );
}

/**
 * 项目看板主视图
 * 支持三种视图模式：看板/列表/依赖图
 */
interface WorkBoardViewProps {
  className?: string;
  onNodeClick?: (node: ProjectNode) => void;
  projectId: string;
}

/**
 * 进度总览条
 * 显示各状态节点的分布情况和整体完成度
 */
function ProgressBar({ nodes }: { nodes: ProjectNode[] }) {
  const total = nodes.length;
  if (total === 0) return null;

  const completedCount = nodes.filter((n) => n.status === "completed").length;
  const activeCount = nodes.filter((n) => n.status === "active").length;
  const pausedCount = nodes.filter((n) => n.status === "paused").length;
  const planningCount = nodes.filter((n) => n.status === "planning").length;
  const archivedCount = nodes.filter((n) => n.status === "archived").length;
  const completionRate =
    total > 0 ? Math.round((completedCount / total) * 100) : 0;

  /** 计算各状态占比（最小保留 1% 显示） */
  const barParts = [
    {
      count: planningCount,
      color: "bg-gray-300 dark:bg-gray-600",
      label: "待办",
    },
    { count: activeCount, color: "bg-blue-500", label: "进行中" },
    { count: pausedCount, color: "bg-amber-400", label: "暂停" },
    { count: completedCount, color: "bg-green-500", label: "已完成" },
    {
      count: archivedCount,
      color: "bg-gray-400 dark:bg-gray-500",
      label: "已归档",
    },
  ].filter((p) => p.count > 0);

  return (
    <div className="mt-3 mb-1">
      {/* 进度条 */}
      <div className="flex h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        {barParts.map((part) => {
          const pct = Math.max(1, Math.round((part.count / total) * 100));
          return (
            <div
              key={part.label}
              className={part.color}
              style={{ width: `${pct}%` }}
              title={`${part.label}: ${part.count}`}
            />
          );
        })}
      </div>

      {/* 进度说明 */}
      <div className="flex items-center justify-between mt-1.5">
        <div className="flex gap-3 text-xs text-gray-500">
          {barParts.map((part) => (
            <span key={part.label} className="flex items-center gap-1">
              <span
                className={`inline-block w-2 h-2 rounded-full ${part.color}`}
              />
              {part.label} {part.count}
            </span>
          ))}
        </div>
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
          完成 {completionRate}%
        </span>
      </div>
    </div>
  );
}

export function WorkBoardView({
  className,
  onNodeClick,
  projectId,
}: WorkBoardViewProps) {
  const project = useProjectStore((s) => s.projects[projectId]);
  const getRootNodes = useProjectStore((s) => s.getRootNodes);
  const importNodesDirect = useProjectStore((s) => s.importNodesDirect);
  const updateNodeStatus = useProjectStore((s) => s.updateNodeStatus);
  const [viewMode, setViewMode] = useState<ProjectViewMode>("board");
  const [showImport, setShowImport] = useState(!project);
  /** 拖拽操作计数器，用于强制刷新 */
  const [, setDragVersion] = useState(0);
  const dragVersionRef = useRef(0);

  const rootNodes = project ? getRootNodes(projectId) : [];
  const allNodes = project ? Object.values(project.nodes) : [];

  const handleImport = async (text: string) => {
    const { projectDecomposer } =
      await import("../../services/projectDecomposer");
    const nodes = await projectDecomposer.decompose(text, { projectId });
    importNodesDirect(
      "default",
      projectId === "default" ? "项目" : projectId,
      text,
      nodes,
    );
    setShowImport(false);
  };

  const handleNodeClick = (node: ProjectNode) => {
    onNodeClick?.(node);
  };

  /**
   * 拖拽放置：更新节点状态
   */
  const handleDropNode = useCallback(
    (nodeId: string, newStatus: ProjectStatus) => {
      const current = project?.nodes[nodeId];
      // 状态未变则跳过
      if (!current || current.status === newStatus) return;
      updateNodeStatus(projectId, nodeId, newStatus);
      // 用 ref 避免 stale closure，用 state 触发重渲染
      dragVersionRef.current += 1;
      setDragVersion(dragVersionRef.current);
    },
    [project?.nodes, projectId, updateNodeStatus],
  );

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
              {allNodes.length} 个工作项 · 进度 {project?.progress}%
            </p>
          </div>
          <div className="flex gap-1">
            {(["board", "list", "dag"] as ProjectViewMode[]).map((mode) => (
              <button
                key={mode}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  viewMode === mode
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-medium"
                    : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                onClick={() => setViewMode(mode)}
              >
                {mode === "board"
                  ? "\u{1F4CB} 看板"
                  : mode === "list"
                    ? "\u{1F4C4} 列表"
                    : "\u{1F517} 依赖图"}
              </button>
            ))}
          </div>
        </div>

        {/* 统计条 */}
        <div className="flex gap-4 text-xs text-gray-500">
          <span>阶段 {rootNodes.length}</span>
          <span>场景 {allNodes.filter((n) => n.type === "story").length}</span>
          <span>任务 {allNodes.filter((n) => n.type === "task").length}</span>
          {/* 各状态统计 */}
          {(["active", "paused", "completed"] as ProjectStatus[]).map((s) => {
            const count = allNodes.filter((n) => n.status === s).length;
            if (count === 0) return null;
            return (
              <span key={s} className="text-gray-400">
                {STATUS_LABELS[s]} {count}
              </span>
            );
          })}
        </div>

        {/* 进度总览条 */}
        <ProgressBar nodes={allNodes} />
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {allNodes.length === 0 ? (
          <div className="text-center text-gray-400 mt-12">
            <p>暂无工作项</p>
          </div>
        ) : viewMode === "board" ? (
          <KanbanBoard
            nodesList={allNodes}
            onNodeClick={handleNodeClick}
            onDropNode={handleDropNode}
          />
        ) : viewMode === "list" ? (
          <ListView
            rootNodes={rootNodes}
            nodesMap={project?.nodes || {}}
            onNodeClick={handleNodeClick}
          />
        ) : (
          <DagView
            nodesList={allNodes}
            nodesMap={project?.nodes || {}}
            onNodeClick={handleNodeClick}
          />
        )}
      </div>
    </div>
  );
}
