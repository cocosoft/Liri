/**
 * adm-zip 最小类型声明
 * 依赖无内置类型（main 为 CommonJS adm-zip.js），供技能导出/导入 ZIP 使用
 */
declare module 'adm-zip' {
  export default class AdmZip {
    constructor(data?: Buffer | string);
    addFile(entryName: string, content: Buffer | string): void;
    addLocalFolder(folderPath: string, zipPath?: string): void;
    toBuffer(): Buffer;
    getEntries(): Array<{
      isDirectory: boolean;
      entryName: string;
      getData(): Buffer;
    }>;
    extractAllTo(targetPath: string, overwrite?: boolean): void;
  }
}
