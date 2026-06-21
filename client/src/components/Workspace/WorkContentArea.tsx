import { useWorkStore, type ContentView } from "../../stores/workStore";
import { TeamView } from "./TeamView";
import { CostView } from "./CostView";
import { WorkflowTemplateView } from "./WorkflowTemplateView";
import { CouncilView } from "./CouncilView";
import { OrchIntelligenceView } from "./OrchIntelligenceView";
import { RuleView } from "./RuleView";

interface WorkContentAreaProps {
  className?: string;
}

/** Tab 配置 */
interface TabConfig {
  key: ContentView;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { key: "welcome", label: "工作区", icon: "\u{1F3AF}" },
  { key: "editor", label: "编辑器", icon: "\u{1F527}" },
  { key: "council", label: "理事会", icon: "\u{1F3DB}\uFE0F" },
  { key: "intelligence", label: "智能", icon: "\u{1F9E0}" },
  { key: "rules", label: "规则", icon: "\u{1F4DC}" },
  { key: "team", label: "团队", icon: "\u{1F465}" },
  { key: "cost", label: "成本", icon: "\u{1F4B0}" },
  { key: "workflow_templates", label: "模板", icon: "\u{1F4CB}" },
];

/**
 * Plan 模式下的内容区
 * 显示方案/架构图/分析结果（只读视图）
 */
function PlanContentArea() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-3">{"\u{1F4CB}"}</div>
        <h3 className="text-base font-medium text-gray-700 dark:text-gray-300">
          方案视图
        </h3>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
          AI 正在分析需求，设计方案中...
        </p>
      </div>
    </div>
  );
}

/**
 * Do 模式下的内容区
 * 显示编辑器/diff/变更概览
 */
function DoContentArea() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-3">{"\u{1F527}"}</div>
        <h3 className="text-base font-medium text-gray-700 dark:text-gray-300">
          执行视图
        </h3>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
          AI 正在实施代码变更...
        </p>
      </div>
    </div>
  );
}

/**
 * 根据 contentView 渲染对应的内容视图
 */
function ContentViewRenderer({ contentView }: { contentView: ContentView }) {
  switch (contentView) {
    case "welcome":
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-5xl mb-4">{"\u{1F3AF}"}</div>
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
              欢迎使用工作界面
            </h2>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-2 max-w-md">
              在右侧对话区描述你的需求，AI 将根据 Plan/Do 模式协助你完成工作。
            </p>
          </div>
        </div>
      );
    case "team":
      return <TeamView />;
    case "cost":
      return <CostView />;
    case "workflow_templates":
      return <WorkflowTemplateView />;
    case "council":
      return <CouncilView />;
    case "intelligence":
      return <OrchIntelligenceView />;
    case "rules":
      return <RuleView />;
    default:
      const mode = useWorkStore.getState().mode;
      return mode === "plan" ? <PlanContentArea /> : <DoContentArea />;
  }
}

/**
 * 工作内容区容器
 * 顶部 Tab 导航 + 底部内容视图
 */
export default function WorkContentArea({ className }: WorkContentAreaProps) {
  const contentView = useWorkStore((s) => s.contentView);
  const setContentView = useWorkStore((s) => s.setContentView);
  const mode = useWorkStore((s) => s.mode);

  return (
    <div className={`${className} flex flex-col`}>
      {/* Tab 导航栏 */}
      <div className="flex items-center border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2">
        <div className="flex gap-1 py-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setContentView(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                contentView === tab.key
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-medium"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* 右侧模式指示 */}
        <div className="ml-auto flex items-center gap-2 pr-2">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {mode === "plan" ? "Plan" : "Do"}
          </span>
        </div>
      </div>

      {/* 内容视图 */}
      <div className="flex-1 overflow-hidden">
        <ContentViewRenderer contentView={contentView} />
      </div>
    </div>
  );
}