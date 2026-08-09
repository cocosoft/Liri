/**
 * 架构健康度脚本
 *
 * 按 .trae/rules/architecture-compliance.md R06 / GR01-GR07 规则，
 * 扫描 app/src/ 目录，产出架构健康度 JSON 报告。
 *
 * 使用: bun run scripts/architecture-health.ts [--json] [--compare]
 *   --json     仅输出 JSON（CI 模式）
 *   --compare  与上次报告对比输出趋势
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";

// 解析项目根：优先使用环境变量 PYAPP_PROJECT_DIR（与 lint 脚本约定一致），其次取 cwd
const PROJECT_DIR = process.env.PYAPP_PROJECT_DIR || process.cwd();
const SRC_PATH = join(PROJECT_DIR, "app", "src");
const REPORT_DIR = join(PROJECT_DIR, "dev_docs");
const REPORT_FILE = join(REPORT_DIR, "architecture-health.json");
const HISTORY_FILE = join(REPORT_DIR, "architecture-health-history.json");

const OVERSIZE_THRESHOLD = 800;
const FRAGMENT_THRESHOLD = 100;
const MAX_BARREL_EXPORTS = 20;
const MAX_BARREL_COUNT = 30;

// 文件下限检查排除模式
const FRAGMENT_EXCLUDE = [
  /[\\/]types\.ts$/, /[\\/]index\.ts$/, /[\\/]constants\.ts$/,
  /\.d\.ts$/, /\.test\.ts$/, /\.test\.tsx$/,
  /[\\/]__tests__[\\/]/, /[\\/]__mocks__[\\/]/,
  /[\\/]config-schema\.ts$/, /[\\/]schemas\.ts$/,
];

// JS/TS 保留字，排除被误判为"方法名"的控制流语句
const RESERVED_WORDS = new Set([
  "if", "else", "for", "while", "switch", "catch", "return",
  "case", "default", "try", "finally", "do", "with", "class",
  "new", "typeof", "instanceof", "in", "of", "var", "let", "const",
  "import", "export", "throw", "yield", "await", "async", "delete",
  "void", "this", "super", "break", "continue", "extends", "function",
  "get", "set", "static", "private", "public", "protected", "interface",
  "type", "enum", "namespace", "declare", "implements", "abstract",
]);

interface HealthReport {
  timestamp: string;
  summary: {
    totalFiles: number;
    totalLines: number;
    avgLinesPerFile: number;
    grade: "A" | "B" | "C" | "D" | "F";
    gradeBreakdown: string[];
  };
  oversized: {
    count: number;
    totalLines: number;
    registered: number;
    unregistered: number;
    files: Array<{ file: string; lines: number; registered: boolean }>;
  };
  fragments: {
    count: number;
    totalLines: number;
    files: Array<{ file: string; lines: number }>;
  };
  zombies: {
    count: number;
    files: Array<{ file: string; method: string; target: string }>;
  };
  barrels: {
    count: number;
    overflowCount: number;
    files: Array<{ file: string; exports: number }>;
  };
  trend?: {
    oversizedDelta: number;
    fragmentDelta: number;
    zombieDelta: number;
    barrelDelta: number;
    previousGrade: string;
    previousTimestamp: string;
  };
}

function readdirRecursive(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "__pycache__") {
      results.push(...readdirRecursive(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function getRelativePath(absPath: string): string {
  return relative(PROJECT_DIR, absPath);
}

function scanOversized(files: string[]): HealthReport["oversized"] {
  const result: HealthReport["oversized"] = { count: 0, totalLines: 0, registered: 0, unregistered: 0, files: [] };

  // 读取例外表获取已登记的超限文件
  let registeredFiles: Set<string> = new Set();
  try {
    const exceptionsPath = join(PROJECT_DIR, "scripts", "layer-exceptions.json");
    if (existsSync(exceptionsPath)) {
      const raw = readFileSync(exceptionsPath, "utf-8");
      const exceptions = JSON.parse(raw);
      if (exceptions.fileSizeExceptions) {
        for (const e of exceptions.fileSizeExceptions) {
          // 统一为小写正斜杠路径，消除 Windows/JSON 分隔符差异
          registeredFiles.add(e.file.replace(/\\/g, "/").toLowerCase());
        }
      }
    }
  } catch { /* 例外表读取失败不影响主流程 */ }

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n").length;
    if (lines > OVERSIZE_THRESHOLD) {
      const relPath = getRelativePath(file);
      const normalized = relPath.replace(/\\/g, "/").toLowerCase();
      const registered = registeredFiles.has(normalized) || registeredFiles.has(`app/src/${normalized.replace(/^app\/src\//, "")}`);
      result.count++;
      result.totalLines += lines;
      if (registered) result.registered++;
      else result.unregistered++;
      result.files.push({ file: relPath, lines, registered });
    }
  }
  result.files.sort((a, b) => b.lines - a.lines);
  return result;
}

