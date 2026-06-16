import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_DIR = 'E:\\PY\\CODES\\PY_APP\\app\\src';

// File patterns to exclude (node_modules, .d.ts, etc.)
function isTargetFile(filePath) {
  if (filePath.endsWith('.d.ts')) return false;
  if (filePath.includes('node_modules')) return false;
  return filePath.endsWith('.ts');
}

function getAllFiles(dir) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip common generated dirs
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      results.push(...getAllFiles(fullPath));
    } else if (isTargetFile(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

console.log('Scanning all .ts files in app/src...\n');

const files = getAllFiles(SRC_DIR);

let totalFiles = 0;
let totalCatchBlocks = 0;
let emptyMultiLine = 0;
let emptyInline = 0;
let loggerErrorPattern = 0;
let consoleErrorPattern = 0;
let commentOnly = 0;
let properCatch = 0;

const emptyCatchFiles = [];
const loggerErrorFiles = [];
const consoleErrorFiles = [];

for (const file of files) {
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  let fileEmptyMulti = 0;
  let fileEmptyInline = 0;
  let fileLoggerError = 0;
  let fileConsoleError = 0;
  let fileCommentOnly = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect catch lines
    const catchFooter = line.match(/^\s*\}\s*catch\s*(\([^)]*\))?\s*\{\s*$/);
    const catchNoParen = line.match(/^\s*\}\s*catch\s*\{\s*$/);
    const inlineCatch = line.match(/^\s*\}\s*catch\s*(\([^)]*\))?\s*\{\s*\}(\s*)$/);

    if (inlineCatch) {
      // Inline empty catch: } catch { } or } catch (err) { }
      emptyInline++;
      fileEmptyInline++;
      continue;
    }

    if (catchFooter || catchNoParen) {
      // Multi-line catch - check body
      let j = i + 1;
      let bodyLines = [];
      while (j < lines.length && lines[j].trim() !== '}') {
        if (lines[j].trim()) bodyLines.push(lines[j]);
        j++;
      }

      const hasCode = bodyLines.some(l => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*');
      });
      const hasComment = bodyLines.some(l => {
        const t = l.trim();
        return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
      });

      if (!hasCode && !hasComment) {
        emptyMultiLine++;
        fileEmptyMulti++;
      } else if (!hasCode && hasComment) {
        commentOnly++;
        fileCommentOnly++;
      } else {
        properCatch++;
      }
    }

    // Check for logger.error pattern in catch blocks
    // Look for lines like: } catch (error) { ... logger.error(...) ... }
    // Simpler approach: check if this line has a catch and next lines contain logger.error
    if (line.match(/catch\s*(\([^)]*\))?\s*\{/) && !line.match(/catch\s*(\([^)]*\))?\s*\{\s*\}/)) {
      // Find the catch body content
      let j = i;
      let depth = 0;
      let foundCatchOpen = false;
      let bodyContent = [];

      for (let k = j; k < Math.min(j + 30, lines.length); k++) {
        const cl = lines[k];
        for (const ch of cl) {
          if (ch === '{') depth++;
          if (ch === '}') depth--;
        }
        if (foundCatchOpen) bodyContent.push(cl);
        if (cl.includes('catch') && cl.includes('{')) foundCatchOpen = true;
        if (foundCatchOpen && depth === 0) break;
      }

      const bodyStr = bodyContent.join(' ');
      if (bodyStr.includes('logger.error')) {
        loggerErrorPattern++;
        fileLoggerError++;
      }
      if (bodyStr.includes('console.error')) {
        consoleErrorPattern++;
        fileConsoleError++;
      }
    }
  }

  if (fileEmptyMulti > 0 || fileEmptyInline > 0) {
    emptyCatchFiles.push({
      file: relative(SRC_DIR, file),
      empty: fileEmptyMulti,
      inline: fileEmptyInline,
      logger: fileLoggerError,
    });
  }
  if (fileLoggerError > 0) {
    loggerErrorFiles.push({
      file: relative(SRC_DIR, file),
      count: fileLoggerError,
    });
  }
  if (fileConsoleError > 0) {
    consoleErrorFiles.push({
      file: relative(SRC_DIR, file),
      count: fileConsoleError,
    });
  }

  totalCatchBlocks++;
}

console.log('=== 当前应用中 catch 块分析 ===\n');

console.log(`总计扫描文件: ${files.length}`);
console.log(`总计包含 catch 块的文件: ~${totalFiles}`);
console.log(`总计 catch 块: ~${totalCatchBlocks}\n`);

console.log('--- 需要关注的 catch 类型 ---');
console.log(`1. 多行空 catch (需修复):       ${emptyMultiLine}`);
console.log(`2. 内联空 catch (需修复):        ${emptyInline}`);
console.log(`3. 仅注释的 catch (保持现状):    ${commentOnly}`);
console.log(`4. 含 logger.error 的 catch:     ${loggerErrorPattern}`);
console.log(`5. 含 console.error 的 catch:    ${consoleErrorPattern}`);
console.log(`6. 已有正常处理代码的 catch:     ${properCatch}`);
console.log('');

if (emptyCatchFiles.length > 0) {
  console.log('--- 包含空 catch 的文件 ---');
  for (const f of emptyCatchFiles) {
    console.log(`  ${f.file}  (多行空: ${f.empty}, 内联空: ${f.inline})`);
  }
}

if (loggerErrorFiles.length > 0) {
  console.log('\n--- 仍使用 logger.error 的 catch 文件 (前20) ---');
  for (const f of loggerErrorFiles.slice(0, 20)) {
    console.log(`  ${f.file}  (${f.count} 处)`);
  }
  if (loggerErrorFiles.length > 20) {
    console.log(`  ... 还有 ${loggerErrorFiles.length - 20} 个文件`);
  }
  console.log(`\n  共计 ${loggerErrorFiles.length} 个文件含 logger.error 的 catch`);
}

if (consoleErrorFiles.length > 0) {
  console.log('\n--- 使用 console.error 的 catch 文件 ---');
  for (const f of consoleErrorFiles) {
    console.log(`  ${f.file}  (${f.count} 处)`);
  }
}
