// Dimuat di setiap tampilan WhatsApp Web.
// Tugasnya hanya satu: saat notifikasi diklik, beri tahu aplikasi supaya
// jendela muncul dan pindah ke akun yang menerima pesan.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('__multiwa', {
  notificationClicked: () => ipcRenderer.send('wa:notification-click'),
});

function wrapNotification() {
  const Original = window.Notification;
  if (!Original || Original.__multiwaWrapped) return;
  class Wrapped extends Original {
    constructor(title, options) {
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
