import { WebGPURenderer } from "three/webgpu";

/** Crée le renderer/device WebGPU partagé (une seule fois, dans la root). */
export async function createRenderer(canvas: HTMLCanvasElement): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
  });
  return renderer;
}
