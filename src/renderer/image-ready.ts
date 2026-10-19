import type { ImageReadiness, ImageFailure, RendererStage } from '../shared/types';

export class ImagePreparationError extends Error {
  constructor(readonly reason: ImageFailure) { super(reason); }
}

/** Loading bytes must not depend on the compositor of an initially hidden window. */
export function prepareImage(image: HTMLImageElement, src: string, mode: ImageReadiness,
  signal: AbortSignal, progress: (stage: RendererStage) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false, loaded = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish(new DOMException('Image preparation cancelled', 'AbortError'));
    const onError = () => {
      // A queued event for a superseded src cannot fail the new pending request.
      if (image.src === src && image.complete && (!image.naturalWidth || !image.naturalHeight)) {
        finish(new ImagePreparationError('image-load'));
      }
    };
    const onLoad = () => {
      if (settled || loaded || image.src !== src || !image.complete) return;
      if (!image.naturalWidth || !image.naturalHeight) { onError(); return; }
      if (image.currentSrc !== src) return;
      loaded = true;
      progress('image-loaded');
      if (mode === 'load') {
        // Windows: let normal painting decode the loaded PNG. Explicit decode()
        // can wait for a compositor commit that a hidden BrowserWindow never makes.
        finish();
      } else {
        // Keep the existing explicit decode path on macOS, with bounded cleanup.
        progress('decoding');
        try {
          void image.decode().then(() => finish(), () => finish(new ImagePreparationError('image-decode')));
        } catch { finish(new ImagePreparationError('image-decode')); }
      }
    };
    if (signal.aborted) { onAbort(); return; }
    image.addEventListener('load', onLoad);
    image.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    timeout = setTimeout(() => finish(new ImagePreparationError('image-timeout')), 5000);
    progress('image-loading');
    if (mode === 'load') { image.decoding = 'sync'; image.loading = 'eager'; }
    if (image.src !== src) image.src = src;
    // Cached images may not send another load event. Allow src's image-update
    // microtask to run before inspecting complete/currentSrc for this request.
    queueMicrotask(onLoad);
  });
}
