import type { OverlayLayout, Point, Rect } from './types';

export interface AlphaRaster { width: number; height: number; alpha: Uint8Array }
export interface InputMask { width: number; height: number; pixels: Uint8Array }
export const ALPHA_THRESHOLD = 1;

export function extractAlpha(bitmap: Uint8Array, width: number, height: number): AlphaRaster {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
      || bitmap.length !== width * height * 4) throw new Error('Invalid RGBA/BGRA bitmap');
  const alpha = new Uint8Array(width * height);
  // Electron nativeImage.toBitmap() is BGRA; alpha is still the fourth byte.
  for (let i = 0; i < alpha.length; i++) alpha[i] = bitmap[i * 4 + 3];
  return { width, height, alpha };
}

export function contains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.y >= rect.y
    && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

export function roundedContains(rect: Rect, radius: number, point: Point): boolean {
  if (!contains(rect, point)) return false;
  const r = Math.min(radius, rect.width / 2, rect.height / 2);
  const cx = Math.max(rect.x + r, Math.min(point.x, rect.x + rect.width - r));
  const cy = Math.max(rect.y + r, Math.min(point.y, rect.y + rect.height - r));
  return (point.x - cx) ** 2 + (point.y - cy) ** 2 <= r ** 2;
}

/** Samples alpha at pixel centers, with bilinear interpolation for scaled images. */
function sampleAlpha(source: AlphaRaster, x: number, y: number): number {
  x = Math.max(0, Math.min(source.width - 1, x));
  y = Math.max(0, Math.min(source.height - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, source.width - 1), y1 = Math.min(y0 + 1, source.height - 1);
  const dx = x - x0, dy = y - y0;
  const top = source.alpha[y0 * source.width + x0] * (1 - dx) + source.alpha[y0 * source.width + x1] * dx;
  const bottom = source.alpha[y1 * source.width + x0] * (1 - dx) + source.alpha[y1 * source.width + x1] * dx;
  return top * (1 - dy) + bottom * dy;
}

export function makeInputMask(source: AlphaRaster, layout: OverlayLayout): InputMask {
  const { width, height } = layout.window;
  const pixels = new Uint8Array(width * height);
  const cat = layout.cat;
  for (let y = 0; y < cat.height; y++) {
    for (let x = 0; x < cat.width; x++) {
      const alpha = sampleAlpha(source,
        (x + 0.5) * source.width / cat.width - 0.5,
        (y + 0.5) * source.height / cat.height - 0.5);
      if (alpha >= ALPHA_THRESHOLD) pixels[(cat.y + y) * width + cat.x + x] = 1;
    }
  }
  if (layout.outline) {
    const original = pixels.slice();
    const radius = Math.min(2, Math.max(0, Math.ceil(layout.outline)));
    for (let y = Math.max(0, cat.y - radius); y < Math.min(height, cat.y + cat.height + radius); y++) {
      for (let x = Math.max(0, cat.x - radius); x < Math.min(width, cat.x + cat.width + radius); x++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const sx = x + dx, sy = y + dy;
            if (sx >= 0 && sy >= 0 && sx < width && sy < height && original[sy * width + sx]) {
              pixels[y * width + x] = 1;
            }
          }
        }
      }
    }
  }
  const controls: [Rect | undefined, number][] = [
    [layout.button, layout.buttonRadius], [layout.snooze, layout.buttonRadius], [layout.info, layout.infoRadius ?? 0],
  ];
  for (const [rect, radius] of controls) {
    if (!rect) continue;
    for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.height); y++) {
      for (let x = Math.max(0, rect.x); x < Math.min(width, rect.x + rect.width); x++) {
        if (roundedContains(rect, radius, { x: x + 0.5, y: y + 0.5 })) pixels[y * width + x] = 1;
      }
    }
  }
  return { width, height, pixels };
}

/** screen.getCursorScreenPoint() and BrowserWindow bounds both use DIP. */
export function hitScreenPoint(mask: InputMask, bounds: Rect, point: Point): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const x = Math.floor(point.x - bounds.x), y = Math.floor(point.y - bounds.y);
  return x >= 0 && y >= 0 && x < mask.width && y < mask.height
    && mask.pixels[y * mask.width + x] === 1;
}

/** Lossless scanline union for native Windows input regions, including holes. */
export function maskToRectangles(mask: InputMask, maximum = Infinity): Rect[] {
  const result: Rect[] = [];
  let previous = new Map<string, Rect>();
  for (let y = 0; y < mask.height; y++) {
    const current = new Map<string, Rect>();
    for (let x = 0; x < mask.width;) {
      if (!mask.pixels[y * mask.width + x]) { x++; continue; }
      const start = x;
      while (x < mask.width && mask.pixels[y * mask.width + x]) x++;
      const width = x - start, key = `${start}:${width}`;
      const existing = previous.get(key);
      const rect = existing ?? { x: start, y, width, height: 0 };
      rect.height++;
      if (!existing) {
        if (result.length >= maximum) throw new RangeError('Native shape rectangle limit exceeded');
        result.push(rect);
      }
      current.set(key, rect);
    }
    previous = current;
  }
  return result;
}
