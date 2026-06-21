import { create } from "zustand";
import type { Project, ProjectNode, ProjectStatus } from "../types/work";

interface ProjectStore {
  projects: Record<string, Project>;
  activeProjectId: string | null;
  isDecomposing: boolean;
  decomposingProjectId: string | null;
  error: string | null;

  createProject: (workspaceId: string, name: string, description: string) => Project;
  importNodesDirect: (workspaceId: string, name: string, requirements: string, nodes: ProjectNode[]) => Project;
  getProject: (projectId: string) => Project | null;
  getNode: (projectId: string, nodeId: string) => ProjectNode | null;
  getRootNodes: (projectId: string) => ProjectNode[];
  getChildren: (projectId: string, nodeId: string) => ProjectNode[];
  updateNodeStatus: (projectId: string, nodeId: string, status: ProjectStatus) => void;
  updateNodeProgress: (projectId: string, nodeId: string, progress: number) => void;
  setActiveProject: (projectId: string | null) => void;
  recalculateProgress: (projectId: string) => void;
  deleteProject: (projectId: string) => void;
}

let _counter = 0;
function genId(): string {
  return "proj_" + Date.now() + "_" + (++_counter);
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: {},
  activeProjectId: null,
  isDecomposing: false,
  decomposingProjectId: null,
  error: null,

  createProject: (workspaceId, name, description) => {
    const id = genId();
    const project: Project = {
      id, workspaceId, name, description,
      sourceRequirements: "",
      rootNodes: [],
      nodes: {},
      status: "planning",
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
      id, workspaceId, name,
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
    return project.rootNodes.map((id) => project.nodes[id]).filter(Boolean) as ProjectNode[];
  },

  getChildren: (projectId, nodeId) => {
    const project = get().projects[projectId];
    if (!project) return [];
    const node = project.nodes[nodeId];
    if (!node) return [];
    return node.children.map((id) => project.nodes[id]).filter(Boolean) as ProjectNode[];
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
      const newActive = s.activeProjectId === projectId ? null : s.activeProjectId;
      return { projects: rest, activeProjectId: newActive };
    });
  },
}));
