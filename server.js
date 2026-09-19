import express from 'express';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.API_KEY || 'rnd_1MZSXwlxSLT3S8ZZ8ioT5H8P0ez5';

app.use(express.json());

// ---------- STATE ----------
let sock = null;
let qrCodeData = null;
let isConnected = false;
let latestQR = null;

// ---------- CONNECT WHATSAPP ----------
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Jadibot-WA', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQR = qr;
            qrCodeData = await QRCode.toDataURL(qr);
            console.log('QR Code baru tersedia! Akses /qr');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus. Reconnect:', shouldReconnect);
            isConnected = false;
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            console.log('WhatsApp Terhubung!');
            isConnected = true;
            latestQR = null;
            qrCodeData = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ---------- HANDLE PESAN MASUK ----------
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        console.log('Pesan dari ' + from + ': ' + text);

        // Simple Auto-Reply
        if (text.toLowerCase() === 'ping') {
            await sock.sendMessage(from, { text: 'pong!' });
        }
        if (text.toLowerCase() === 'menu') {
            await sock.sendMessage(from, {
                text: '*MENU BOT*\n\n.ping - Cek koneksi\n.menu - Menu ini\n.info - Info bot'
            });
        }
        if (text.toLowerCase() === 'info') {
            await sock.sendMessage(from, { text: 'Jadibot WA Engine v1.0\nStatus: Online' });
        }
    });
}

// ---------- API ENDPOINTS ----------
function auth(req, res, next) {
    const key = req.headers['x-api-key'] || req.query.api_key;
    if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

app.get('/status', auth, (req, res) => {
    res.json({
        connected: isConnected,
        qr_available: !!qrCodeData,
        timestamp: new Date().toISOString()
    });
});

app.get('/qr', (req, res) => {
    if (isConnected) return res.json({ message: 'Already connected!' });
    if (!qrCodeData) return res.status(404).json({ error: 'QR not ready yet. Wait a moment.' });
    res.json({ qr: qrCodeData });
});

app.post('/send', auth, async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'Missing to or message' });
    if (!isConnected || !sock) return res.status(503).json({ error: 'WhatsApp not connected' });

    try {
        await sock.sendMessage(to, { text: message });
        res.json({ success: true, to, message });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/logout', auth, async (req, res) => {
    if (sock) {
        await sock.logout();
        sock = null;
        isConnected = false;
        if (fs.existsSync('auth_info')) fs.rmSync('auth_info', { recursive: true });
        res.json({ success: true, message: 'Logged out' });
    } else {
        res.status(400).json({ error: 'Not connected' });
    }
});

app.get('/', (req, res) => {
    res.json({
        name: 'Jadibot WA Engine',
        status: isConnected ? 'connected' : 'disconnected',
        docs: '/status, /qr, /send (POST)'
    });
});

// ---------- START ----------
app.listen(PORT, () => {
    console.log('Server jalan di port ' + PORT);
    connectToWhatsApp();
});
