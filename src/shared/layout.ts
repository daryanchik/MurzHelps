import type { OverlayLayout, Rect, Size } from './types';

/** Fit the original orientation. Never stretch, crop, or rotate the photograph. */
function calculateBaseLayout(area: Rect, image: Size): OverlayLayout {
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

export function calculateLayout(area: Rect, image: Size, withInfo = false): OverlayLayout {
  const base = calculateBaseLayout(area, image);
  if (!withInfo) return base;
  // Compare side-by-side and stacked layouts, choosing the largest uncropped cat.
  // Two DIP inside the window reserve room for the silhouette outline.
  const padding = 2, margin = 8, gap = 12;
  const width = Math.floor(area.width - margin * 2), height = Math.floor(area.height - margin * 2);
  const panelHeight = Math.min(296, height);
  const sideWidth = Math.min(288, Math.max(184, Math.floor(width * 0.28)));
  const topWidth = Math.min(320, width - padding * 2);
  const topHeight = Math.min(296, Math.max(164, Math.floor(height * 0.38)));
  const sideScale = Math.min((width - sideWidth - gap - padding * 2) / image.width,
    (height - padding * 2) / image.height);
  const topScale = Math.min((width - padding * 2) / image.width,
    (height - topHeight - gap - padding * 2) / image.height);
  const side = sideScale >= topScale;
  const scale = Math.max(1 / Math.max(image.width, image.height), side ? sideScale : topScale);
  const catWidth = Math.max(1, Math.floor(image.width * scale));
  const catHeight = Math.max(1, Math.floor(image.height * scale));
  const panelWidth = side ? sideWidth : topWidth;
  const cardHeight = side ? panelHeight : topHeight;
  const windowWidth = side ? catWidth + panelWidth + gap + padding * 2 : Math.max(catWidth, panelWidth) + padding * 2;
  const windowHeight = side ? Math.max(catHeight + padding * 2, cardHeight) : catHeight + cardHeight + gap + padding * 2;
  const info = {
    x: side ? catWidth + gap + padding * 2 : Math.floor((windowWidth - panelWidth) / 2),
    y: side ? Math.floor((windowHeight - cardHeight) / 2) : 0,
    width: panelWidth, height: cardHeight,
  };
  const buttonHeight = cardHeight < 220 ? 30 : 36;
  const inset = 12;
  return {
    window: {
      x: Math.round(area.x + (area.width - windowWidth) / 2),
      y: Math.round(area.y + (area.height - windowHeight) / 2),
      width: windowWidth, height: windowHeight,
    },
    cat: {
      x: side ? padding : Math.floor((windowWidth - catWidth) / 2),
      y: side ? Math.floor((windowHeight - catHeight) / 2) : cardHeight + gap + padding,
      width: catWidth, height: catHeight,
    },
    button: { x: info.x + inset, y: info.y + cardHeight - inset - buttonHeight * 2 - 6,
      width: panelWidth - inset * 2, height: buttonHeight },
    snooze: { x: info.x + inset, y: info.y + cardHeight - inset - buttonHeight,
      width: panelWidth - inset * 2, height: buttonHeight },
    info, infoRadius: 14, buttonRadius: 8,
  };
}
