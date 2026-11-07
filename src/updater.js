// Pembaruan otomatis dari GitHub Releases.
// Alur: periksa saat aplikasi dibuka (dan tiap 6 jam) -> tanya pengguna -> unduh di latar
// belakang -> tanya lagi untuk restart -> pasang. Login WhatsApp tidak tersentuh.
const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
let getWindow = () => null;
let onProgress = () => {};
let manual = false;
let busy = false;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = null;

autoUpdater.on('update-available', async (info) => {
  const { response } = await dialog.showMessageBox(getWindow(), {
    type: 'info',
    title: 'Pembaruan tersedia',
    message: `Multi WA versi ${info.version} sudah tersedia (Anda memakai ${app.getVersion()}).`,
    detail: 'Pembaruan diunduh di latar belakang dan dipasang saat aplikasi dimulai ulang. ' +
      'Akun WhatsApp yang sudah login tidak perlu dipindai ulang.',
    buttons: ['Unduh sekarang', 'Nanti'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) autoUpdater.downloadUpdate().catch(() => {});
  else busy = false;
});

autoUpdater.on('update-not-available', () => {
  busy = false;
  if (manual) {
    dialog.showMessageBox(getWindow(), {
      type: 'info',
      title: 'Sudah terbaru',
      message: `Multi WA ${app.getVersion()} adalah versi terbaru.`,
    });
  }
});

autoUpdater.on('download-progress', (p) => onProgress(Math.round(p.percent)));

autoUpdater.on('update-downloaded', async (info) => {
  onProgress(null);
  busy = false;
  const { response } = await dialog.showMessageBox(getWindow(), {
    type: 'question',
    title: 'Siap dipasang',
    message: `Versi ${info.version} sudah diunduh.`,
    detail: 'Mulai ulang sekarang untuk memasangnya? Jika "Nanti", pembaruan dipasang otomatis saat aplikasi ditutup.',
    buttons: ['Mulai ulang sekarang', 'Nanti'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) setImmediate(() => autoUpdater.quitAndInstall(false, true));
});

autoUpdater.on('error', (err) => {
  onProgress(null);
  busy = false;
  if (manual) {
    dialog.showMessageBox(getWindow(), {
      type: 'error',
      title: 'Gagal memeriksa pembaruan',
      message: 'Tidak bisa memeriksa pembaruan saat ini.',
      detail: String(err?.message || err),
    });
  }
});

function check(isManual) {
  if (busy || !app.isPackaged) return;
  busy = true;
  manual = !!isManual;
  autoUpdater.checkForUpdates().catch(() => { busy = false; });
}

module.exports = {
  init(opts) {
    getWindow = opts.getWindow;
    onProgress = opts.onProgress || onProgress;
    setTimeout(() => check(false), 15 * 1000);
    setInterval(() => check(false), CHECK_INTERVAL);
  },
  checkNow: () => check(true),
};
