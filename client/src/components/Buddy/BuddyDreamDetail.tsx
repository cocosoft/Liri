import { useState, useEffect } from 'react';
import { useBuddyStore } from '../../stores/buddyStore';

interface DreamEntry {
  id: string;
  date: string;
  title: string;
  content: string;
  mood: string;
  duration: number;
  symbols: string[];
}

function BuddyDreamDetail() {
  const { companion } = useBuddyStore();
  const [dreams, setDreams] = useState<DreamEntry[]>([]);
  const [selectedDream, setSelectedDream] = useState<DreamEntry | null>(null);

  useEffect(() => {
    const mockDreams: DreamEntry[] = [
      {
        id: '1',
        date: '2026-05-28',
        title: '星空探索',
        content: '梦见和伙伴一起在星空中飞翔，探索未知的星球。',
        mood: 'excited',
        duration: 45,
        symbols: ['⭐', '🚀', '🌌'],
      },
      {
        id: '2',
        date: '2026-05-27',
        title: '深海冒险',
        content: '梦见潜入深海，与海洋生物一起游泳。',
        mood: 'peaceful',
        duration: 30,
        symbols: ['🌊', '🐠', '🪸'],
      },
      {
        id: '3',
        date: '2026-05-26',
        title: '森林奇遇',
        content: '梦见在神秘的森林中迷路，但伙伴引导找到了出口。',
        mood: 'adventurous',
        duration: 60,
        symbols: ['🌲', '🦋', '🍄'],
      },
    ];
    setDreams(mockDreams);
  }, []);

  const getMoodEmoji = (mood: string) => {
    switch (mood) {
      case 'excited': return '🤩';
      case 'peaceful': return '😌';
      case 'adventurous': return '🌟';
      case 'scared': return '😨';
      case 'happy': return '😊';
      default: return '💭';
    }
  };

  const getMoodText = (mood: string) => {
    switch (mood) {
      case 'excited': return '兴奋';
      case 'peaceful': return '平静';
      case 'adventurous': return '冒险';
      case 'scared': return '恐惧';
      case 'happy': return '幸福';
      default: return '未知';
    }
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}分钟`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}小时${mins > 0 ? `${mins}分钟` : ''}`;
  };

  if (!companion) {
    return (
      <div className="p-4 text-center text-gray-400">
        暂无伙伴数据
      </div>
    );
  }

  return (
    <div className="p-4">
      <h3 className="text-lg font-medium mb-4">梦境记录</h3>

      {selectedDream ? (
        <div>
          <button
            onClick={() => setSelectedDream(null)}
            className="mb-4 px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            返回列表
          </button>

          <div className={`rounded-lg p-4 mb-4 ${
            selectedDream.mood === 'excited' ? 'bg-purple-100 dark:bg-purple-900/20' :
            selectedDream.mood === 'peaceful' ? 'bg-blue-100 dark:bg-blue-900/20' :
            'bg-green-100 dark:bg-green-900/20'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-3xl">{getMoodEmoji(selectedDream.mood)}</span>
              <span className="text-sm text-gray-500">{selectedDream.date}</span>
            </div>
            <h4 className="text-xl font-medium mb-2">{selectedDream.title}</h4>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
              {selectedDream.content}
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>⏱ {formatDuration(selectedDream.duration)}</span>
              <span>心情: {getMoodText(selectedDream.mood)}</span>
            </div>
            {selectedDream.symbols.length > 0 && (
              <div className="mt-3 flex gap-2">
                {selectedDream.symbols.map((symbol, i) => (
                  <span key={i} className="text-2xl">{symbol}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {dreams.length === 0 ? (
            <p className="text-center text-gray-400 py-8">暂无梦境记录</p>
          ) : (
            dreams.map((dream) => (
              <button
                key={dream.id}
                onClick={() => setSelectedDream(dream)}
                className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{dream.title}</span>
                  <span className="text-xl">{getMoodEmoji(dream.mood)}</span>
                </div>
                <p className="text-xs text-gray-500 truncate">{dream.content}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                  <span>{dream.date}</span>
                  <span>{formatDuration(dream.duration)}</span>
                  <div className="flex gap-1">
                    {dream.symbols.slice(0, 3).map((s, i) => (
                      <span key={i}>{s}</span>
                    ))}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
        <h4 className="text-sm font-medium mb-2">梦境解读</h4>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          伙伴的梦境反映了其潜意识状态。与伙伴积极互动可以帮助它产生更多正面的梦境体验。
        </p>
      </div>
    </div>
  );
}

export default BuddyDreamDetail;