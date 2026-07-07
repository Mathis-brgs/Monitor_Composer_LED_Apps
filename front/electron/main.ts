// Process principal Electron = le "back" du logiciel : fenêtre, socket UDP eHuB
// (envoi direct au routage Go — plus de pont WebSocket), et I/O disque des projets.
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import dgram from "node:dgram";
import { readFile, writeFile } from "node:fs/promises";

const udp = dgram.createSocket("udp4");
let ehubTarget = { host: "127.0.0.1", port: 8765 }; // routeur Go — port À CONFIRMER avec Mathis
let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#0a0a0f",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      sandbox: false,
    },
  });

  // electron-vite fournit l'URL du serveur de dev ; sinon on charge le build.
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

// --- eHuB : le renderer pousse des octets, on les émet en UDP vers le Go ---
ipcMain.on("ehub:send", (_e, data: Uint8Array) => {
  udp.send(Buffer.from(data.buffer, data.byteOffset, data.byteLength), ehubTarget.port, ehubTarget.host);
});
ipcMain.on("ehub:target", (_e, target: { host: string; port: number }) => {
  ehubTarget = target;
});

// --- Projet : ouverture/sauvegarde disque (P1) ---
ipcMain.handle("project:load", async (): Promise<string | null> => {
  const res = await dialog.showOpenDialog({
    filters: [{ name: "Projet LED", extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return readFile(res.filePaths[0], "utf8");
});
ipcMain.handle("project:save", async (_e, json: string, defaultName?: string): Promise<void> => {
  const defaultPath = defaultName 
    ? `${defaultName.replace(/[^a-zA-Z0-9-_]/g, "_")}.json` 
    : "projet.json";
  const res = await dialog.showSaveDialog({
    defaultPath,
    filters: [{ name: "Projet LED", extensions: ["json"] }],
  });
  if (res.canceled || !res.filePath) return;
  await writeFile(res.filePath, json, "utf8");
});

app.whenReady().then(createWindow);
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("window-all-closed", () => {
  udp.close();
  if (process.platform !== "darwin") app.quit();
});