function scanFragments(files: string[]): HealthReport["fragments"] {
  const result: HealthReport["fragments"] = { count: 0, totalLines: 0, files: [] };

  for (const file of files) {
    const relPath = getRelativePath(file);
    if (FRAGMENT_EXCLUDE.some(p => p.test(relPath))) continue;

    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n").length;
    if (lines < FRAGMENT_THRESHOLD) {
      result.count++;
      result.totalLines += lines;
      result.files.push({ file: relPath, lines });
    }
  }
  result.files.sort((a, b) => a.lines - b.lines);
  return result;
}

function scanZombies(files: string[]): HealthReport["zombies"] {
  const result: HealthReport["zombies"] = { count: 0, files: [] };

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const methodRegex = /(?:private|public|protected|async|\s)+(?:static\s+)?(\w+)\s*\([^)]*\)[^{]*\{/g;
    let match;
    const seen = new Set<string>(); // 同文件去重

    while ((match = methodRegex.exec(content)) !== null) {
      const methodName = match[1];
      // 过滤保留字，排除 if/for/while 等控制流语句被误判为方法
      if (RESERVED_WORDS.has(methodName)) continue;

      const bodyStart = match.index + match[0].length;
      const bodyMatch = content.slice(bodyStart);

      let depth = 1;
      let bodyEnd = 0;
      for (let i = 0; i < bodyMatch.length && depth > 0; i++) {
        if (bodyMatch[i] === "{") depth++;
        else if (bodyMatch[i] === "}") { depth--; if (depth === 0) bodyEnd = i; }
      }
      if (bodyEnd === 0) continue;

      const body = bodyMatch.slice(0, bodyEnd).trim();
      const bodyLines = body.split("\n").filter(l => l.trim() !== "");

      if (bodyLines.length === 1) {
        const singleLine = bodyLines[0].trim();
        const returnMatch = singleLine.match(/^return\s+(\w+)\(/);
        if (returnMatch && !singleLine.includes("if") && !singleLine.includes("await") && !seen.has(methodName)) {
          seen.add(methodName);
          result.count++;
          result.files.push({
            file: getRelativePath(file),
            method: methodName,
            target: returnMatch[1],
          });
        }
      }
    }
  }
  return result;
}

function scanBarrels(files: string[]): HealthReport["barrels"] {
  const result: HealthReport["barrels"] = { count: 0, overflowCount: 0, files: [] };

  for (const file of files) {
    const baseName = file.split(/[\\/]/).pop() || "";
    if (baseName !== "index.ts") continue;

    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n").filter(l => l.trim() !== "");

    const nonExportLines = lines.filter(l => {
      const t = l.trim();
      return t !== "" && !t.startsWith("//") && !t.startsWith("/*") &&
        !t.startsWith("*") && !t.startsWith("export") && !t.startsWith("}");
    });
    if (nonExportLines.length > 0) continue;

    const exportCount = lines.filter(l => l.trim().startsWith("export")).length;
    result.count++;
    result.files.push({ file: getRelativePath(file), exports: exportCount });
    if (exportCount > MAX_BARREL_EXPORTS) result.overflowCount++;
  }
  result.files.sort((a, b) => b.exports - a.exports);
  return result;
}

function computeGrade(report: HealthReport): { grade: HealthReport["summary"]["grade"]; breakdown: string[] } {
  const breakdown: string[] = [];
  const { oversized, fragments, zombies, barrels } = report;

  // 各维度评分
  let score = 0;
  const maxScore = 40;

  // 超限文件 (0-10 分)
  if (oversized.unregistered === 0 && oversized.count <= oversized.registered) {
    score += 10;
    breakdown.push("超限文件: 全部已登记 (10/10)");
  } else if (oversized.unregistered <= 1) {
    score += 7;
    breakdown.push(`超限文件: ${oversized.unregistered} 个未登记 (7/10)`);
  } else if (oversized.unregistered <= 3) {
    score += 4;
    breakdown.push(`超限文件: ${oversized.unregistered} 个未登记 (4/10)`);
  } else {
    score += 1;
    breakdown.push(`超限文件: ${oversized.unregistered} 个未登记 (1/10)`);
  }

  // 碎片文件 (0-10 分)
  if (fragments.count < 50) {
    score += 10;
    breakdown.push(`碎片文件: ${fragments.count} (10/10)`);
  } else if (fragments.count < 200) {
    score += 7;
    breakdown.push(`碎片文件: ${fragments.count} (7/10)`);
  } else if (fragments.count < 500) {
    score += 4;
    breakdown.push(`碎片文件: ${fragments.count} (4/10)`);
  } else {
    score += 1;
    breakdown.push(`碎片文件: ${fragments.count} (1/10)`);
  }

  // 僵尸方法 (0-10 分)
  if (zombies.count < 5) {
    score += 10;
    breakdown.push(`僵尸方法: ${zombies.count} (10/10)`);
  } else if (zombies.count < 50) {
    score += 7;
    breakdown.push(`僵尸方法: ${zombies.count} (7/10)`);
  } else if (zombies.count < 100) {
    score += 4;
    breakdown.push(`僵尸方法: ${zombies.count} (4/10)`);
  } else {
    score += 1;
    breakdown.push(`僵尸方法: ${zombies.count} (1/10)`);
  }

  // 桶文件 (0-10 分)
  if (barrels.overflowCount === 0 && barrels.count < MAX_BARREL_COUNT) {
    score += 10;
    breakdown.push(`桶文件: ${barrels.count} (${barrels.overflowCount} 超限) (10/10)`);
  } else if (barrels.overflowCount <= 2) {
    score += 7;
    breakdown.push(`桶文件: ${barrels.count} (${barrels.overflowCount} 超限) (7/10)`);
  } else if (barrels.overflowCount <= 5) {
    score += 4;
    breakdown.push(`桶文件: ${barrels.count} (${barrels.overflowCount} 超限) (4/10)`);
  } else {
    score += 1;
    breakdown.push(`桶文件: ${barrels.count} (${barrels.overflowCount} 超限) (1/10)`);
  }

  let grade: HealthReport["summary"]["grade"];
  if (score >= 35) grade = "A";
  else if (score >= 28) grade = "B";
  else if (score >= 18) grade = "C";
  else if (score >= 10) grade = "D";
  else grade = "F";

  breakdown.unshift(`总分: ${score}/${maxScore} → ${grade}`);

  return { grade, breakdown };
}

function loadHistory(): HealthReport | null {
  try {
    if (existsSync(HISTORY_FILE)) {
      const data: HealthReport[] = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
      // 历史文件为数组，取最近一次报告用于对比
      return data.length > 0 ? data[data.length - 1] : null;
    }
  } catch { /* ignore */ }
  return null;
}

function saveHistory(report: HealthReport): void {
  try {
    if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });

    // 保存当前报告
    writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), "utf-8");

    // 追加到历史
    let history: HealthReport[] = [];
    if (existsSync(HISTORY_FILE)) {
      history = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
    }
    history.push(report);
    // 只保留最近 20 次
    if (history.length > 20) history = history.slice(-20);
    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
  } catch (e) {
    console.error("保存历史报告失败:", e);
  }
}

