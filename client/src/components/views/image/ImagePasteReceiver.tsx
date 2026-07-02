/**
 * ImagePasteReceiver — 剪贴板图片粘贴接收区
 *
 * 监听 Ctrl+V / Cmd+V 粘贴事件，检测剪贴板中的图片并自动上传。
 * 与 clipboardService.ts + ImageUploadDrop 配合使用。
 */
import { useEffect, useCallback } from 'react';
import { readImageFromClipboard } from '../../../services/clipboardService';

interface ImagePasteReceiverProps {
  /** 粘贴成功回调 */
  onPaste: (base64: string, mimeType: string) => void;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

export function ImagePasteReceiver({
  onPaste,
  enabled = true,
}: ImagePasteReceiverProps) {
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (!enabled) return;

    // 优先处理剪贴板中已有的图片（来自 screenshot 等）
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = () => {
              const base64 = (reader.result as string).split(',')[1];
              onPaste(base64, item.type);
            };
            reader.readAsDataURL(blob);
            e.preventDefault();
            return;
          }
        }
      }
    }

    // 回退：通过系统剪贴板读取（跨应用截图场景）
    const result = await readImageFromClipboard();
    if (result) {
      onPaste(result.base64, result.mimeType);
      e.preventDefault();
    }
  }, [enabled, onPaste]);

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  // 无 UI，纯功能组件
  return null;
}
