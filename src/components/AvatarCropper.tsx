'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 头像裁剪器（v0.0.5）
 *
 * ## 为什么在前端裁剪
 *
 * 任务书要求「前端头像裁剪 + 缩放 + 预览」。前端裁剪的价值不只是体验：
 *
 *  1. **用户能看到结果** —— 选错区域能立刻重来，而不是「上传后才发现裁歪了」
 *  2. **减少上行流量** —— 裁剪后的图通常只有原图的 1/10
 *  3. **服务端不必信任客户端** —— 服务端仍然会再裁一次（见 `src/lib/avatar.ts`）
 *
 * ## 为什么用原生 Canvas 而不是引入裁剪库
 *
 * 引入 `react-image-crop` 之类的库会：
 *  - 增加一个前端依赖（供应链面）
 *  - 引入 React 18/19 兼容性的不确定性
 *
 * 本项目只需要「正方形 + 缩放 + 拖动」这一个最简交互 ——
 * 用 Canvas 直接实现，**零依赖**，行为完全可控。
 *
 * ## 交互
 *
 *  - 拖动图片调整取景位置
 *  - 滚轮 / 滑块缩放
 *  - 实时预览裁剪结果（正方形，跟随鼠标）
 *  - 「重置」回到初始状态
 *
 * ## 兼容性
 *
 * - `canvas.toBlob` 在所有目标浏览器可用
 * - EXIF 方向：浏览器 `createImageBitmap` 已按 EXIF 自动旋转（现代浏览器）
 *   —— 服务端还会再校正一次（sharp 的 `rotate()`），双保险
 */

export type CropperState = {
  /** 图片的自然宽度 */
  naturalWidth: number;
  /** 图片的自然高度 */
  naturalHeight: number;
  /** 当前缩放倍率 */
  scale: number;
  /** 图片左上角在画布坐标系里的偏移 */
  offsetX: number;
  offsetY: number;
  /** 取景框边长（画布坐标系） */
  cropSize: number;
  /** 画布边长（正方形） */
  canvasSize: number;
};

type Props = {
  /** 选中的文件 */
  file: File | null;
  /** 裁剪完成回调（输出 Blob） */
  onCrop: (blob: Blob) => void;
  /** 取消回调 */
  onCancel: () => void;
  /** 输出边长（与服务端 AVATAR_SIZE 对齐） */
  outputSize?: number;
  /** 错误提示 */
  onError?: (message: string) => void;
};

/** 初始缩放：让图片刚好填满取景框（cover 语义） */
function initialScale(
  naturalWidth: number,
  naturalHeight: number,
  cropSize: number,
): number {
  if (naturalWidth === 0 || naturalHeight === 0) return 1;
  return Math.max(cropSize / naturalWidth, cropSize / naturalHeight);
}

