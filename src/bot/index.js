const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { handleMessage } = require('../handlers');
const { SESSION_NAME } = require('../config');

const client = new Client({
  authStrategy: new LocalAuth({ clientId: SESSION_NAME }),
  puppeteer: {
    headless: true,
    executablePath: '/usr/bin/google-chrome-stable',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('Bot WhatsApp Finance siap digunakan! 🚀'));

// PERBAIKAN: Pass client sebagai parameter pertama
client.on('message', async (message) => {
    await handleMessage(client, message);
});

client.on('authenticated', () => console.log('✅ WhatsApp authenticated'));
client.on('auth_failure', msg => console.error('❌ WhatsApp authentication failed:', msg));
client.on('disconnected', reason => console.log('🔌 WhatsApp disconnected:', reason));

console.log('🚀 Memulai Bot WhatsApp Finance...');
client.initialize();
