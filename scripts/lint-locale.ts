/**
 * 硬编码治理 · 默认 locale/timezone 冲突 + 忽略语言的格式化（方案 §8 阶段②）
 *
 * (a) **冲突检测**：找默认语言/时区定义点（`DEFAULT_LOCALE` / `DEFAULT_TIMEZONE` /
 *     `currentLanguage=` / `defaultLanguage:` / i18n `fallbackLng`），按「语言 / 时区」
 *     两桶列出取值；同一桶内出现 >1 种取值 ⇒ 上报冲突（**只报事实，不判对错**）。
 *     口径：`fallbackLng: "zh"` 属**语言码**（非 BCP-47），单独列出、**不计入冲突**。
 * (b) **忽略语言的格式化**：`toLocale*(…, "zh-CN")` / `"en-US"` 等**写死**用法上报。
 *
 * 结果：**棘轮式（只减不增）** —— 稳定键 = `<相对路径>`（写死 locale 的格式化，
 * 计数 = 该文件命中数）· `桶:<语言|时区>`（计数 = 该桶取值种数）；与基线
 * `.trae/architecture/hardcode-gate-baseline.json` 的 `lint:locale` 分节比对；
 * **新增/扩大 ⇒ `process.exit(1)`**。播种（初始化 / 下调）：
 * `HARDCODE_GATE_BASELINE_WRITE=1`；负向自证：`HARDCODE_GATE_BASELINE=<临时副本>`。
 *
 * 运行：cd app && bun run lint:locale
 */

import {
  collectFiles,
  type GateCounts,
  isCommentLine,
  matchesWhitelist,
  ratchet,
  readLines,
  report,
  toRel,
} from './lib/hardcodeScan';

