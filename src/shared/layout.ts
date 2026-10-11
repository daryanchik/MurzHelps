import type { OverlayLayout, Rect, Size } from './types';

/** Fit the original orientation. Never stretch, crop, or rotate the photograph. */
export function calculateLayout(area: Rect, image: Size): OverlayLayout {
  if (![area.x, area.y, area.width, area.height, image.width, image.height].every(Number.isFinite)
      || area.width < 240 || area.height < 200 || image.width <= 0 || image.height <= 0) {
    throw new Error('Invalid screen or image dimensions');
  }

  const margin = 16;
  const buttonHeight = 44;
  const buttonWidth = 188;
  const gap = 12;
  const centerY = Math.round(area.height * 0.54);
  // The button sits ABOVE the image: no pixels of Murz are obscured by UI.
  const maxHeight = Math.min(
    2 * (centerY - margin - buttonHeight - gap),
    2 * (area.height - margin - centerY),
  );
  const scale = Math.min(area.width * 0.76 / image.width, maxHeight / image.height);
  const catWidth = Math.max(1, Math.round(image.width * scale));
  const catHeight = Math.max(1, Math.round(image.height * scale));
  const windowWidth = Math.max(catWidth, buttonWidth);
  const catTop = buttonHeight + gap;
  const windowHeight = catHeight + catTop;
  return {
    window: {
      x: Math.round(area.x + (area.width - windowWidth) / 2),
      y: Math.round(area.y + centerY - catHeight / 2 - catTop),
      width: windowWidth,
      height: windowHeight,
    },
    cat: { x: Math.floor((windowWidth - catWidth) / 2), y: catTop, width: catWidth, height: catHeight },
    button: { x: Math.floor((windowWidth - buttonWidth) / 2), y: 0, width: buttonWidth, height: buttonHeight },
    buttonRadius: 22,
  };
}
