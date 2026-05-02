/**
 * 文件系统操作模块
 * 提供统一的文件系统操作接口
 */

import {
  mkdir,
  writeFile,
  readFile,
  unlink,
  readdir,
  rename,
  stat,
  open,
} from 'fs/promises';

import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'fs';

/**
 * 获取文件系统操作对象
 */
export function getFsImplementation() {
  return {
    mkdir,
    writeFile,
    readFile,
    unlink,
    readdir,
    rename,
    stat,
    open,
    existsSync,
    readFileSync,
    writeFileSync,
  };
}