function computeTrend(report: HealthReport, previous: HealthReport): HealthReport["trend"] {
  return {
    oversizedDelta: report.oversized.count - previous.oversized.count,
    fragmentDelta: report.fragments.count - previous.fragments.count,
    zombieDelta: report.zombies.count - previous.zombies.count,
    barrelDelta: report.barrels.count - previous.barrels.count,
    previousGrade: previous.summary.grade,
    previousTimestamp: previous.timestamp,
  };
}

// ============ main ============

const args = process.argv.slice(2);
const jsonOnly = args.includes("--json");
const doCompare = args.includes("--compare");

if (!existsSync(SRC_PATH)) {
  console.error("错误: 源码目录不存在:", SRC_PATH);
  process.exit(1);
}

const allFiles = readdirRecursive(SRC_PATH);
const totalLines = allFiles.reduce((sum, f) => {
  const content = readFileSync(f, "utf-8");
  return sum + content.split("\n").length;
}, 0);

const report: HealthReport = {
  timestamp: new Date().toISOString(),
  summary: {
    totalFiles: allFiles.length,
    totalLines,
    avgLinesPerFile: Math.round(totalLines / allFiles.length),
    grade: "F",
    gradeBreakdown: [],
  },
  oversized: scanOversized(allFiles),
  fragments: scanFragments(allFiles),
  zombies: scanZombies(allFiles),
  barrels: scanBarrels(allFiles),
};

