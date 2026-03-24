require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Groq = require('groq-sdk');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY }); 

const VIPS = ['Puja ~🧿', 'Mom', 'Dad', 'Seema', 'Lalit', 'Isha', 'Ishaa Mam']; 
const WORK_KEYWORDS = ['INDRA-NET', 'MindQuest', 'GSoC', 'IIIT', 'assignment', 'project', 'deadline'];

let messageQueue = [];
let dailyLogs = []; 
let currentVibe = "chill";
let isDND = false;

function getPriorityLabel(senderName, body) {
    if (VIPS.includes(senderName)) return { level: 1, tag: '🔴 [VIP]' };
    if (WORK_KEYWORDS.some(kw => body.toLowerCase().includes(kw.toLowerCase()))) return { level: 2, tag: '🔵 [WORK]' };
    return { level: 3, tag: '⚪ [NORM]' };
}

function logInteraction(name, type) {
    dailyLogs.push({ name, type, time: new Date().toLocaleTimeString() });
}

io.on('connection', (socket) => {
    console.log('[UI] Dashboard Connected.');
    socket.emit('update_status', { isDND, vibe: currentVibe });
    socket.emit('update_queue', messageQueue);

    socket.on('toggle_dnd', () => {
        isDND = !isDND;
        io.emit('update_status', { isDND, vibe: currentVibe });
        console.log(`[SYSTEM] DND is now ${isDND ? 'ON' : 'OFF'}`);
    });

    socket.on('change_vibe', (vibe) => {
        currentVibe = vibe;
        io.emit('update_status', { isDND, vibe: currentVibe });
        console.log(`[SYSTEM] Vibe changed to ${currentVibe}`);
    });

    socket.on('generate_report', () => {
        console.log('\n--- 📊 JARVIS UI REPORT ---');
        console.log(`Total Interactions Today: ${dailyLogs.length}`);
        console.log(`Pending in Queue: ${messageQueue.length}`);
        console.log('---------------------------\n');
    });

    socket.on('handle_action', async (data) => {
        const selected = messageQueue[data.index];
        if (!selected) return;

        if (data.type === 's') {
            console.log(`[Skipped message from ${selected.senderName}]`);
        } else if (data.type === 'm') {
            await client.sendMessage(selected.senderID, data.manualText);
            logInteraction(selected.senderName, 'Manual');
        } else if (data.type === 'a') {
            try {
                const prompt = `You are JARVIS, alter ego of Siddharth. Vibe: ${currentVibe}. Use Hinglish. NEVER call a girl "bhai/bro". Show utmost respect to Ishaa Mam. 1 line max.`;
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: 'system', content: prompt },
                        { role: 'user', content: selected.body }
                    ],
                    model: 'llama-3.3-70b-versatile',
                });
                let aiReply = `JARVIS: ${completion.choices[0].message.content.trim()}`;
                await selected.msgObject.reply(aiReply);
                logInteraction(selected.senderName, 'AI');
            } catch (e) { console.log('AI Error'); }
        }

        messageQueue.splice(data.index, 1);
        io.emit('update_queue', messageQueue);
    });
});

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ],
        timeout: 0 
    }
});

// Improved QR Generation for Render Logs
client.on('qr', (qr) => {
    console.log('[SYSTEM] Scan this QR Code to log JARVIS into the Cloud:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n==================================');
    console.log('JARVIS BOSS INTERFACE IS ONLINE');
    console.log('==================================\n');
});

client.on('auth_failure', () => console.error('[ERROR] Auth failed, restart and scan again.'));

client.on('message', async (msg) => {
    if (msg.from.includes('@newsletter') || msg.isStatus) return;

    const isGroup = msg.from.endsWith('@g.us');
    const isWork = WORK_KEYWORDS.some(kw => msg.body.toLowerCase().includes(kw.toLowerCase()));
    if (isGroup && !msg.body.includes('Siddharth') && !msg.body.includes('Sid') && !isWork) return;

    if (isDND) {
        await msg.reply("JARVIS: Sir is in Deep Work mode (DND).");
        return;
    }

    const contact = await msg.getContact();
    const senderName = contact.pushname || contact.name || "Friend";
    const priority = getPriorityLabel(senderName, msg.body);

    messageQueue.push({
        senderName, senderID: msg.from, body: msg.body,
        msgObject: msg, priority: priority.level, tag: priority.tag
    });

    messageQueue.sort((a, b) => a.priority - b.priority);
    io.emit('update_queue', messageQueue);
});

client.initialize();

// Using 0.0.0.0 for external cloud access
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Web Server running on port ${PORT}`));
