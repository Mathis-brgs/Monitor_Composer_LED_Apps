// Pont IPC sécurisé : expose au renderer un objet `window.led` typé, sans lui
// donner accès direct à Node. Le renderer envoie l'eHuB / lit-écrit les projets par ici.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("led", {
  sendEhub: (data: Uint8Array) => ipcRenderer.send("ehub:send", data),
  setEhubTarget: (host: string, port: number) => ipcRenderer.send("ehub:target", { host, port }),
  loadProject: () => ipcRenderer.invoke("project:load"),
  saveProject: (json: string) => ipcRenderer.invoke("project:save", json),
});
