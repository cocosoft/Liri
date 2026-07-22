// canvas-editor/utils/clipBoard.ts — 应用级剪贴板（存储 ImageData）

/** 剪贴板内容（应用内，非系统剪贴板） */
let clipData: ImageData | null = null;

export const clipBoard = {
  /** 存入剪贴板 */
  set(data: ImageData) {
    clipData = data;
  },
  /** 取出剪贴板 */
  get(): ImageData | null {
    return clipData;
  },
  /** 是否有内容 */
  has(): boolean {
    return clipData !== null;
  },
  /** 清空 */
  clear() {
    clipData = null;
  },
};
