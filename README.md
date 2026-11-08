# Multi WA

Aplikasi Windows untuk membuka **beberapa akun WhatsApp sekaligus** dalam satu jendela.
Setiap akun memakai sesi (cookie & penyimpanan) terpisah, jadi login-nya tidak tercampur.
Di baliknya, tiap akun adalah WhatsApp Web resmi (`web.whatsapp.com`) yang ditautkan lewat
**Perangkat tertaut** di HP — sama seperti membuka WhatsApp Web di browser.

## Fitur

- Akun tak terbatas (tiap akun ±250–400 MB RAM), login tersimpan saat aplikasi dibuka lagi
- Sidebar dengan nama akun & jumlah pesan belum dibaca
- Notifikasi Windows; klik notifikasi langsung membuka akun yang menerima pesan
- Badge angka di ikon taskbar, ikon berkedip saat ada pesan baru
- Tetap jalan di tray saat jendela ditutup (opsi "Jalankan saat Windows menyala" di menu tray; saat startup aplikasi mulai tersembunyi di tray)
- Klik kanan ikon akun: ganti nama, matikan notifikasi & suara per akun, muat ulang, muat ulang bersih (jika macet), urutkan, hapus
- Tautan dari chat dibuka di browser biasa
- Ekspor / impor pengaturan (menu tray) untuk menyalin daftar akun ke PC lain; login tetap perlu pindai QR di PC baru

## Pintasan

| Tombol | Fungsi |
|---|---|
| `Ctrl` + `1`…`9` | Pindah ke akun ke-1 s/d 9 |
| `Ctrl` + `Tab` / `Ctrl` + `Shift` + `Tab` | Akun berikutnya / sebelumnya |
| `Ctrl` + `Shift` + `N` | Tambah akun |
| `Ctrl` + `R` | Muat ulang akun aktif |
| `Ctrl` + `+` / `-` / `0` | Perbesar / perkecil / normal |

## Pembaruan otomatis

Aplikasi memeriksa versi baru di GitHub Releases saat dibuka dan tiap 6 jam. Jika ada,
muncul tawaran untuk mengunduh; pemasangan terjadi saat aplikasi dimulai ulang. Akun yang
sudah login tidak perlu dipindai ulang. Bisa juga dicek manual lewat ikon tray ›
**Periksa pembaruan…**

### Merilis versi baru

1. Naikkan `"version"` di `package.json` (mis. `1.0.1`).
2. Commit dan push ke `main`.
3. GitHub Actions membangun installer dan menerbitkannya ke Releases sebagai `v1.0.1`.
   Beberapa menit kemudian semua pengguna mendapat tawaran pembaruan.

## Menjalankan dari kode sumber

Butuh [Node.js](https://nodejs.org) versi LTS.

```bat
cd multi-wa
npm install
npm start
```

## Membuat installer `.exe` sendiri

```bat
npm run dist
```

Hasilnya ada di folder `dist\`:

- `Multi WA Setup 1.0.0.exe` — installer (membuat shortcut di Desktop & Start Menu)
- `MultiWA-Portable-1.0.0.exe` — versi portable, langsung jalan tanpa install

Karena tidak ditandatangani (code signing), Windows SmartScreen akan menampilkan
"Windows protected your PC" saat pertama kali dibuka → klik **More info** → **Run anyway**.

## Struktur

```
src/main.js        proses utama: jendela, sesi per akun, tray, pintasan
src/preload.js     jembatan aman sidebar <-> proses utama
src/renderer.js    logika sidebar (daftar akun, dialog, badge)
src/index.html     tampilan sidebar & layar awal
src/styles.css
src/wa-preload.js  dimuat di WhatsApp Web: klik notifikasi -> pindah ke akunnya
```

Data akun tersimpan di `%APPDATA%\Multi WA\` (`accounts.json` + folder `Partitions\wa-*`).

## Catatan

- Ini pembungkus WhatsApp Web, bukan aplikasi resmi WhatsApp. Panggilan suara/video tidak
  tersedia (WhatsApp Web memang tidak mendukungnya); pesan, media, pesan suara, dan
  dokumen berjalan normal.
- Saat menghapus akun, lepaskan juga perangkatnya dari HP:
  WhatsApp › Perangkat tertaut › pilih perangkat › Keluar.