/** 定义点 → 所属桶。`language` = 语言码（口径不同，单独列出） */
const DEF_PATTERNS: Array<{
  re: RegExp;
  bucket: 'locale' | 'language' | 'timezone';
}> = [
  {
    re: /export\s+const\s+DEFAULT_LOCALE\s*=\s*['"`]([^'"`]+)['"`]/,
    bucket: 'locale',
  },
  {
    re: /export\s+const\s+DEFAULT_TIMEZONE\s*=\s*['"`]([^'"`]+)['"`]/,
    bucket: 'timezone',
  },
  {
    re: /defaultLanguage\s*[:=]\s*['"`]([^'"`]+)['"`]/,
    bucket: 'locale',
  },
  {
    re: /currentLanguage\s*[:=]\s*['"`]([^'"`]+)['"`]/,
    bucket: 'locale',
  },
  {
    re: /fallbackLng\s*[:=]\s*['"`]([^'"`]+)['"`]/,
    bucket: 'language',
  },
];

/** 引用真源（非字面量）的写法，如 `currentLanguage: string = DEFAULT_LOCALE` */
const DEF_REF_RE =
  /(?:currentLanguage|defaultLanguage)\s*[:=]\s*(?:string\s*=\s*)?([A-Z_]{3,})/;

/**
 * (a) 排除测试文件（其中的 `toMatch(/… "zh-CN"/)` 会把**断言文本**误当定义点）。
 * 片段匹配（`rel.includes(frag)`）。
 */
const TEST_FRAGMENTS = ['tests/', '__tests__/', '.test.', '.spec.'];

/** 写死 locale 的格式化调用：`.toLocaleXxx(…, "zh-CN")` / `"en-US"` 等 */
const TO_LOCALE_RE =
  /\.toLocale[A-Za-z]*\s*\([^)]*?['"`]([a-z]{2}(?:-[A-Za-z]{2,4})?)['"`]/;

/**
 * (b) 白名单：真源 / 测试内允许写死 locale（其余业务代码写死即上报）。
 * 片段匹配（`rel.includes(frag)`）。
 */
const LOCALE_WHITELIST = [
  'client/src/i18n/', // i18n 配置（fallbackLng 真源）
  'client/src/constants/locale.ts', // 前端 locale 真源
  'client/src/utils/format.ts', // currentLocale() 真源
  'app/src/constants/common.ts', // 后端 locale/timezone 真源
  'tests/', // 仓库级测试目录
  '__tests__/', // 测试目录（collectFiles 已跳过，双保险）
  '.test.', // *.test.*
  '.spec.', // *.spec.*
];

interface Hit {
  file: string;
  line: number;
}

interface DefaultPoint {
  bucket: 'locale' | 'language' | 'timezone';
  value: string;
  hit: Hit;
}

function groupBy(
  points: DefaultPoint[],
  bucket: DefaultPoint['bucket']
): Map<string, Hit[]> {
  const map = new Map<string, Hit[]>();
  for (const p of points) {
    if (p.bucket !== bucket) continue;
    const list = map.get(p.value);
    if (list) list.push(p.hit);
    else map.set(p.value, [p.hit]);
  }
  return map;
}

/** 渲染一桶：`取值 ← file:line, file:line`（多取值用 ` | ` 分隔） */
function renderBucket(map: Map<string, Hit[]>): string {
  return [...map.entries()]
    .map(([value, hits]) => {
      const where = hits.map((h) => `${h.file}:${h.line}`).join(', ');
      return `${value} ← ${where}`;
    })
    .join(' | ');
}

function main(): number {
  const files = collectFiles();
  const points: DefaultPoint[] = [];
  const refLines: string[] = [];

  for (const abs of files) {
    const rel = toRel(abs);
    if (matchesWhitelist(rel, TEST_FRAGMENTS)) continue;
    const lines = readLines(abs);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      for (const p of DEF_PATTERNS) {
        const m = line.match(p.re);
        if (m) {
          points.push({
            bucket: p.bucket,
            // 正则字面量里的 `\/` 转义还原为 `/`（如 test 断言 / 正则源）
            value: m[1].replaceAll('\\/', '/'),
            hit: { file: rel, line: i + 1 },
          });
        }
      }
      const ref = line.match(DEF_REF_RE);
      if (ref && !line.includes(`'`) && !line.includes(`"`)) {
        refLines.push(`${rel}:${i + 1}  引用真源 ${ref[1]}（非字面量）`);
      }
    }
  }

  const localeMap = groupBy(points, 'locale');
  const langMap = groupBy(points, 'language');
  const tzMap = groupBy(points, 'timezone');

  const findings: string[] = [];
  const conflicts: Array<[string, Map<string, Hit[]>]> = [
    ['语言桶（locale）', localeMap],
    ['语言码桶（fallbackLng，口径不同）', langMap],
    ['时区桶', tzMap],
  ];
  for (const [label, map] of conflicts) {
    if (map.size >= 2) {
      findings.push(
        `默认${label}冲突：出现 ${map.size} 种取值 ⇒ ` + renderBucket(map)
      );
    }
  }

  const extra: string[] = [];
  extra.push(
    `[lint:locale] 语言桶（locale）：${renderBucket(localeMap) || '（未发现）'}`
  );
  extra.push(
    `[lint:locale] 语言码（fallbackLng，口径不同、不计入冲突）：` +
      `${renderBucket(langMap) || '（未发现）'}`
  );
  extra.push(`[lint:locale] 时区桶：${renderBucket(tzMap) || '（未发现）'}`);
  for (const r of refLines) extra.push(`[lint:locale] ${r}`);

  // (b) 忽略语言的格式化（写死 locale）
  const formatFindings: string[] = [];
  const formatCounts: GateCounts = {};
  for (const abs of files) {
    const rel = toRel(abs);
    if (matchesWhitelist(rel, LOCALE_WHITELIST)) continue;
    const lines = readLines(abs);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      const m = line.match(TO_LOCALE_RE);
      if (m) {
        formatFindings.push(
          `${rel}:${i + 1}  toLocale 写死 locale "${m[1]}"（应随语言切换）`
        );
        formatCounts[rel] = (formatCounts[rel] ?? 0) + 1;
      }
    }
  }

  // 棘轮稳定键：格式化的写死 locale（键 = 相对路径）+ 默认桶冲突（键 = `桶:<语言|时区>`）
  const counts: GateCounts = { ...formatCounts };
  if (localeMap.size >= 1) counts['桶:语言'] = localeMap.size;
  if (tzMap.size >= 1) counts['桶:时区'] = tzMap.size;

  report('locale', [...findings, ...formatFindings], extra);
  return ratchet('locale', counts);
}

// 退出码由 `ratchet()` 返回（见其头注）：出口落在**入口文件**里 ⇒ `lint:exit` 判据天然成立。
process.exit(main());
