const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const { handleMessage } = require('../handlers');

async function startBot() {
    console.log('🚀 Memulai Bot WhatsApp Finance...');
    
    // Setup auth state
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    // Create WhatsApp socket
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Print QR code di terminal
        logger: {
            level: 'silent', // Kurangi noise di logs
            child: () => ({ level: 'silent' })
        }
    });

    // Save credentials saat berubah
    sock.ev.on('creds.update', saveCreds);
    
    // Handle connection updates
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📱 Scan QR code di bawah ini:');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔌 Koneksi terputus:', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
            
            if (shouldReconnect) {
                setTimeout(() => startBot(), 3000); // Reconnect setelah 3 detik
            }
        } else if (connection === 'open') {
            console.log('✅ Bot WhatsApp Finance siap digunakan! 🚀');
        }
    });

    // Handle incoming messages
    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        
        // Hanya proses pesan yang bukan dari bot sendiri
        if (!message.key.fromMe && m.type === 'notify') {
            console.log('📩 Pesan masuk dari:', message.key.remoteJid);
            
            try {
                await handleMessage(sock, message);
            } catch (error) {
                console.error('❌ Error handling message:', error);
            }
        }
    });

    // Handle errors
    sock.ev.on('connection.update', (update) => {
        if (update.lastDisconnect?.error) {
            console.error('❌ Connection error:', update.lastDisconnect.error);
        }
    });

    return sock;
}

// Start the bot
startBot().catch(err => {
    console.error('❌ Failed to start bot:', err);
    process.exit(1);
});
