const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const multer = require('multer');
const pino = require('pino');
const fs = require('fs');
const qrcode = require('qrcode'); // Library baru untuk generate gambar QR

const app = express();
const upload = multer({ dest: '/tmp/' }); // Vercel hanya mengizinkan nulis file di folder /tmp/
const PORT = process.env.PORT || 3000;

let sock;
let qrText = "";
let isConnected = false;

async function connectToWhatsApp() {
    // Menyimpan sesi di /tmp/ agar diizinkan oleh Vercel
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        
        if (qr) {
            qrText = qr; // Simpan teks QR agar bisa diubah jadi gambar
        }

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            isConnected = true;
            qrText = "";
            console.log('WhatsApp Berhasil Terhubung!');
        }
    });
}

// Jalankan koneksi pertama kali
connectToWhatsApp();

// Halaman utama untuk Scan QR Code lewat Browser
app.get('/', async (req, res) => {
    if (isConnected) {
        return res.send('<h1>🎉 WhatsApp Gateway Aktif & Terhubung!</h1>');
    }
    
    if (qrText) {
        try {
            const qrImage = await qrcode.toDataURL(qrText);
            return res.send(`
                <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                    <h2>Silakan Scan QR Code untuk Menghubungkan WA Toko:</h2>
                    <img src="${qrImage}" style="border: 2px solid #333; padding: 10px;" />
                    <p>Buka WhatsApp di HP -> Perangkat Tertaut -> Tautkan Perangkat</p>
                    <script>setTimeout(() => { location.reload(); }, 15000);</script>
                </div>
            `);
        } catch (err) {
            return res.send('Gagal membuat QR Code, silakan refresh halaman.');
        }
    }

    res.send('<div style="text-align: center; margin-top: 50px; font-family: sans-serif;"><h2>Sedang menyiapkan QR Code, mohon tunggu beberapa detik lalu refresh...</h2></div>');
});

// Endpoint kirim PDF dari CodeIgniter
app.post('/send-pdf', upload.single('file'), async (req, res) => {
    try {
        const { target, message } = req.body;
        const file = req.file;

        if (!target || !file) {
            return res.status(400).json({ status: false, message: 'Data tidak lengkap!' });
        }

        let formattedTarget = target.replace(/[^0-9]/g, '');
        if (formattedTarget.startsWith('0')) formattedTarget = '62' + formattedTarget.slice(1);
        formattedTarget += '@s.whatsapp.net';

        await sock.sendMessage(formattedTarget, {
            document: fs.readFileSync(file.path),
            mimetype: 'application/pdf',
            fileName: file.originalname,
            caption: message || ''
        });

        fs.unlinkSync(file.path);
        res.json({ status: true, message: 'PDF Berhasil Terkirim!' });
    } catch (error) {
        res.status(500).json({ status: false, error: error.message });
    }
});

// Tambahkan baris ini khusus kompatibilitas Vercel Serverless
module.exports = app;
