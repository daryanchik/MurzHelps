export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface Rect extends Point, Size {}

/** All geometry is in Electron device-independent pixels (DIP), not physical pixels. */
export interface OverlayLayout {
  window: Rect;
  cat: Rect;
  button: Rect;
  buttonRadius: number;
}

export interface LayoutSnapshot {
  revision: number;
  layout: OverlayLayout;
}

export interface MurzBridge {
  getLayout(): Promise<LayoutSnapshot>;
  onLayout(callback: (snapshot: LayoutSnapshot) => void): () => void;
  ready(revision: number): void;
  dismiss(): void;
  pointerMoved(): void;
  reportError(): void;
}

export const IPC = {
  getLayout: 'murz:get-layout',
  layout: 'murz:layout',
  ready: 'murz:ready',
  dismiss: 'murz:dismiss',
  pointer: 'murz:pointer',
  error: 'murz:renderer-error',
} as const;
