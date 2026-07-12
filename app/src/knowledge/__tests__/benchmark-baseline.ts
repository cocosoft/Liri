/**
 * 知识库性能基准测试脚本
 *
 * 使用方法: bun run src/knowledge/__tests__/benchmark-baseline.ts
 * 输出: dev_docs/20260712/benchmark-baseline.json
 */
/* eslint-disable no-console */
import { KnowledgeRouter } from '../KnowledgeRouter';
import type { FileDocsProvider } from '@modules/docs/FileDocsProvider';
import type { FileDocEntry } from '@modules/docs/FileDocsProvider';

/** 测试查询词集（中英文混合） */
const TEST_QUERIES = [
  'Python 编程语言',
  'TypeScript 类型系统',
  '植物学 基础',
  '数据库 设计 架构',
  'API 接口 文档',
];

/** 生成模拟文档数据 */
function generateDocs(count: number): FileDocEntry[] {
  const categories = ['编程', '科学', '项目', '设计', '运维'];
  const topics = [
    'Python基础',
    'TypeScript高级',
    'JavaScript入门',
    'Rust系统编程',
    'Go并发',
    'Java设计模式',
    'C++性能优化',
    'React组件',
    'Vue框架',
    'Node.js后端',
    'Docker容器',
    'Kubernetes编排',
    '数据库索引',
    'SQL优化',
    'Redis缓存',
    '消息队列',
    '微服务架构',
    'API设计',
    '测试驱动',
    '持续集成',
    '机器学习',
    '深度学习',
    '自然语言',
    '计算机视觉',
    '植物学',
    '分子生物',
    '量子物理',
    '相对论',
    '区块链',
    '密码学',
    '分布式系统',
    '云计算',
  ];

  const docs: FileDocEntry[] = [];
  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length]!;
    const variant = Math.floor(i / topics.length);
    const title = variant > 0 ? `${topic} (${variant + 1})` : topic;
    const category = categories[i % categories.length]!;

    // 生成 500-2000 字的内容
    const paragraphCount = 2 + (i % 4);
    const paragraphs: string[] = [];
    for (let p = 0; p < paragraphCount; p++) {
      const wordCount = 50 + ((i * 7 + p * 13) % 100);
      const words: string[] = [];
      for (let w = 0; w < wordCount; w++) {
        words.push(`${topic}${w}${p}`);
      }
      paragraphs.push(words.join(' '));
    }

    docs.push({
      relativePath: `docs/${title.replace(/\s+/g, '_')}.md`,
      title,
      content: `# ${title}\n\n${paragraphs.join('\n\n')}\n`,
      category,
      fileName: `${title.replace(/\s+/g, '_')}.md`,
    });
  }
  return docs;
}

class StaticDocsProvider implements FileDocsProvider {
  constructor(private entries: FileDocEntry[]) {}
  async buildIndex(): Promise<FileDocEntry[]> {
    return this.entries;
  }
  async loadDoc(dp: string): Promise<FileDocEntry | null> {
    return this.entries.find((e) => e.relativePath === dp) || null;
  }
  async search(): Promise<FileDocEntry[]> {
    return this.entries;
  }
  async getDocsByCategory(): Promise<FileDocEntry[]> {
    return [];
  }
  getDocsRoots(): string[] {
    return ['/benchmark'];
  }
  async clearCache(): Promise<void> {}
}

/** 中位数 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

async function runBaseline(docCount: number): Promise<Record<string, unknown>> {
  console.log(`\n=== 准备 ${docCount} 篇测试文档 ===`);
  const docs = generateDocs(docCount);
  const provider = new StaticDocsProvider(docs);
  const router = new KnowledgeRouter(provider);

  // 1. buildIndex
  console.log('  buildIndex...');
  const buildTimes: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    await router.buildIndex();
    buildTimes.push(performance.now() - t);
  }

  // 2. 关键词搜索（5 轮 × 5 查询取中位数）
  console.log('  keywordSearch...');
  const keywordTimes: number[] = [];
  for (const query of TEST_QUERIES) {
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      await router.search(query, { maxResults: 10 });
      keywordTimes.push(performance.now() - t);
    }
  }

  // 3. findByTitle（精确查找）
  console.log('  findByTitle...');
  const findTimes: number[] = [];
  const sampleTitles = docs.slice(0, 10).map((d) => d.title);
  for (const title of sampleTitles) {
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      router.findByTitle(title);
      findTimes.push(performance.now() - t);
    }
  }

  // 4. removeFromIndex（删除性能）
  console.log('  removeFromIndex...');
  const removeTimes: number[] = [];
  const samplePaths = docs.slice(0, 10).map((d) => d.relativePath);
  for (const path of samplePaths) {
    const t = performance.now();
    router.removeFromIndex(path);
    removeTimes.push(performance.now() - t);
  }

  return {
    docCount,
    buildIndexMs: {
      median: Math.round(median(buildTimes) * 100) / 100,
      min: Math.round(Math.min(...buildTimes) * 100) / 100,
      max: Math.round(Math.max(...buildTimes) * 100) / 100,
    },
    keywordSearchMs: {
      median: Math.round(median(keywordTimes) * 100) / 100,
      avg:
        Math.round(
          (keywordTimes.reduce((a, b) => a + b, 0) / keywordTimes.length) * 100
        ) / 100,
    },
    findByTitleMs: {
      median: Math.round(median(findTimes) * 100) / 100,
      max: Math.round(Math.max(...findTimes) * 100) / 100,
    },
    removeFromIndexMs: {
      median: Math.round(median(removeTimes) * 100) / 100,
      avg:
        Math.round(
          (removeTimes.reduce((a, b) => a + b, 0) / removeTimes.length) * 100
        ) / 100,
    },
  };
}

async function main() {
  console.log('知识库性能基准测试');
  console.log('='.repeat(50));

  const results: Record<string, unknown>[] = [];

  for (const size of [50, 100, 500]) {
    const result = await runBaseline(size);
    results.push(result);
    console.log(`  结果: ${JSON.stringify(result, null, 2)}`);
  }

  const report = {
    timestamp: new Date().toISOString(),
    version: 'v2.1-post-optimization',
    results,
  };

  console.log('\n' + '='.repeat(50));
  console.log('基准测试报告:');
  console.log(JSON.stringify(report, null, 2));

  // 尝试写入文件（可能因路径权限失败，不影响控制台输出）
  try {
    const { writeFile, mkdir } = await import('fs/promises');
    const { join } = await import('path');
    const reportDir = join(process.cwd(), '..', 'dev_docs', '20260712');
    await mkdir(reportDir, { recursive: true });
    await writeFile(
      join(reportDir, 'benchmark-baseline.json'),
      JSON.stringify(report, null, 2),
      'utf-8'
    );
    console.log(
      `\n报告已保存至: ${join(reportDir, 'benchmark-baseline.json')}`
    );
  } catch (err) {
    console.log(`\n报告保存失败: ${err}`);
  }
}

main().catch(console.error);
