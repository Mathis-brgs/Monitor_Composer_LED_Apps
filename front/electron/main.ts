// Process principal Electron = le "back" du logiciel : fenêtre, socket UDP eHuB
// (envoi direct au routage Go — plus de pont WebSocket), et I/O disque des projets.
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import path from "node:path";
import dgram from "node:dgram";
import { readFile, writeFile } from "node:fs/promises";

const udp = dgram.createSocket("udp4");
let ehubTarget = { host: "127.0.0.1", port: 8765 }; 
let win: BrowserWindow | null = null;

function setupMenu(win: BrowserWindow): void {
  if (process.platform === "darwin") {
    const template = [
      {
        label: app.name,
        submenu: [
          { role: "about" as const },
          { type: "separator" as const },
          { role: "services" as const },
          { type: "separator" as const },
          { role: "hide" as const },
          { role: "hideOthers" as const },
          { role: "unhide" as const },
          { type: "separator" as const },
          { role: "quit" as const },
        ],
      },
      {
        label: "Fichier",
        submenu: [
          {
            label: "Charger Projet...",
            accelerator: "CmdOrCtrl+O",
            click: () => win.webContents.send("menu:load-project"),
          },
          {
            label: "Sauvegarder Projet",
            accelerator: "CmdOrCtrl+S",
            click: () => win.webContents.send("menu:save-project"),
          },
          { type: "separator" as const },
          { role: "close" as const },
        ],
      },
      {
        label: "Édition",
        submenu: [
          {
            label: "Annuler",
            accelerator: "CmdOrCtrl+Z",
            click: () => win.webContents.send("menu:undo"),
          },
          {
            label: "Rétablir",
            accelerator: "CmdOrCtrl+Shift+Z",
            click: () => win.webContents.send("menu:redo"),
          },
          { type: "separator" as const },
          { role: "cut" as const },
          { role: "copy" as const },
          { role: "paste" as const },
          { role: "selectAll" as const },
        ],
      },
      {
        label: "Affichage",
        submenu: [
          { role: "reload" as const },
          { role: "forceReload" as const },
          { role: "toggleDevTools" as const },
          { type: "separator" as const },
          { role: "resetZoom" as const },
          { role: "zoomIn" as const },
          { role: "zoomOut" as const },
          { type: "separator" as const },
          { role: "togglefullscreen" as const },
        ],
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } else {
    // Windows/Linux : pas de menu natif pour libérer les raccourcis vers la page web
    Menu.setApplicationMenu(null);
  }
}

function createWindow(): void {
  const mac = process.platform === "darwin";
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    // Barre native fondue dans le fond de l'app (couleur --app ember).
    backgroundColor: "#0a0908",
    ...(mac
      ? { titleBarStyle: "hiddenInset" as const }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: { color: "#0a0908", symbolColor: "#948a7e", height: 38 },
        }),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      sandbox: false,
    },
  });

  setupMenu(win);

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
ipcMain.handle("project:load", async (): Promise<{ content: string; filePath: string } | null> => {
  const res = await dialog.showOpenDialog({
    filters: [{ name: "Projet LED", extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const content = await readFile(res.filePaths[0], "utf8");
  return { content, filePath: res.filePaths[0] };
});
ipcMain.handle("project:save", async (_e, json: string): Promise<void> => {
  const res = await dialog.showSaveDialog({
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
