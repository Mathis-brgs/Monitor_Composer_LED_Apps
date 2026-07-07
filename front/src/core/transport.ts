/** Canal de sortie du front vers le routage. Abstrait (implémentation IPC en logiciel Electron). */
export interface Transport {
  readonly connected: boolean;
  connect(): void;
  send(data: Uint8Array): void;
  updateTarget(host: string, port: number): void;
  dispose(): void;
}

/**
 * Envoie les octets eHuB au process principal Electron via IPC ; c'est lui qui
 * les émet en UDP vers le routage Go (le renderer ne fait pas de réseau).
 */
export class IpcTransport implements Transport {
  private _target: { host: string; port: number };

  constructor(target: { host: string; port: number }) {
    this._target = target;
  }

  get connected(): boolean {
    return typeof window !== "undefined" && Boolean(window.led);
  }

  connect(): void {
    window.led?.setEhubTarget(this._target.host, this._target.port);
  }

  send(data: Uint8Array): void {
    window.led?.sendEhub(data);
  }

  updateTarget(host: string, port: number): void {
    this._target = { host, port };
    window.led?.setEhubTarget(host, port);
  }

  dispose(): void {}
}
