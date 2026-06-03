import { useState, useEffect } from "react";
import { useBuddyStore } from "../../stores/buddyStore";

interface EvolutionStage {
  id: string;
  name: string;
  level: number;
  unlocked: boolean;
  description: string;
}

interface EvolutionPath {
  current: EvolutionStage;
  next: EvolutionStage | null;
  progress: number;
}

function BuddyEvolution() {
  const { companion } = useBuddyStore();
  const [evolutionPath, setEvolutionPath] = useState<EvolutionPath | null>(
    null,
  );
  const [allStages, setAllStages] = useState<EvolutionStage[]>([]);

  useEffect(() => {
    if (!companion) return;

    const stages: EvolutionStage[] = [
      {
        id: "egg",
        name: "蛋",
        level: 0,
        unlocked: true,
        description: "未孵化的伙伴蛋",
      },
      {
        id: "baby",
        name: "幼年期",
        level: 1,
        unlocked: companion.level >= 1,
        description: "刚刚孵化的伙伴",
      },
      {
        id: "child",
        name: "成长期",
        level: 5,
        unlocked: companion.level >= 5,
        description: "正在成长的伙伴",
      },
      {
        id: "adult",
        name: "成熟期",
        level: 10,
        unlocked: companion.level >= 10,
        description: "已经完全成长的伙伴",
      },
      {
        id: "elder",
        name: "老年期",
        level: 20,
        unlocked: companion.level >= 20,
        description: "经验丰富的伙伴",
      },
      {
        id: "legend",
        name: "传说",
        level: 30,
        unlocked: companion.level >= 30,
        description: "传说中的伙伴",
      },
    ];

    setAllStages(stages);

    const currentIndex = stages.findIndex(
      (s, i) => s.unlocked && !stages[i + 1]?.unlocked,
    );
    const current = stages[currentIndex] || stages[0];
    const next = stages[currentIndex + 1] || null;
    const progress = next
      ? ((companion.level - current.level) / (next.level - current.level)) * 100
      : 100;

    setEvolutionPath({ current, next, progress: Math.min(progress, 100) });
  }, [companion]);

  if (!companion || !evolutionPath) {
    return <div className="p-4 text-center text-gray-400">暂无伙伴数据</div>;
  }

  return (
    <div className="p-4">
      <h3 className="text-lg font-medium mb-4">进化树</h3>

      <div className="relative">
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-300 dark:bg-gray-600" />

        {allStages.map((stage) => {
          const isCurrentStage = stage.id === evolutionPath.current.id;
          const isUnlocked = stage.unlocked;

          return (
            <div key={stage.id} className="relative pl-14 pb-6">
              <div
                className={`absolute left-4 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  isCurrentStage
                    ? "bg-blue-500 border-blue-500"
                    : isUnlocked
                      ? "bg-green-500 border-green-500"
                      : "bg-gray-200 dark:bg-gray-700 border-gray-400"
                }`}
              >
                {isUnlocked && (
                  <span
                    className={`text-xs ${isCurrentStage ? "text-white" : "text-white"}`}
                  >
                    {stage.level}
                  </span>
                )}
              </div>

              <div
                className={`p-3 rounded-lg border ${
                  isCurrentStage
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : isUnlocked
                      ? "border-green-500/50 bg-green-50/50 dark:bg-green-900/10"
                      : "border-gray-200 dark:border-gray-700 opacity-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`font-medium ${isCurrentStage ? "text-blue-600 dark:text-blue-400" : ""}`}
                  >
                    {stage.name}
                  </span>
                  <span className="text-xs text-gray-500">
                    Lv.{stage.level}
                  </span>
                </div>
                <p
                  className={`text-xs mt-1 ${isCurrentStage ? "text-blue-600/70 dark:text-blue-400/70" : "text-gray-500"}`}
                >
                  {stage.description}
                </p>
                {isCurrentStage && evolutionPath.next && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span>进化进度</span>
                      <span>{evolutionPath.progress.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{ width: `${evolutionPath.progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      距离 {evolutionPath.next.name} 还需{" "}
                      {evolutionPath.next.level - (companion?.level || 0)} 级
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
        <h4 className="text-sm font-medium mb-2">进化条件</h4>
        <ul className="text-xs space-y-1 text-gray-600 dark:text-gray-400">
          <li>• 达到指定等级即可进化</li>
          <li>• 进化后属性将获得显著提升</li>
          <li>• 传说形态需要达到30级</li>
        </ul>
      </div>
    </div>
  );
}

export default BuddyEvolution;
