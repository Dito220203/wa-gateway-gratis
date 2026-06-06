const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const multer = require('multer');
const pino = require('pino');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;
let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true // QR Code akan muncul di log Render nanti
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus karena ', lastDisconnect.error, ', mencoba hubungkan ulang: ', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('MANTAP! WhatsApp Berhasil Terhubung!');
        }
    });
}

// Endpoint untuk menerima kiriman PDF dari PHP CodeIgniter
app.post('/send-pdf', upload.single('file'), async (req, res) => {
    try {
        const { target, message } = req.body;
        const file = req.file;

        if (!sock || !target || !file) {
            return res.status(400).json({ status: false, message: 'Data tidak lengkap!' });
        }

        // Format nomor WA agar sesuai standar (e.g., 628xxx@s.whatsapp.net)
        let formattedTarget = target.replace(/[^0-9]/g, '');
        if (formattedTarget.startsWith('0')) formattedTarget = '62' + formattedTarget.slice(1);
        formattedTarget += '@s.whatsapp.net';

        // Kirim dokumen PDF ke WhatsApp
        await sock.sendMessage(formattedTarget, {
            document: fs.readFileSync(file.path),
            mimetype: 'application/pdf',
            fileName: file.originalname,
            caption: message || ''
        });

        // Hapus file sampah temporary di server gateway
        fs.unlinkSync(file.path);

        res.json({ status: true, message: 'PDF Berhasil Terkirim!' });
    } catch (error) {
        res.status(500).json({ status: false, error: error.message });
    }
});

app.get('/', (req, res) => res.send('WhatsApp Gateway Aktif!'));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    connectToWhatsApp();
});
