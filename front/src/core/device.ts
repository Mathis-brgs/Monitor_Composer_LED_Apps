import { WebGPURenderer } from "three/webgpu";

/** Crée le renderer/device WebGPU partagé (une seule fois, dans la root). */
export async function createRenderer(canvas: HTMLCanvasElement): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  // Le canvas est intégré à un panneau : on suit sa taille CSS (pas la fenêtre).
  // updateStyle=false → l'affichage reste piloté par le CSS du panneau viewport.
  const resize = (): void => {
    renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  return renderer;
}
