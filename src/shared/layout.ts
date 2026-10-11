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
  const margin = 16, gap = 12;
  const catRight = base.window.x + base.cat.x + base.cat.width;
  const sideWidth = Math.min(280, Math.floor(area.x + area.width - margin - catRight - gap));
  if (sideWidth >= 220) {
    // Preserve the v0.1 cat and button in exactly the same screen coordinates.
    const height = 128;
    const top = Math.max(area.y + margin, Math.min(base.window.y + base.cat.y + 12, area.y + area.height - height - margin));
    const info = { x: catRight + gap - base.window.x, y: top - base.window.y, width: sideWidth, height };
    return { ...base,
      window: { ...base.window, width: info.x + info.width, height: Math.max(base.window.height, info.y + info.height) },
      info,
    };
  }
  // Compact screens: put functional text above the existing button and photo.
  const width = Math.min(320, area.width - margin * 2);
  const infoHeight = 128, buttonHeight = 44, controlsHeight = infoHeight + 8 + buttonHeight + gap;
  const scale = Math.min(area.width * 0.76 / image.width,
    Math.max(1, area.height - margin * 2 - controlsHeight) / image.height);
  const catWidth = Math.max(1, Math.round(image.width * scale));
  const catHeight = Math.max(1, Math.round(image.height * scale));
  const windowWidth = Math.max(width, catWidth);
  const height = controlsHeight + catHeight;
  return {
    window: {
      x: Math.round(area.x + (area.width - windowWidth) / 2),
      y: Math.max(area.y + 4, Math.min(
        Math.round(area.y + area.height * 0.54 - catHeight / 2 - controlsHeight),
        area.y + area.height - height - 4)),
      width: windowWidth, height,
    },
    cat: { x: Math.floor((windowWidth - catWidth) / 2), y: controlsHeight, width: catWidth, height: catHeight },
    button: { x: Math.floor((windowWidth - 188) / 2), y: infoHeight + 8, width: 188, height: buttonHeight },
    buttonRadius: 22,
    info: { x: Math.floor((windowWidth - width) / 2), y: 0, width, height: infoHeight },
  };
}
