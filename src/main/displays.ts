import { screen, type Display, type Rectangle } from 'electron';

export function cursorDisplay(): Display {
  try { return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); }
  catch { return screen.getPrimaryDisplay(); }
}

export function retainedDisplay(id?: number): Display {
  return screen.getAllDisplays().find(display => display.id === id) ?? cursorDisplay();
}

export function fitBounds(bounds: Rectangle, area: Rectangle): Rectangle {
  const width = Math.max(1, Math.min(bounds.width, area.width));
  const height = Math.max(1, Math.min(bounds.height, area.height));
  return {
    width, height,
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))),
  };
}
