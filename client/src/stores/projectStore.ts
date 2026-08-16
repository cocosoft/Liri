import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Project, ProjectNode, ProjectStatus } from "../types/work";
import { taskService } from "../services/taskService";

const STORE_KEY = "liri-project-store";

interface ProjectStore {
  projects: Record<string, Project>;
  activeProjectId: string | null;
  isDecomposing: boolean;
  decomposingProjectId: string | null;
  error: string | null;
  /** 标记 store 已从 localStorage 恢复 */
  _hydrated: boolean;

  importNodesDirect: (
    workspaceId: string,
    name: string,
    requirements: string,
    nodes: ProjectNode[],
  ) => Project;
  getProject: (projectId: string) => Project | null;
  getNode: (projectId: string, nodeId: string) => ProjectNode | null;
  getRootNodes: (projectId: string) => ProjectNode[];
  getChildren: (projectId: string, nodeId: string) => ProjectNode[];
  updateNodeStatus: (
    projectId: string,
    nodeId: string,
    status: ProjectStatus,
  ) => void;
  updateNodeProgress: (
    projectId: string,
    nodeId: string,
    progress: number,
  ) => void;
  setActiveProject: (projectId: string | null) => void;
  recalculateProgress: (projectId: string) => void;
  deleteProject: (projectId: string) => void;

  // Phase C: 后端同步
  /** 将项目节点同步到后端 TaskStore */
  syncProjectToBackend: (projectId: string) => Promise<number>;
  /** 从后端加载项目节点 */
  loadProjectFromBackend: (projectId: string) => Promise<void>;
}

