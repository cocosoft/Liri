/**
 * 修复多行 throw new AppError(...) 缺少参数的问题
 * Pattern 5 替换 throw new Error( → throw new AppError(
 * 但没有添加必需的 category/severity/code 参数。
 * 本脚本找到所有多行 AppError 调用并在闭合 ) 前插入参数。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';

const ROOT = join(import.meta.dirname, '..', 'src');

const PARAMS = ", ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000'";

const EXCLUDE_DIRS = ['ink'];

function collectTsFiles(dir) {
  const result = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        if (statSync(fullPath).isDirectory()) {
          if (!EXCLUDE_DIRS.includes(entry)) {
            result.push(...collectTsFiles(fullPath));
          }
        } else if (extname(fullPath) === '.ts' && !fullPath.endsWith('.test.ts')) {
          result.push(fullPath);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return result;
}

function fixMultiLineAppError(content) {
  const lines = content.split('\n');
  let inThrow = false;
  let parenDepth = 0;
  let throwLineIdx = -1;
  let hasErrorCategory = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (!inThrow && trimmed.startsWith('throw new AppError(')) {
      inThrow = true;
      throwLineIdx = i;
      hasErrorCategory = trimmed.includes('ErrorCategory.');
      parenDepth = (trimmed.match(/\(/g) || []).length - (trimmed.match(/\)/g) || []).length;

      // Single line case: throw new AppError('msg');
      if (parenDepth <= 0) {
        if (!hasErrorCategory) {
          const lastParen = lines[i].lastIndexOf(')');
          if (lastParen >= 0) {
            lines[i] = lines[i].slice(0, lastParen) + PARAMS + lines[i].slice(lastParen);
          }
        }
        inThrow = false;
      }
      continue;
    }

    if (inThrow) {
      parenDepth += (trimmed.match(/\(/g) || []).length - (trimmed.match(/\)/g) || []).length;
      if (!hasErrorCategory && trimmed.includes('ErrorCategory.')) {
        hasErrorCategory = true;
      }

      if (parenDepth <= 0) {
        // Found the closing line
        if (!hasErrorCategory) {
          const lastParen = lines[i].lastIndexOf(')');
          if (lastParen >= 0) {
            lines[i] = lines[i].slice(0, lastParen) + PARAMS + lines[i].slice(lastParen);
          }
        }
        inThrow = false;
      }
    }
  }

  return content !== lines.join('\n') ? lines.join('\n') : null;
}

// === MAIN ===
let fixedCount = 0;
let fileCount = 0;

const tsFiles = collectTsFiles(ROOT);
for (const file of tsFiles) {
  try {
    const content = readFileSync(file, 'utf-8');
    if (!content.includes('throw new AppError(')) continue;

    const result = fixMultiLineAppError(content);
    if (result !== null) {
      writeFileSync(file, result, 'utf-8');
      fileCount++;
      console.log(`✅ ${file.replace(ROOT + '\\', '')}`);
    }
  } catch (err) {
    console.error(`❌ ${file}: ${err.message}`);
  }
}

console.log(`\n结果: ${fileCount} 文件已修复`);
