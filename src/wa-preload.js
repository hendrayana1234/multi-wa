// Dimuat di setiap tampilan WhatsApp Web. Dua tugas:
// 1. Saat notifikasi diklik, beri tahu aplikasi supaya jendela muncul dan pindah ke akunnya.
// 2. Jika akun dibisukan, notifikasi tidak ditampilkan sama sekali.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

let muted = false;
ipcRenderer.on('muted', (_e, value) => { muted = !!value; });

contextBridge.exposeInMainWorld('__multiwa', {
  notificationClicked: () => ipcRenderer.send('wa:notification-click'),
  isMuted: () => muted,
});

function wrapNotification() {
  const Original = window.Notification;
  if (!Original || Original.__multiwaWrapped) return;
  class Wrapped extends Original {
    constructor(title, options) {
      if (window.__multiwa?.isMuted()) {
        // Objek tiruan: WhatsApp tetap mengira notifikasi tampil, padahal tidak.
        const stub = new EventTarget();
        Object.assign(stub, { title, ...(options || {}), close() {}, onclick: null, onclose: null, onerror: null, onshow: null });
        return stub;
      }
      super(title, options);
      this.addEventListener('click', () => window.__multiwa?.notificationClicked());
    }
  }
  Object.defineProperty(Wrapped, 'permission', { get: () => Original.permission });
  Wrapped.requestPermission = (...args) => Original.requestPermission(...args);
  Wrapped.__multiwaWrapped = true;
  window.Notification = Wrapped;
}

if (typeof contextBridge.executeInMainWorld === 'function') {
  contextBridge.executeInMainWorld({ func: wrapNotification });
} else {
  webFrame.executeJavaScript(`(${wrapNotification.toString()})()`);
}
