// Multi WA — buka beberapa akun WhatsApp Web sekaligus.
// Setiap akun berjalan di "partition" (sesi) terpisah, jadi cookie & login-nya tidak tercampur.

const {
  app, BrowserWindow, WebContentsView, ipcMain, Menu, Tray,
  session, shell, nativeImage, dialog, clipboard
} = require('electron');
const path = require('path');
const fs = require('fs');
const updater = require('./updater');

const APP_ID = 'id.multiwa.app';
const SIDEBAR_WIDTH = 76;
const WA_URL = 'https://web.whatsapp.com/';
// WhatsApp Web menolak browser yang tidak dikenal, jadi kita pakai User-Agent Chrome biasa.
const CHROME_UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const COLORS = ['#25a884', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const ICON_PATH = path.join(__dirname, 'icon.png');

app.setAppUserModelId(APP_ID); // perlu agar notifikasi Windows muncul

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let tray = null;
let isQuitting = false;
let overlayOpen = false;
let activeId = null;
let downloadPercent = null;
const views = new Map(); // id -> { view, unread }

// ---------- Penyimpanan daftar akun ----------
const stateFile = () => path.join(app.getPath('userData'), 'accounts.json');
let state = { accounts: [], active: null, bounds: null };

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    state = { accounts: [], active: null, bounds: null, ...raw };
  } catch {
    /* file belum ada: mulai kosong */
  }
}

function saveState() {
  state.active = activeId;
  if (win && !win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) {
    state.bounds = win.getBounds();
  }
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('Gagal menyimpan accounts.json:', err);
  }
}

const partitionOf = (id) => `persist:wa-${id}`;
const accountOf = (id) => state.accounts.find((a) => a.id === id);

// ---------- Tampilan untuk renderer (sidebar) ----------
function publicState() {
  return {
    active: activeId,
    accounts: state.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      muted: !!a.muted,
      unread: views.get(a.id)?.unread || 0,
    })),
  };
}

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send('state', publicState());
  // Akun yang dibisukan tidak ikut dihitung di judul jendela, tray, dan badge taskbar.
  const total = [...views].reduce((n, [id, v]) => n + (accountOf(id)?.muted ? 0 : v.unread), 0);
  let title = total ? `(${total}) Multi WA` : 'Multi WA';
  if (downloadPercent !== null) title += ` — mengunduh pembaruan ${downloadPercent}%`;
  if (win && !win.isDestroyed()) win.setTitle(title);
  if (tray) tray.setToolTip(total ? `Multi WA — ${total} pesan belum dibaca` : 'Multi WA');
}

// ---------- Tata letak ----------
function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const bounds = { x: SIDEBAR_WIDTH, y: 0, width: Math.max(0, w - SIDEBAR_WIDTH), height: h };
  for (const { view } of views.values()) view.setBounds(bounds);
}

function refreshVisibility() {
  for (const [id, { view }] of views) view.setVisible(!overlayOpen && id === activeId);
}

function activate(id) {
  if (!views.has(id)) return;
  activeId = id;
  refreshVisibility();
  views.get(id).view.webContents.focus();
  pushState();
  saveState();
}

