import type { ProjectNode } from "../types/work";

export interface DecomposeOptions {
  projectId: string;
}

function ruleBasedDecompose(
  requirements: string,
  options: { projectId: string },
): ProjectNode[] {
  const nodes: ProjectNode[] = [];
  const projectId = options.projectId;
  let nodeCounter = 0;
  const id = () => `${projectId}_n${++nodeCounter}`;

  const hasScene = (keyword: string) => requirements.includes(keyword);

  const baseNodeId = id();
  nodes.push({
    id: baseNodeId,
    projectId,
    type: "phase",
    title: "流程数据接入层搭建",
    description:
      "对接电网管理平台各业务域数据接口,建立统一的数据模型和指标引擎",
    priority: "P0",
    status: "planning",
    progress: 0,
    children: [id(), id(), id()],
    dependsOn: [],
    tags: ["", "数据"],
    estimatedEffort: "3-4 周",
    assignee: "",
    startedAt: 0,
    completedAt: 0,
    createdAt: Date.now(),
  });

  const baseChildren = [
    "数据接口适配器",
    "统一流程数据模型",
    "流程指标计算引擎",
  ];
  for (const i in baseChildren) {
    nodes.push({
      id: `${baseNodeId}_${i}`,
      projectId,
      type: "task",
      title: baseChildren[i],
      description: "",
      priority: "P0",
      status: "planning",
      progress: 0,
      children: [],
      dependsOn: [],
      tags: ["底座"],
      estimatedEffort: "1-2 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
  }

  const boardNodeId = id();
  nodes.push({
    id: boardNodeId,
    projectId,
    type: "phase",
    title: "流程穿式监控大看板框架",
    description:
      "统一入口框架,集中展示流程运行状态、关键指标、问题分布、风险等级和整改进度",
    priority: "P0",
    status: "planning",
    progress: 0,
    children: [id(), id()],
    dependsOn: [baseNodeId],
    tags: ["底座", "看板"],
    estimatedEffort: "2-3 周",
    assignee: "",
    startedAt: 0,
    completedAt: 0,
    createdAt: Date.now(),
  });

  const boardChildren = ["卡片式场景工组件", "全局指标图表组件"];
  for (const i in boardChildren) {
    nodes.push({
      id: `${boardNodeId}_${i}`,
      projectId,
      type: "task",
      title: boardChildren[i],
      description: "",
      priority: "P0",
      status: "planning",
      progress: 0,
      children: [],
      dependsOn: [],
      tags: ["看板"],
      estimatedEffort: "1 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
  }

  const scene5Id = id();
  nodes.push({
    id: scene5Id,
    projectId,
    type: "story",
    title: "采购全流程时长预警场景",
    description:
      "采购立项→方案编制→文件审批→招标→定标→通知书下发→履约的全流程时长监控与预警",
    priority: "P0",
    status: "planning",
    progress: 0,
    children: [id(), id(), id()],
    dependsOn: [baseNodeId],
    tags: ["场景", "采购", "MVP"],
    estimatedEffort: "4-5 周",
    assignee: "",
    startedAt: 0,
    completedAt: 0,
    createdAt: Date.now(),
  });

  const scene5Children = [
    "采购流程数据清洗与时序建模",
    "时长预警规则配置与督办引擎",
    "采购场景看板卡片",
  ];
  for (const i in scene5Children) {
    nodes.push({
      id: `${scene5Id}_${i}`,
      projectId,
      type: "task",
      title: scene5Children[i],
      description: "",
      priority: "P0",
      status: "planning",
      progress: 0,
      children: [],
      dependsOn: [],
      tags: ["采购"],
      estimatedEffort: "1-2 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
  }

  if (hasScene("花钱问效") || hasScene("经营")) {
    const scene3Id = id();
    nodes.push({
      id: scene3Id,
      projectId,
      type: "story",
      title: "花钱问效穿透式经营分析场景",
      description: "预算→项目→任务→指标→效益的穿透关联与闭环评价",
      priority: "P1",
      status: "planning",
      progress: 0,
      children: [id(), id()],
      dependsOn: [baseNodeId],
      tags: ["场景", "经营分析"],
      estimatedEffort: "3-4 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });

    nodes.push({
      id: `${scene3Id}_1`,
      projectId,
      type: "task",
      title: "预算-项目-效益关联模型建设",
      description: "",
      priority: "P1",
      status: "planning",
      progress: 0,
      children: [],
      dependsOn: [],
      tags: ["经营分析"],
      estimatedEffort: "2 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
    nodes.push({
      id: `${scene3Id}_2`,
      projectId,
      type: "task",
      title: "经营分析看板与报表卡片",
      description: "",
      priority: "P1",
      status: "planning",
      progress: 0,
      children: [],
      dependsOn: [],
      tags: ["经营分析"],
      estimatedEffort: "1-2 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
  }

  if (hasScene("特高压")) {
    const scene4Id = id();
    nodes.push({
      id: scene4Id,
      projectId,
      type: "story",
      title: "特高压直流工程建设智能监控场景",
      description: "物资→安全→进度→质量→验收的全跨域端到端流程监控",
      priority: "P1",
      status: "planning",
      progress: 0,
      children: [id(), id()],
      dependsOn: [baseNodeId],
      tags: ["场景", "特高压"],
      estimatedEffort: "4-5 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
    nodes.push({
      id: `${scene4Id}_1`,
      projectId,
      type: "task",
      title: "跨域流程织与监控",
      description: "",
      priority: "P1",
      status: "planning",
      progress: 0,
      children: [],
      dependsOn: [],
      tags: ["特高压"],
      estimatedEffort: "2-3 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
    nodes.push({
      id: `${scene4Id}_2`,
      projectId,
      type: "task",
      title: "工程偏差预警与督办",
      description: "",
      priority: "P1",
      status: "planning",
      progress: 0,
      children: [],
      dependsOn: [],
      tags: ["特高压"],
      estimatedEffort: "1-2 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
  }

  if (hasScene("两票") || hasScene("智慧两票")) {
    const scene1Id = id();
    nodes.push({
      id: scene1Id,
      projectId,
      type: "story",
      title: "智慧两票及施工方案全流程管控场景",
      description: "操作票、工作票、施工方案的全流程智化管控",
      priority: "P2",
      status: "planning",
      progress: 0,
      children: [id(), id()],
      dependsOn: [baseNodeId],
      tags: ["场景", "两票", "基层减负"],
      estimatedEffort: "5-6 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
    nodes.push({
      id: `${scene1Id}_1`,
      projectId,
      type: "task",
      title: "两票智能编制与审核",
      description: "",
      priority: "P2",
      status: "planning",
      progress: 0,
      children: [],
      dependsOn: [],
      tags: ["两票"],
      estimatedEffort: "3 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
    nodes.push({
      id: `${scene1Id}_2`,
      projectId,
      type: "task",
      title: "现场执行与在线归档",
      description: "",
      priority: "P2",
      status: "planning",
      progress: 0,
      children: [],
      dependsOn: [],
      tags: ["两票"],
      estimatedEffort: "2-3 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
  }

  if (hasScene("第一议题")) {
    const scene2Id = id();
    nodes.push({
      id: scene2Id,
      projectId,
      type: "story",
      title: "第一议题学习监控场景",
      description: "议题形成→材料收集→审议→学习记录→反馈督办的全程监控",
      priority: "P2",
      status: "planning",
      progress: 0,
      children: [id(), id()],
      dependsOn: [baseNodeId],
      tags: ["场景", "第一议题"],
      estimatedEffort: "2-3 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
    nodes.push({
      id: `${scene2Id}_1`,
      projectId,
      type: "task",
      title: "第一议题流程数字化与数据接入",
      description: "",
      priority: "P2",
      status: "planning",
      progress: 0,
      children: [],
      dependsOn: [],
      tags: ["第一议题"],
      estimatedEffort: "1-2 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
    nodes.push({
      id: `${scene2Id}_2`,
      projectId,
      type: "task",
      title: "议执行看板",
      description: "",
      priority: "P2",
      status: "planning",
      progress: 0,
      children: [],
      dependsOn: [],
      tags: ["第一议题"],
      estimatedEffort: "1 周",
      assignee: "",
      startedAt: 0,
      completedAt: 0,
      createdAt: Date.now(),
    });
  }

  const aiNodeId = id();
  nodes.push({
    id: aiNodeId,
    projectId,
    type: "phase",
    title: "AI 异常诊断与智能体能力",
    description: "基于大瓦特—智周的流程识别、比对、诊断智能体",
    priority: "P2",
    status: "planning",
    progress: 0,
    children: [id(), id()],
    dependsOn: [baseNodeId],
    tags: ["AI"],
    estimatedEffort: "5-6 周",
    assignee: "",
    startedAt: 0,
    completedAt: 0,
    createdAt: Date.now(),
  });

  nodes.push({
    id: `${aiNodeId}_1`,
    projectId,
    type: "task",
    title: "规则驱动的异常诊断引擎(第一阶段)",
    description: "基于规则的流程堵点/断点/超期识别",
    priority: "P2",
    status: "planning",
    progress: 0,
    children: [],
    dependsOn: [],
    tags: ["AI"],
    estimatedEffort: "2-3 周",
    assignee: "",
    startedAt: 0,
    completedAt: 0,
    createdAt: Date.now(),
  });
  nodes.push({
    id: `${aiNodeId}_2`,
    projectId,
    type: "task",
    title: "制度→流程自动映射(第二阶段)",
    description: "利用 LLM 实现制度文本到流程节点的自动映射",
    priority: "P3",
    status: "planning",
    progress: 0,
    children: [],
    dependsOn: [],
    tags: ["AI", "LLM"],
    estimatedEffort: "4-5 周",
    assignee: "",
    startedAt: 0,
    completedAt: 0,
    createdAt: Date.now(),
  });

  return nodes;
}

// TODO: CS05-ROOTFIX — 当前 decompose 返回硬编码的电网流程监控模板，根本不是 AI 分解。
// 根因方案：改为调用后端 LLM（POST /v1/projects/:id/decompose），将 ruleBasedDecompose 降级为离线兜底。
// 关联问题：P3（项目模块双体系混乱优化方案）
export async function decompose(
  requirements: string,
  options: DecomposeOptions,
): Promise<ProjectNode[]> {
  return ruleBasedDecompose(requirements, options);
}

export const projectDecomposer = {
  decompose,
};
