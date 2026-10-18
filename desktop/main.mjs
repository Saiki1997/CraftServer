import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { app, BrowserWindow, shell } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function openWindow(port) {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 880,
    minHeight: 640,
    title: "CraftServer",
    autoHideMenuBar: true,
    backgroundColor: "#0e1013",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(async () => {
  const port = await freePort();
  process.env.HOST = "127.0.0.1";
  process.env.NITRO_HOST = "127.0.0.1";
  process.env.PORT = String(port);
  process.env.NITRO_PORT = String(port);
  const entry = path.join(here, "server", "index.mjs");
  await import(pathToFileURL(entry).href);
  await openWindow(port);
});

app.on("window-all-closed", () => {
  app.quit();
});