// ---------- Satu tampilan WhatsApp per akun ----------
function configureSession(ses) {
  ses.setUserAgent(CHROME_UA);
  const allowed = new Set(['notifications', 'media', 'clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

function createView(acc) {
  const partition = partitionOf(acc.id);
  configureSession(session.fromPartition(partition));

  const view = new WebContentsView({
    webPreferences: {
      partition,
      preload: path.join(__dirname, 'wa-preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  view.setBackgroundColor('#111b21');
  const wc = view.webContents;

  // Tautan dari chat dibuka di browser biasa, bukan di dalam aplikasi.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (!url.startsWith('https://web.whatsapp.com')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  // Judul tab WhatsApp berbentuk "(3) WhatsApp" -> ambil angka pesan belum dibaca.
  wc.on('page-title-updated', (_e, title) => {
    const match = title.match(/^\((\d+)\)/);
    const unread = match ? Number(match[1]) : 0;
    const entry = views.get(acc.id);
    if (!entry || entry.unread === unread) return;
    const increased = unread > entry.unread;
    entry.unread = unread;
    pushState();
    if (increased && !acc.muted && win && !win.isFocused()) win.flashFrame(true);
  });

  wc.on('context-menu', (_e, p) => {
    const items = [];
    if (p.isEditable) {
      items.push(
        { role: 'undo', label: 'Urungkan' },
        { role: 'redo', label: 'Ulangi' },
        { type: 'separator' },
        { role: 'cut', label: 'Potong' },
        { role: 'copy', label: 'Salin' },
        { role: 'paste', label: 'Tempel' },
        { role: 'selectAll', label: 'Pilih semua' },
      );
    } else if (p.selectionText) {
      items.push({ role: 'copy', label: 'Salin' });
    }
    if (p.linkURL && /^https?:/i.test(p.linkURL)) {
      if (items.length) items.push({ type: 'separator' });
      items.push(
        { label: 'Buka tautan di browser', click: () => shell.openExternal(p.linkURL) },
        { label: 'Salin tautan', click: () => clipboard.writeText(p.linkURL) },
      );
    }
    if (p.mediaType === 'image' && p.srcURL) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'Simpan gambar…', click: () => wc.downloadURL(p.srcURL) });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  wc.on('before-input-event', handleShortcut);

  // Status bisu dikirim ke halaman setiap selesai dimuat (termasuk setelah reload).
  wc.setAudioMuted(!!acc.muted);
  wc.on('did-finish-load', () => wc.send('muted', !!accountOf(acc.id)?.muted));

  wc.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') setTimeout(() => !wc.isDestroyed() && wc.reload(), 1500);
  });

  wc.loadURL(WA_URL, { userAgent: CHROME_UA });
  win.contentView.addChildView(view);
  views.set(acc.id, { view, unread: 0 });
  layout();
  refreshVisibility();
}

function destroyView(id) {
  const entry = views.get(id);
  if (!entry) return;
  win.contentView.removeChildView(entry.view);
  entry.view.webContents.close();
  views.delete(id);
}

// ---------- Aksi akun ----------
function addAccount(name) {
  const clean = String(name || '').trim().slice(0, 40) || `WA ${state.accounts.length + 1}`;
  const acc = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: clean,
    color: COLORS[state.accounts.length % COLORS.length],
  };
  state.accounts.push(acc);
  createView(acc);
  activate(acc.id);
  return acc.id;
}

function renameAccount(id, name) {
  const acc = accountOf(id);
  const clean = String(name || '').trim().slice(0, 40);
  if (!acc || !clean) return;
  acc.name = clean;
  saveState();
  pushState();
}

async function removeAccount(id) {
  const acc = accountOf(id);
  if (!acc) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Hapus', 'Batal'],
    defaultId: 1,
    cancelId: 1,
    title: 'Hapus akun',
    message: `Hapus "${acc.name}" dari Multi WA?`,
    detail:
      'Data login akun ini di komputer akan dihapus. Sebaiknya lepaskan juga perangkatnya dari HP: ' +
      'WhatsApp > Perangkat tertaut > pilih perangkat > Keluar.',
  });
  if (response !== 0) return;

  destroyView(id);
  state.accounts = state.accounts.filter((a) => a.id !== id);
  const ses = session.fromPartition(partitionOf(id));
  await ses.clearStorageData().catch(() => {});
  await ses.clearCache().catch(() => {});

  if (activeId === id) {
    activeId = null;
    if (state.accounts.length) activate(state.accounts[0].id);
  }
  saveState();
  pushState();
}

async function cleanReload(id) {
  // Hapus cache & service worker tanpa logout (memperbaiki WA yang macet/blank).
  const entry = views.get(id);
  if (!entry) return;
  await session
    .fromPartition(partitionOf(id))
    .clearStorageData({ storages: ['serviceworkers', 'cachestorage', 'shadercache'] })
    .catch(() => {});
  entry.view.webContents.loadURL(WA_URL, { userAgent: CHROME_UA });
}

function setMuted(id, muted) {
  const acc = accountOf(id);
  const entry = views.get(id);
  if (!acc || !entry) return;
  acc.muted = !!muted;
  entry.view.webContents.setAudioMuted(acc.muted);
  entry.view.webContents.send('muted', acc.muted);
  saveState();
  pushState();
}

function moveAccount(id, delta) {
  const i = state.accounts.findIndex((a) => a.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= state.accounts.length) return;
  [state.accounts[i], state.accounts[j]] = [state.accounts[j], state.accounts[i]];
  saveState();
  pushState();
}

// ---------- Ekspor / impor pengaturan (untuk pindah PC) ----------
async function exportSettings() {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Ekspor pengaturan Multi WA',
    defaultPath: path.join(app.getPath('documents'), 'multi-wa-pengaturan.json'),
    filters: [{ name: 'Pengaturan Multi WA', extensions: ['json'] }],
  });
  if (canceled || !filePath) return;
  const data = {
    app: 'multi-wa',
    format: 1,
    exportedAt: new Date().toISOString(),
    accounts: state.accounts.map((a) => ({ name: a.name, color: a.color, muted: !!a.muted })),
  };
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Pengaturan diekspor',
      message: `${data.accounts.length} akun disimpan ke:\n${filePath}`,
      detail: 'Salin file ini ke PC lain, lalu pilih "Impor pengaturan…" di menu tray. ' +
        'Login WhatsApp tidak ikut tersalin; di PC baru tiap akun perlu dipindai QR sekali.',
    });
  } catch (err) {
    dialog.showErrorBox('Gagal mengekspor', String(err.message || err));
  }
}

