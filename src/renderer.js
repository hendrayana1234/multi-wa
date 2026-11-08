// Sidebar: daftar akun, tombol tambah, dialog nama, badge taskbar.
const api = window.multiwa;
const $ = (id) => document.getElementById(id);

const listEl = $('accounts');
const emptyEl = $('empty');
const modal = $('modal');
const modalForm = $('modal-form');
const modalInput = $('modal-input');
const helpModal = $('help-modal');

let current = { accounts: [], active: null };
let modalMode = null; // { type: 'add' } | { type: 'rename', id }

function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

function render(s) {
  current = s;
  emptyEl.hidden = s.accounts.length > 0;
  listEl.replaceChildren(
    ...s.accounts.map((acc, i) => {
      const btn = document.createElement('button');
      btn.className = 'acc' + (acc.id === s.active ? ' active' : '');
      btn.setAttribute('role', 'listitem');
      btn.title = `${acc.name}${i < 9 ? `  (Ctrl+${i + 1})` : ''}\nKlik kanan untuk opsi`;
      btn.setAttribute('aria-label', acc.unread ? `${acc.name}, ${acc.unread} belum dibaca` : acc.name);

      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.style.background = acc.color;
      avatar.textContent = initials(acc.name);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = acc.name;

      btn.append(avatar, name);
      if (acc.muted) {
        const mute = document.createElement('span');
        mute.className = 'muted';
        mute.title = 'Notifikasi dimatikan';
        mute.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path d="M3 3l18 18M18 16v-5a6 6 0 0 0-9.3-5M6 10v6l-2 2h14M10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        btn.append(mute);
        btn.setAttribute('aria-label', btn.getAttribute('aria-label') + ', notifikasi dimatikan');
      }
      if (acc.unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = acc.unread > 99 ? '99+' : String(acc.unread);
        btn.append(badge);
      }

      btn.addEventListener('click', () => api.activate(acc.id));
      btn.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const action = await api.menu(acc.id);
        if (action === 'rename') openModal({ type: 'rename', id: acc.id }, acc.name);
      });
      return btn;
    }),
  );
  updateTaskbarBadge(s.accounts.reduce((n, a) => n + a.unread, 0));
}

// Ikon kecil merah berisi angka untuk taskbar Windows.
let lastBadge = -1;
function updateTaskbarBadge(total) {
  if (total === lastBadge) return;
  lastBadge = total;
  if (!total) return api.setBadge(null, 0);
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(16, 16, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  const label = total > 9 ? '9+' : String(total);
  ctx.font = `bold ${label.length > 1 ? 16 : 20}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 16, 17);
  api.setBadge(c.toDataURL('image/png'), total);
}

// ---------- Dialog nama akun ----------
function openModal(mode, value = '') {
  modalMode = mode;
  $('modal-title').textContent = mode.type === 'add' ? 'Tambah akun' : 'Ganti nama akun';
  $('modal-ok').textContent = mode.type === 'add' ? 'Tambah' : 'Simpan';
  modalInput.value = value;
  modalInput.placeholder = mode.type === 'add'
    ? `mis. Pribadi, Toko, Kantor (default: WA ${current.accounts.length + 1})`
    : '';
  api.overlay(true);
  modal.hidden = false;
  setTimeout(() => { modalInput.focus(); modalInput.select(); }, 0);
}

function closeModal() {
  modal.hidden = true;
  modalMode = null;
  api.overlay(false);
}

modalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = modalMode;
  const value = modalInput.value.trim();
  closeModal();
  if (!mode) return;
  if (mode.type === 'add') await api.add(value);
  else if (value) await api.rename(mode.id, value);
});
$('modal-cancel').addEventListener('click', closeModal);
modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });

// ---------- Bantuan ----------
function openHelp() { api.overlay(true); helpModal.hidden = false; $('help-close').focus(); }
function closeHelp() { helpModal.hidden = true; api.overlay(false); }
$('help').addEventListener('click', openHelp);
$('help-close').addEventListener('click', closeHelp);
helpModal.addEventListener('mousedown', (e) => { if (e.target === helpModal) closeHelp(); });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!modal.hidden) closeModal();
  else if (!helpModal.hidden) closeHelp();
});

$('add').addEventListener('click', () => openModal({ type: 'add' }));
$('add-big').addEventListener('click', () => openModal({ type: 'add' }));
api.onOpenAdd(() => { if (modal.hidden && helpModal.hidden) openModal({ type: 'add' }); });

api.onState(render);
api.getState().then(render);