const { grade, breakdown } = computeGrade(report);
report.summary.grade = grade;
report.summary.gradeBreakdown = breakdown;

const previous = loadHistory();
if (previous && doCompare) {
  report.trend = computeTrend(report, previous);
}

saveHistory(report);

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("═══════════════════════════════════════════");
  console.log("  架构健康度报告");
  console.log("═══════════════════════════════════════════");
  console.log(`  时间: ${report.timestamp}`);
  console.log(`  总文件: ${report.summary.totalFiles}  |  总行数: ${report.summary.totalLines.toLocaleString()}  |  平均行数: ${report.summary.avgLinesPerFile}`);
  console.log(`  等级: ${report.summary.grade}`);
  console.log("───────────────────────────────────────────");
  for (const b of breakdown) {
    console.log(`  ${b}`);
  }
  console.log("───────────────────────────────────────────");

  if (report.oversized.files.length > 0) {
    console.log(`\n📊 超限文件 (>${OVERSIZE_THRESHOLD} 行): ${report.oversized.count} 个`);
    for (const f of report.oversized.files.slice(0, 10)) {
      const tag = f.registered ? "📋" : "⚠️";
      console.log(`  ${tag} ${f.file} (${f.lines.toLocaleString()} 行)`);
    }
    if (report.oversized.files.length > 10) {
      console.log(`  ... 共 ${report.oversized.files.length} 个`);
    }
  }

  if (report.fragments.count > 0) {
    console.log(`\n📦 碎片文件 (<${FRAGMENT_THRESHOLD} 行): ${report.fragments.count} 个`);
    console.log(`  总行数: ${report.fragments.totalLines.toLocaleString()}`);
  }

  if (report.zombies.count > 0) {
    console.log(`\n🧟 疑似僵尸方法: ${report.zombies.count} 个`);
    for (const z of report.zombies.files.slice(0, 5)) {
      console.log(`  ${z.file} → ${z.method}() → ${z.target}()`);
    }
    if (report.zombies.files.length > 5) {
      console.log(`  ... 共 ${report.zombies.files.length} 个文件`);
    }
  }

  if (report.barrels.overflowCount > 0) {
    console.log(`\n📋 桶文件超限: ${report.barrels.overflowCount}/${report.barrels.count} 个`);
    for (const b of report.barrels.files.filter(f => f.exports > MAX_BARREL_EXPORTS).slice(0, 5)) {
      console.log(`  ${b.file} (${b.exports} exports)`);
    }
  }

  if (report.trend) {
    console.log("\n📈 趋势 (与上次对比):");
    const t = report.trend;
    const delta = (n: number) => n > 0 ? `+${n} ↑` : n < 0 ? `${n} ↓` : "0 →";
    console.log(`  超限: ${delta(t.oversizedDelta)}  |  碎片: ${delta(t.fragmentDelta)}  |  僵尸: ${delta(t.zombieDelta)}  |  桶: ${delta(t.barrelDelta)}`);
    console.log(`  上次等级: ${t.previousGrade} (${t.previousTimestamp})`);
  }

  console.log("\n═══════════════════════════════════════════");
  console.log(`报告已保存: ${REPORT_FILE}`);
  console.log(`历史已保存: ${HISTORY_FILE}`);
}

// 度量脚本不阻断 CI（门禁由 lint:arch 承担），始终退出 0
process.exit(0);