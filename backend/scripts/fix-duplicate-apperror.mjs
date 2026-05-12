/**
 * 修复 fix-multiline-apperror.mjs 添加的重复参数
 * 
 * 模式: 多行 throw new AppError 已有 ErrorCategory 参数(在后续行)，
 * 但修复脚本又追加了 , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000'
 * 
 * 修复方式: 将重复行替换为 ');' 以正确闭合 AppError
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';

const ROOT = join(import.meta.dirname, '..', 'src');

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

function fixDuplicateParams(content) {
  const lines = content.split('\n');
  let modified = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Match: `, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');`
    // or `, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000')`
    const duplicateRegex = /^, ErrorCategory\.EXECUTION, ErrorSeverity\.HIGH, '1000'\);?$/;
    
    if (duplicateRegex.test(trimmed)) {
      // Check if previous line ends with ErrorSeverity or '1000' (indicating this is a duplicate)
      if (i > 0) {
        const prevTrimmed = lines[i - 1].trimEnd();
        if (prevTrimmed.endsWith('ErrorSeverity.HIGH') || prevTrimmed.endsWith("'1000'")) {
          // Replace this line with just `);` preserving indentation
          const indent = lines[i].match(/^\s*/)[0];
          lines[i] = indent + ');';
          modified = true;
        }
      }
    }
  }

  return modified ? lines.join('\n') : null;
}

let fileCount = 0;

const tsFiles = collectTsFiles(ROOT);
for (const file of tsFiles) {
  try {
    const content = readFileSync(file, 'utf-8');
    const result = fixDuplicateParams(content);
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