async function importSettings() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Impor pengaturan Multi WA',
    filters: [{ name: 'Pengaturan Multi WA', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (data.app !== 'multi-wa' || !Array.isArray(data.accounts)) throw new Error('bukan file pengaturan Multi WA');
  } catch (err) {
    dialog.showErrorBox('File tidak valid', `File ini tidak bisa dibaca: ${err.message || err}`);
    return;
  }

  const existing = new Set(state.accounts.map((a) => a.name.toLowerCase()));
  const incoming = data.accounts
    .map((a) => ({
      name: String(a.name || '').trim().slice(0, 40),
      color: typeof a.color === 'string' && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : null,
      muted: !!a.muted,
    }))
    .filter((a) => a.name);
  const fresh = incoming.filter((a) => !existing.has(a.name.toLowerCase()));

  if (!fresh.length) {
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Tidak ada yang diimpor',
      message: 'Semua akun di file ini sudah ada di PC ini (dicocokkan berdasarkan nama).',
    });
    return;
  }

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Impor pengaturan',
    message: `Tambahkan ${fresh.length} akun dari file ini?`,
    detail: fresh.map((a) => `• ${a.name}${a.muted ? ' (notifikasi mati)' : ''}`).join('\n') +
      (incoming.length > fresh.length ? `\n\n${incoming.length - fresh.length} akun dilewati karena namanya sudah ada.` : '') +
      '\n\nSetiap akun baru perlu dipindai QR dari HP.',
    buttons: ['Impor', 'Batal'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;

  let firstId = null;
  for (const a of fresh) {
    const acc = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: a.name,
      color: a.color || COLORS[state.accounts.length % COLORS.length],
      muted: a.muted,
    };
    state.accounts.push(acc);
    createView(acc);
    firstId = firstId || acc.id;
  }
  saveState();
  pushState();
  showWindow();
  if (firstId) activate(firstId);
}

// ---------- Pintasan keyboard ----------
function handleShortcut(event, input) {
  if (input.type !== 'keyDown' || !input.control) return;
  const key = input.key.toLowerCase();
  const active = views.get(activeId)?.view.webContents;

  if (/^[1-9]$/.test(key) && !input.shift && !input.alt) {
    const acc = state.accounts[Number(key) - 1];
    if (acc) activate(acc.id);
    event.preventDefault();
  } else if (key === 'tab') {
    const n = state.accounts.length;
    if (n > 1) {
      const i = state.accounts.findIndex((a) => a.id === activeId);
      activate(state.accounts[(i + (input.shift ? n - 1 : 1)) % n].id);
    }
    event.preventDefault();
  } else if (key === 'n' && input.shift) {
    showWindow();
    win.webContents.focus();
    win.webContents.send('open-add');
    event.preventDefault();
  } else if (key === 'r' && !input.shift && active) {
    active.reload();
    event.preventDefault();
  } else if ((key === '=' || key === '+') && active) {
    active.setZoomLevel(Math.min(active.getZoomLevel() + 0.5, 4));
    event.preventDefault();
  } else if (key === '-' && active) {
    active.setZoomLevel(Math.max(active.getZoomLevel() - 0.5, -3));
    event.preventDefault();
  } else if (key === '0' && active) {
    active.setZoomLevel(0);
    event.preventDefault();
  } else if (key === 'i' && input.shift && active) {
    active.toggleDevTools();
    event.preventDefault();
  }
}

// ---------- Badge di taskbar ----------
ipcMain.on('badge', (_e, dataUrl, count) => {
  if (!win || win.isDestroyed()) return;
  if (count > 0 && dataUrl) {
    win.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), `${count} pesan belum dibaca`);
  } else {
    win.setOverlayIcon(null, '');
  }
});

