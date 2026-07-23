// Pont IPC sécurisé : expose au renderer un objet `window.led` typé, sans lui
// donner accès direct à Node. Le renderer envoie l'eHuB / lit-écrit les projets par ici.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("led", {
  sendEhub: (data: Uint8Array) => ipcRenderer.send("ehub:send", data),
  setEhubTarget: (host: string, port: number) => ipcRenderer.send("ehub:target", { host, port }),
  loadProject: () => ipcRenderer.invoke("project:load"),
  saveProject: (json: string) => ipcRenderer.invoke("project:save", json),
  onLoadProject: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("menu:load-project", subscription);
    return () => ipcRenderer.off("menu:load-project", subscription);
  },
  onSaveProject: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("menu:save-project", subscription);
    return () => ipcRenderer.off("menu:save-project", subscription);
  },
  onUndo: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("menu:undo", subscription);
    return () => ipcRenderer.off("menu:undo", subscription);
  },
  onRedo: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on("menu:redo", subscription);
    return () => ipcRenderer.off("menu:redo", subscription);
  },
});