export default function AvatarCropper({
  file,
  onCrop,
  onCancel,
  outputSize = 256,
  onError,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [state, setState] = useState<CropperState | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // 画布边长（正方形，CSS 像素）
  const CANVAS_SIZE = 320;

  // ⚠️ `onError` 是**父组件每次渲染都会新建**的函数
  // （SettingsForm 里是内联箭头函数）——
  // 若把它放进 `useEffect` 的依赖数组，effect 会**无限重跑**：
  //   effect → setState → 父组件重渲染 → onError 是新引用 → effect 再跑 → …
  // 表现为页面卡死 / React 崩溃 ⇒ Playwright 报
  // 「Target page, context or browser has been closed」。
  //
  // 修法：用 ref 持有最新的 onError，effect 只依赖 `file`。
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // ── 加载图片 ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!file) {
      setState(null);
      imgRef.current = null;
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const cropSize = CANVAS_SIZE;
      const scale = initialScale(img.naturalWidth, img.naturalHeight, cropSize);
      // 居中
      const offsetX = (cropSize - img.naturalWidth * scale) / 2;
      const offsetY = (cropSize - img.naturalHeight * scale) / 2;
      imgRef.current = img;
      setState({
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        scale,
        offsetX,
        offsetY,
        cropSize,
        canvasSize: CANVAS_SIZE,
      });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      onErrorRef.current?.('无法读取该图片文件，请换一张试试');
    };
    img.src = url;

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // ── 绘制 ────────────────────────────────────────────────────────────
  const draw = useCallback((s: CropperState) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== s.canvasSize * dpr) {
      canvas.width = s.canvasSize * dpr;
      canvas.height = s.canvasSize * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s.canvasSize, s.canvasSize);

    // 棋盘格底（透明区域可见）
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, s.canvasSize, s.canvasSize);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      s.offsetX,
      s.offsetY,
      s.naturalWidth * s.scale,
      s.naturalHeight * s.scale,
    );

    // 取景框边框
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, s.cropSize, s.cropSize);
  }, []);

  useEffect(() => {
    if (state) draw(state);
  }, [state, draw]);

  // ── 拖动 ────────────────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!state) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragOrigin({ x: state.offsetX, y: state.offsetY });
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!state || !dragStart || !dragOrigin) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;

    const w = state.naturalWidth * state.scale;
    const h = state.naturalHeight * state.scale;

    // ⚠️ 允许图片边缘超出取景框（cover 语义），
    //    但**不能**把图片拖到取景框外 —— 那样会出现空白区。
    let offsetX = dragOrigin.x + dx;
    let offsetY = dragOrigin.y + dy;
    offsetX = Math.min(0, Math.max(state.cropSize - w, offsetX));
    offsetY = Math.min(0, Math.max(state.cropSize - h, offsetY));

    setState({ ...state, offsetX, offsetY });
  }

  function onPointerUp() {
    setDragStart(null);
    setDragOrigin(null);
  }

  // ── 缩放 ────────────────────────────────────────────────────────────
  function zoomBy(factor: number) {
    if (!state) return;
    const nextScale = Math.min(4, Math.max(0.2, state.scale * factor));
    // 以画布中心为锚点缩放
    const cx = state.cropSize / 2;
    const cy = state.cropSize / 2;
    const ratio = nextScale / state.scale;
    const w = state.naturalWidth * nextScale;
    const h = state.naturalHeight * nextScale;

    let offsetX = state.offsetX - (cx - state.offsetX) * (ratio - 1);
    let offsetY = state.offsetY - (cy - state.offsetY) * (ratio - 1);
    offsetX = Math.min(0, Math.max(state.cropSize - w, offsetX));
    offsetY = Math.min(0, Math.max(state.cropSize - h, offsetY));

    setState({ ...state, scale: nextScale, offsetX, offsetY });
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08);
  }

  function reset() {
    if (!state) return;
    const scale = initialScale(state.naturalWidth, state.naturalHeight, state.cropSize);
    setState({
      ...state,
      scale,
      offsetX: (state.cropSize - state.naturalWidth * scale) / 2,
      offsetY: (state.cropSize - state.naturalHeight * scale) / 2,
    });
  }

  // ── 输出 ────────────────────────────────────────────────────────────
  function exportCrop() {
    if (!state || !imgRef.current) return;
    setBusy(true);

    try {
      const out = document.createElement('canvas');
      out.width = outputSize;
      out.height = outputSize;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('无法创建画布');

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // 取景框在原图坐标系里的位置与尺寸
      const srcX = -state.offsetX / state.scale;
      const srcY = -state.offsetY / state.scale;
      const srcSize = state.cropSize / state.scale;

      ctx.drawImage(
        imgRef.current,
        srcX,
        srcY,
        srcSize,
        srcSize,
        0,
        0,
        outputSize,
        outputSize,
      );

      out.toBlob(
        (blob) => {
          setBusy(false);
          if (!blob) {
            onError?.('裁剪失败，请重试');
            return;
          }
          onCrop(blob);
        },
        'image/png',
        0.92,
      );
    } catch {
      setBusy(false);
      onError?.('裁剪失败，请重试');
    }
  }

  if (!file) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      role="dialog"
      aria-label="裁剪头像"
    >
      <div
        className="cell"
        style={{
          background: '#fff',
          padding: 16,
          borderRadius: 4,
          maxWidth: '92vw',
          maxHeight: '92vh',
          overflow: 'auto',
        }}
      >
        <strong>裁剪头像</strong>
        <div className="sep10" />

        {state ? (
          <>
            <canvas
              ref={canvasRef}
              width={state.canvasSize}
              height={state.canvasSize}
              style={{
                width: state.canvasSize,
                height: state.canvasSize,
                maxWidth: '86vw',
                touchAction: 'none',
                cursor: dragStart ? 'grabbing' : 'grab',
                borderRadius: 4,
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
              aria-label="头像取景框，可拖动调整位置"
              data-testid="avatar-cropper-canvas"
            />
            <div className="sep10" />

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="button"
                onClick={() => zoomBy(1 / 1.15)}
                aria-label="缩小头像"
              >
                －
              </button>
              <input
                type="range"
                min={10}
                max={400}
                value={Math.round(state.scale * 100)}
                onChange={(e) => {
                  const next = Number(e.target.value) / 100;
                  if (!state) return;
                  const cx = state.cropSize / 2;
                  const cy = state.cropSize / 2;
                  const ratio = next / state.scale;
                  const w = state.naturalWidth * next;
                  const h = state.naturalHeight * next;
                  let offsetX = state.offsetX - (cx - state.offsetX) * (ratio - 1);
                  let offsetY = state.offsetY - (cy - state.offsetY) * (ratio - 1);
                  offsetX = Math.min(0, Math.max(state.cropSize - w, offsetX));
                  offsetY = Math.min(0, Math.max(state.cropSize - h, offsetY));
                  setState({ ...state, scale: next, offsetX, offsetY });
                }}
                style={{ flex: 1 }}
                aria-label="头像缩放"
                data-testid="avatar-cropper-zoom"
              />
              <button
                type="button"
                className="button"
                onClick={() => zoomBy(1.15)}
                aria-label="放大头像"
              >
                ＋
              </button>
              <button
                type="button"
                className="button"
                onClick={reset}
                aria-label="重置裁剪"
              >
                重置
              </button>
            </div>
            <div className="sep10" />

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="button"
                onClick={onCancel}
                aria-label="取消裁剪"
              >
                取消
              </button>
              <button
                type="button"
                className="button"
                onClick={exportCrop}
                disabled={busy}
                aria-label="确认裁剪"
                data-testid="avatar-cropper-confirm"
              >
                {busy ? '处理中…' : '确定'}
              </button>
            </div>
          </>
        ) : (
          <div className="sep10" style={{ padding: '20px 0' }}>
            <span className="fade">正在加载图片…</span>
          </div>
        )}
      </div>
    </div>
  );
}
