import { useState, useEffect, useCallback } from "react";
import { fileService } from "../../services/fileService";

/**
 * 目录树节点
 */
interface TreeNode {
  name: string;
  path: string;
  type: "directory" | "file";
  children: TreeNode[];
  expanded: boolean;
  loading: boolean;
}

/**
 * 目录树组件属性
 */
interface TreeRoot {
  key: string;
  label: string;
  path: string;
  icon: string;
}

interface DirectoryTreeProps {
  /** 当前选中的路径 */
  currentPath: string;
  /** 路径点击回调 */
  onNavigate: (path: string) => void;
  /** 根目录列表 */
  roots: TreeRoot[];
  /** 当前选中的根目录 key */
  currentRoot: string;
  /** 根目录切换回调 */
  onRootChange: (key: string) => void;
}

/**
 * 目录树组件
 * 展示文件系统的树形结构，支持展开/折叠
 */
function DirectoryTree({
  currentPath,
  onNavigate,
  roots,
  currentRoot,
  onRootChange,
}: DirectoryTreeProps) {
  const [treeData, setTreeData] = useState<Record<string, TreeNode[]>>({});

  /** 加载指定目录的子节点 */
  const loadChildren = useCallback(
    async (dirPath: string): Promise<TreeNode[]> => {
      try {
        const entries = await fileService.listDir(dirPath);
        return entries
          .filter((e) => e.type === "directory")
          .map((e) => ({
            name: e.name,
            path: e.path,
            type: "directory" as const,
            children: [],
            expanded: false,
            loading: false,
          }));
      } catch {
        return [];
      }
    },
    [],
  );

  /** 展开/折叠目录节点 */
  const toggleNode = useCallback(
    async (parentPath: string, nodePath: string) => {
      setTreeData((prev) => {
        const updated = { ...prev };
        const parentNodes = [...(updated[parentPath] || [])];
        const idx = parentNodes.findIndex((n) => n.path === nodePath);
        if (idx === -1) return prev;

        const node = { ...parentNodes[idx] };

        if (!node.expanded && node.children.length === 0) {
          // 首次展开，标记为 loading
          node.loading = true;
          parentNodes[idx] = node;
          updated[parentPath] = parentNodes;

          // 异步加载子节点
          loadChildren(nodePath)
            .then((children) => {
              setTreeData((p) => {
                const next = { ...p };
                const nodes = [...(next[parentPath] || [])];
                const i = nodes.findIndex((n) => n.path === nodePath);
                if (i === -1) return p;
                nodes[i] = {
                  ...nodes[i],
                  children,
                  expanded: true,
                  loading: false,
                };
                next[parentPath] = nodes;
                return next;
              });
            })
            .catch(() => {
              // 加载失败：恢复节点状态
              setTreeData((p) => {
                const next = { ...p };
                const nodes = [...(next[parentPath] || [])];
                const i = nodes.findIndex((n) => n.path === nodePath);
                if (i === -1) return p;
                nodes[i] = { ...nodes[i], loading: false, expanded: false };
                next[parentPath] = nodes;
                return next;
              });
            });

          return updated;
        }

        node.expanded = !node.expanded;
        parentNodes[idx] = node;
        updated[parentPath] = parentNodes;
        return updated;
      });
    },
    [loadChildren],
  );

  /** 初始化根目录 */
  useEffect(() => {
    const initTrees = async () => {
      const treeMap: Record<string, TreeNode[]> = {};
      for (const root of roots) {
        treeMap[root.path] = await loadChildren(root.path);
      }
      setTreeData(treeMap);
    };
    initTrees();
  }, []);

  /** 判断路径是否被选中（包含子路径高亮） */
  const isActive = (nodePath: string): boolean => {
    return currentPath === nodePath || currentPath.startsWith(nodePath + "/");
  };

  /** 渲染单个树节点 */
  const renderNode = (node: TreeNode, parentPath: string, depth: number) => {
    const active = isActive(node.path);

    return (
      <div key={node.path}>
        <button
          onClick={() => {
            toggleNode(parentPath, node.path);
            onNavigate(node.path);
          }}
          className={`w-full flex items-center gap-1 px-2 py-1 text-left text-sm rounded-md transition-colors ${
            active
              ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
              : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50"
          }`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          title={node.path}
        >
          {/* 展开/折叠图标 */}
          <span className="flex-shrink-0 w-4 text-center text-xs text-gray-400">
            {node.loading ? (
              <span className="inline-block animate-spin">⟳</span>
            ) : node.children.length > 0 ? (
              node.expanded ? (
                "▼"
              ) : (
                "▶"
              )
            ) : (
              " "
            )}
          </span>
          {/* 文件夹图标 */}
          <span className="flex-shrink-0 text-sm">
            {node.expanded ? "📂" : "📁"}
          </span>
          {/* 名称 */}
          <span className="truncate text-xs">{node.name}</span>
        </button>

        {/* 子节点 */}
        {node.expanded && node.children.length > 0 && (
          <div>
            {node.children.map((child) =>
              renderNode(child, node.path, depth + 1),
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-60 flex-shrink-0 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
      {/* 标题 */}
      <div className="px-3 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          目录结构
        </h3>
      </div>

      {/* 根目录选择器 */}
      <div className="px-2 py-2 border-b border-gray-200 dark:border-gray-700 space-y-0.5">
        {roots.map((root) => (
          <button
            key={root.key}
            onClick={() => onRootChange(root.key)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm rounded-md transition-colors ${
              currentRoot === root.key
                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50"
            }`}
          >
            <span>{root.icon}</span>
            <span className="truncate">{root.label}</span>
          </button>
        ))}
      </div>

      {/* 树形目录 */}
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5">
        {roots.map((root) => {
          const nodes = treeData[root.path] || [];
          if (root.key !== currentRoot) return null;

          if (nodes.length === 0) {
            return (
              <div
                key={root.key}
                className="px-4 py-4 text-center text-xs text-gray-400"
              >
                此目录为空
              </div>
            );
          }

          return (
            <div key={root.key}>
              {nodes.map((node) => renderNode(node, root.path, 0))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DirectoryTree;
