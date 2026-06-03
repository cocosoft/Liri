import { useState, useEffect, useCallback } from "react";
import { useBuddyStore } from "../../stores/buddyStore";

interface GameScore {
  correct: number;
  total: number;
  streak: number;
  maxStreak: number;
}

type GameType = "math" | "memory" | "reaction";

function BuddyGame() {
  const { interact } = useBuddyStore();
  const [activeGame, setActiveGame] = useState<GameType | null>(null);
  const [score, setScore] = useState<GameScore>({
    correct: 0,
    total: 0,
    streak: 0,
    maxStreak: 0,
  });
  const [gameActive, setGameActive] = useState(false);
  const [mathProblem, setMathProblem] = useState<{
    question: string;
    answer: number;
  } | null>(null);
  const [userAnswer, setUserAnswer] = useState("");
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [memorySequence, setMemorySequence] = useState<number[]>([]);
  const [memoryInput, setMemoryInput] = useState<number[]>([]);
  const [memoryPhase, setMemoryPhase] = useState<"watch" | "input" | "result">(
    "watch",
  );
  const [reactionTime, setReactionTime] = useState<number | null>(null);
  const [waitStart, setWaitStart] = useState<number | null>(null);
  const [gameStarted, setGameStarted] = useState(false);

  const generateMathProblem = useCallback(() => {
    const ops = ["+", "-", "*"];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let a = Math.floor(Math.random() * 20) + 1;
    let b = Math.floor(Math.random() * 20) + 1;
    if (op === "-" && a < b) [a, b] = [b, a];
    const answer = eval(`${a}${op}${b}`) as number;
    setMathProblem({ question: `${a} ${op} ${b} = ?`, answer });
    setUserAnswer("");
    setFeedback(null);
  }, []);

  const generateMemorySequence = useCallback((length: number) => {
    const seq = Array.from({ length }, () => Math.floor(Math.random() * 9) + 1);
    setMemorySequence(seq);
    setMemoryInput([]);
    setMemoryPhase("watch");
  }, []);

  const startReactionGame = useCallback(() => {
    setReactionTime(null);
    setWaitStart(null);
    setGameStarted(false);
    const delay = Math.random() * 3000 + 1000;
    setTimeout(() => {
      setWaitStart(Date.now());
      setGameStarted(true);
    }, delay);
  }, []);

  const handleAnswer = () => {
    if (!mathProblem) return;
    const num = parseInt(userAnswer, 10);
    if (num === mathProblem.answer) {
      setFeedback("correct");
      setScore((prev) => ({
        correct: prev.correct + 1,
        total: prev.total + 1,
        streak: prev.streak + 1,
        maxStreak: Math.max(prev.maxStreak, prev.streak + 1),
      }));
      interact("play");
    } else {
      setFeedback("wrong");
      setScore((prev) => ({
        ...prev,
        total: prev.total + 1,
        streak: 0,
      }));
    }
    setTimeout(generateMathProblem, 1000);
  };

  const handleMemoryClick = (num: number) => {
    if (memoryPhase !== "input") return;
    const newInput = [...memoryInput, num];
    setMemoryInput(newInput);
    if (newInput.length === memorySequence.length) {
      setMemoryPhase("result");
      const correct = newInput.every((n, i) => n === memorySequence[i]);
      setFeedback(correct ? "correct" : "wrong");
      setScore((prev) => ({
        correct: prev.correct + (correct ? 1 : 0),
        total: prev.total + 1,
        streak: correct ? prev.streak + 1 : 0,
        maxStreak: correct
          ? Math.max(prev.maxStreak, prev.streak + 1)
          : prev.maxStreak,
      }));
      if (correct) interact("play");
    }
  };

  const handleReactionClick = () => {
    if (!waitStart) return;
    if (!gameStarted) {
      setFeedback("wrong");
      setScore((prev) => ({ ...prev, total: prev.total + 1, streak: 0 }));
      startReactionGame();
    } else {
      const time = Date.now() - waitStart;
      setReactionTime(time);
      setFeedback(time < 300 ? "correct" : time < 500 ? "wrong" : "wrong");
      setScore((prev) => ({
        correct: prev.correct + (time < 300 ? 1 : 0),
        total: prev.total + 1,
        streak: time < 300 ? prev.streak + 1 : 0,
        maxStreak:
          time < 300
            ? Math.max(prev.maxStreak, prev.streak + 1)
            : prev.maxStreak,
      }));
      if (time < 300) interact("play");
    }
  };

  useEffect(() => {
    if (activeGame === "math" && gameActive) {
      generateMathProblem();
    } else if (activeGame === "memory" && gameActive) {
      generateMemorySequence(4);
    } else if (activeGame === "reaction" && gameActive) {
      startReactionGame();
    }
  }, [
    activeGame,
    gameActive,
    generateMathProblem,
    generateMemorySequence,
    startReactionGame,
  ]);

  useEffect(() => {
    if (activeGame === "memory" && memoryPhase === "watch") {
      const timer = setTimeout(() => setMemoryPhase("input"), 1500);
      return () => clearTimeout(timer);
    }
  }, [activeGame, memoryPhase, memorySequence]);

  const resetGame = () => {
    setScore({ correct: 0, total: 0, streak: 0, maxStreak: 0 });
    setGameActive(true);
    setFeedback(null);
  };

  const renderGame = () => {
    switch (activeGame) {
      case "math":
        return (
          <div className="flex flex-col items-center">
            <p className="text-2xl font-bold mb-4">{mathProblem?.question}</p>
            <input
              type="number"
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnswer()}
              className="w-32 px-4 py-2 text-center text-xl border rounded-lg bg-white dark:bg-gray-700"
              autoFocus
            />
            <button
              onClick={handleAnswer}
              className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg"
            >
              回答
            </button>
          </div>
        );
      case "memory":
        return (
          <div className="flex flex-col items-center">
            {memoryPhase === "watch" && (
              <div className="flex gap-2 mb-4">
                {memorySequence.map((num, i) => (
                  <span
                    key={i}
                    className="w-12 h-12 flex items-center justify-center text-xl font-bold bg-blue-500 text-white rounded"
                  >
                    {num}
                  </span>
                ))}
              </div>
            )}
            {memoryPhase === "input" && (
              <div className="grid grid-cols-3 gap-2 mb-4">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <button
                    key={num}
                    onClick={() => handleMemoryClick(num)}
                    className="w-12 h-12 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded text-lg font-bold"
                  >
                    {num}
                  </button>
                ))}
              </div>
            )}
            {memoryPhase === "result" && (
              <div className="text-center">
                <p className="text-lg mb-2">正确顺序:</p>
                <div className="flex gap-2 mb-4">
                  {memorySequence.map((num, i) => (
                    <span
                      key={i}
                      className="w-12 h-12 flex items-center justify-center bg-green-500 text-white rounded text-lg font-bold"
                    >
                      {num}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      case "reaction":
        return (
          <div className="flex flex-col items-center">
            <button
              onClick={handleReactionClick}
              className={`w-48 h-48 rounded-full text-2xl font-bold transition-colors ${
                gameStarted
                  ? "bg-green-500 hover:bg-green-600 text-white"
                  : "bg-red-500 hover:bg-red-600 text-white"
              }`}
            >
              {waitStart === null ? "准备..." : gameStarted ? "点击!" : "太早!"}
            </button>
            {reactionTime !== null && (
              <p className="mt-4 text-xl">反应时间: {reactionTime}ms</p>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="p-4">
      <h3 className="text-lg font-medium mb-4">互动小游戏</h3>
      {!activeGame || !gameActive ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                setActiveGame("math");
                resetGame();
              }}
              className="px-4 py-3 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-lg text-center"
            >
              <span className="text-2xl">🔢</span>
              <p className="text-sm mt-1">速算</p>
            </button>
            <button
              onClick={() => {
                setActiveGame("memory");
                resetGame();
              }}
              className="px-4 py-3 bg-purple-100 dark:bg-purple-900/30 hover:bg-purple-200 dark:hover:bg-purple-900/50 rounded-lg text-center"
            >
              <span className="text-2xl">🧠</span>
              <p className="text-sm mt-1">记忆</p>
            </button>
            <button
              onClick={() => {
                setActiveGame("reaction");
                resetGame();
              }}
              className="px-4 py-3 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 rounded-lg text-center"
            >
              <span className="text-2xl">⚡</span>
              <p className="text-sm mt-1">反应</p>
            </button>
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            <p>
              正确: {score.correct} / 总计: {score.total}
            </p>
            <p>
              连续正确: {score.streak} (最高: {score.maxStreak})
            </p>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => {
                setActiveGame(null);
                setGameActive(false);
              }}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded"
            >
              返回
            </button>
            <div className="flex gap-4 text-sm">
              <span>正确: {score.correct}</span>
              <span>连续: {score.streak}</span>
            </div>
          </div>
          {renderGame()}
          {feedback && (
            <p
              className={`mt-4 text-center text-lg ${feedback === "correct" ? "text-green-500" : "text-red-500"}`}
            >
              {feedback === "correct" ? "✓ 正确!" : "✗ 错误"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default BuddyGame;
