/** API exposée par le preload Electron (voir electron/preload.ts). */
export interface LedBridge {
  sendEhub(data: Uint8Array): void;
  setEhubTarget(host: string, port: number): void;
  loadProject(): Promise<string | null>;
  saveProject(json: string): Promise<void>;
}

declare global {
  interface Window {
    led: LedBridge;
  }
}