let _counter = 0;
function genId(): string {
  return "proj_" + Date.now() + "_" + ++_counter;
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: {},
      activeProjectId: null,
      isDecomposing: false,
      decomposingProjectId: null,
      error: null,
      _hydrated: false,

      importNodesDirect: (workspaceId, name, requirements, nodes) => {
        const id = genId();
        const nodesMap: Record<string, ProjectNode> = {};
        for (const node of nodes) {
          nodesMap[node.id] = node;
        }

        const allChildIds = new Set<string>();
        for (const node of nodes) {
          for (const childId of node.children) {
            allChildIds.add(childId);
          }
        }
        const rootNodes: string[] = [];
        for (const node of nodes) {
          if (!allChildIds.has(node.id)) {
            rootNodes.push(node.id);
          }
        }

        const project: Project = {
          id,
          workspaceId,
          name,
          description: name,
          sourceRequirements: requirements,
          rootNodes,
          nodes: nodesMap,
          status: "active",
          progress: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        set((s) => ({
          projects: { ...s.projects, [id]: project },
          activeProjectId: id,
        }));
        return project;
      },

      getProject: (projectId) => {
        return get().projects[projectId] ?? null;
      },

      getNode: (projectId, nodeId) => {
        const project = get().projects[projectId];
        if (!project) return null;
        return project.nodes[nodeId] ?? null;
      },

      getRootNodes: (projectId) => {
        const project = get().projects[projectId];
        if (!project) return [];
        return project.rootNodes
          .map((id) => project.nodes[id])
          .filter(Boolean) as ProjectNode[];
      },

      getChildren: (projectId, nodeId) => {
        const project = get().projects[projectId];
        if (!project) return [];
        const node = project.nodes[nodeId];
        if (!node) return [];
        return node.children
          .map((id) => project.nodes[id])
          .filter(Boolean) as ProjectNode[];
      },

      updateNodeStatus: (projectId, nodeId, status) => {
        set((s) => {
          const project = s.projects[projectId];
          if (!project) return {};
          const node = project.nodes[nodeId];
          if (!node) return {};
          return {
            projects: {
              ...s.projects,
              [projectId]: {
                ...project,
                nodes: { ...project.nodes, [nodeId]: { ...node, status } },
                updatedAt: Date.now(),
              },
            },
          };
        });
        get().recalculateProgress(projectId);
      },

      updateNodeProgress: (projectId, nodeId, progress) => {
        set((s) => {
          const project = s.projects[projectId];
          if (!project) return {};
          const node = project.nodes[nodeId];
          if (!node) return {};
          return {
            projects: {
              ...s.projects,
              [projectId]: {
                ...project,
                nodes: { ...project.nodes, [nodeId]: { ...node, progress } },
                updatedAt: Date.now(),
              },
            },
          };
        });
        get().recalculateProgress(projectId);
      },

      setActiveProject: (projectId) => {
        set({ activeProjectId: projectId });
      },

      recalculateProgress: (projectId) => {
        const project = get().projects[projectId];
        if (!project) return;
        const nodeIds = Object.keys(project.nodes);
        if (nodeIds.length === 0) return;

        let totalProgress = 0;
        for (const id of nodeIds) {
          const node = project.nodes[id];
          if (node.status === "completed" || node.status === "archived") {
            totalProgress += 100;
          } else {
            totalProgress += node.progress;
          }
        }
        const avgProgress = Math.round(totalProgress / nodeIds.length);

        let overallStatus: ProjectStatus = "active";
        const allDone = nodeIds.every((id) => {
          const n = project.nodes[id];
          return n.status === "completed" || n.status === "archived";
        });
        if (allDone && nodeIds.length > 0) overallStatus = "completed";
        else if (avgProgress === 0) overallStatus = "planning";

        set((s) => ({
          projects: {
            ...s.projects,
            [projectId]: {
              ...project,
              progress: avgProgress,
              status: overallStatus,
              updatedAt: Date.now(),
            },
          },
        }));
      },

      deleteProject: (projectId) => {
        set((s) => {
          const { [projectId]: _, ...rest } = s.projects;
          const newActive =
            s.activeProjectId === projectId ? null : s.activeProjectId;
          return { projects: rest, activeProjectId: newActive };
        });
      },

      // Phase C: 后端同步
      syncProjectToBackend: async (projectId) => {
        const project = get().projects[projectId];
        if (!project) return 0;

        const nodes = Object.values(project.nodes);
        let count = 0;
        for (const node of nodes) {
          const existing = await taskService.get(node.id);
          if (existing) {
            await taskService.update(node.id, {
              title: node.title,
              description: node.description,
              status:
                node.status as unknown as import("../types/work").TaskStatus,
              priority: (node.priority === "P0"
                ? 0
                : node.priority === "P1"
                  ? 1
                  : node.priority === "P2"
                    ? 2
                    : 3) as import("../types/work").TaskPriority,
              progress: node.progress,
              tags: node.tags,
            });
          } else {
            await taskService.create({
              workspaceId: project.workspaceId,
              projectId: project.id,
              title: node.title,
              description: node.description,
              type: node.type as import("../types/work").TaskType,
              status:
                node.status as unknown as import("../types/work").TaskStatus,
              priority: (node.priority === "P0"
                ? 0
                : node.priority === "P1"
                  ? 1
                  : node.priority === "P2"
                    ? 2
                    : 3) as import("../types/work").TaskPriority,
              progress: node.progress,
              tags: node.tags,
            });
          }
          count++;
        }
        return count;
      },

      loadProjectFromBackend: async (projectId) => {
        const tasks = await taskService.list({ projectId });
        if (tasks.length === 0) return;

        const project = get().projects[projectId];
        if (!project) return;

        const nodesMap: Record<string, ProjectNode> = {};
        const rootNodes: string[] = [];

        for (const task of tasks) {
          const node: ProjectNode = {
            id: task.id,
            projectId: project.id,
            type: task.type as ProjectNode["type"],
            title: task.title,
            description: task.description,
            priority: (task.priority === 0
              ? "P0"
              : task.priority === 1
                ? "P1"
                : task.priority === 2
                  ? "P2"
                  : "P3") as ProjectNode["priority"],
            status: task.status as ProjectNode["status"],
            progress: task.progress,
            children: [],
            dependsOn: task.dependsOn,
            tags: task.tags,
            estimatedEffort: task.estimatedEffort ?? "",
            assignee: task.assignee ?? "",
            startedAt: task.startedAt ? new Date(task.startedAt).getTime() : 0,
            completedAt: task.completedAt
              ? new Date(task.completedAt).getTime()
              : 0,
            createdAt: new Date(task.createdAt).getTime(),
          };
          nodesMap[node.id] = node;
          if (!task.parentId) {
            rootNodes.push(node.id);
          }
        }

        // 构建 children 反向引用
        for (const task of tasks) {
          if (task.parentId && nodesMap[task.parentId]) {
            nodesMap[task.parentId].children.push(task.id);
          }
        }

        set((s) => ({
          projects: {
            ...s.projects,
            [projectId]: {
              ...project,
              nodes: nodesMap,
              rootNodes: rootNodes.length > 0 ? rootNodes : project.rootNodes,
              updatedAt: Date.now(),
            },
          },
        }));
        get().recalculateProgress(projectId);
      },
    }),
    {
      name: STORE_KEY,
      partialize: (state) => ({
        projects: state.projects,
        activeProjectId: state.activeProjectId,
        _hydrated: true,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state._hydrated = true;
      },
    },
  ),
);