// ---------- IPC dari sidebar ----------
ipcMain.handle('state:get', () => publicState());
ipcMain.handle('account:add', (_e, name) => addAccount(name));
ipcMain.handle('account:activate', (_e, id) => activate(id));
ipcMain.handle('account:rename', (_e, id, name) => renameAccount(id, name));
ipcMain.handle('overlay', (_e, open) => {
  overlayOpen = !!open;
  refreshVisibility();
  if (!overlayOpen) views.get(activeId)?.view.webContents.focus();
});
ipcMain.handle('account:menu', (_e, id) => {
  const acc = accountOf(id);
  if (!acc) return null;
  const index = state.accounts.indexOf(acc);
  return new Promise((resolve) => {
    let chosen = null;
    const pick = (action) => () => { chosen = action; };
    const menu = Menu.buildFromTemplate([
      { label: acc.name, enabled: false },
      { type: 'separator' },
      { label: 'Ganti nama…', click: pick('rename') },
      {
        label: 'Notifikasi & suara',
        type: 'checkbox',
        checked: !acc.muted,
        click: (item) => setMuted(id, !item.checked),
      },
      { type: 'separator' },
      { label: 'Muat ulang', click: () => views.get(id)?.view.webContents.reload() },
      { label: 'Muat ulang bersih (jika macet)', click: () => cleanReload(id) },
      { type: 'separator' },
      { label: 'Pindah ke atas', enabled: index > 0, click: () => moveAccount(id, -1) },
      { label: 'Pindah ke bawah', enabled: index < state.accounts.length - 1, click: () => moveAccount(id, 1) },
      { type: 'separator' },
      { label: 'Hapus akun…', click: () => removeAccount(id) },
    ]);
    menu.popup({ window: win, callback: () => resolve(chosen) });
  });
});

// Klik notifikasi -> tampilkan jendela & pindah ke akun pengirim.
ipcMain.on('wa:notification-click', (event) => {
  for (const [id, { view }] of views) {
    if (view.webContents.id === event.sender.id) {
      showWindow();
      activate(id);
      break;
    }
  }
});

// ---------- Jendela & tray ----------
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  const img = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Multi WA');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Buka Multi WA', click: showWindow },
      {
        label: 'Jalankan saat Windows menyala',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        // Saat dijalankan dari startup, mulai tersembunyi di tray (--hidden).
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
      },
      { type: 'separator' },
      { label: 'Ekspor pengaturan…', click: exportSettings },
      { label: 'Impor pengaturan…', click: importSettings },
      { type: 'separator' },
      { label: 'Periksa pembaruan…', click: () => updater.checkNow() },
      { label: `Versi ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: 'Keluar', click: () => { isQuitting = true; app.quit(); } },
    ]),
  );
  tray.on('click', showWindow);
}

function createWindow() {
  const b = state.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1280,
    height: b.height || 800,
    x: b.x,
    y: b.y,
    minWidth: 640,
    minHeight: 480,
    title: 'Multi WA',
    icon: ICON_PATH,
    backgroundColor: '#111b21',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('before-input-event', handleShortcut);
  const startHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });

  for (const ev of ['resize', 'maximize', 'unmaximize', 'restore']) win.on(ev, layout);
  win.on('focus', () => win.flashFrame(false));
  win.on('close', (e) => {
    saveState();
    if (!isQuitting) {
      e.preventDefault();
      win.hide(); // tetap jalan di tray agar notifikasi tetap masuk
      if (!state.trayHintShown && tray && process.platform === 'win32') {
        tray.displayBalloon({
          iconType: 'info',
          title: 'Multi WA masih berjalan',
          content: 'Notifikasi tetap masuk. Untuk keluar, klik kanan ikon ini lalu pilih Keluar.',
        });
        state.trayHintShown = true;
        saveState();
      }
    }
  });

  for (const acc of state.accounts) createView(acc);
  const startId = accountOf(state.active) ? state.active : state.accounts[0]?.id;
  if (startId) activate(startId);
  layout();
}

app.on('second-instance', showWindow);
app.on('before-quit', () => { isQuitting = true; saveState(); });

app.whenReady().then(() => {
  loadState();
  createWindow();
  createTray();
  updater.init({
    getWindow: () => (win && !win.isDestroyed() ? win : undefined),
    onProgress: (pct) => { downloadPercent = pct; pushState(); },
  });
});

app.on('window-all-closed', () => app.quit());
