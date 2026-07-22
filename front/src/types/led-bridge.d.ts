/** API exposée par le preload Electron (voir electron/preload.ts). */
export interface LedBridge {
  sendEhub(data: Uint8Array): void;
  setEhubTarget(host: string, port: number): void;
  loadProject(): Promise<{ content: string; filePath: string } | null>;
  saveProject(json: string, defaultName?: string): Promise<void>;
  onLoadProject(callback: () => void): () => void;
  onSaveProject(callback: () => void): () => void;
  onUndo(callback: () => void): () => void;
  onRedo(callback: () => void): () => void;
}

declare global {
  interface Window {
    led: LedBridge;
  }
}
