require('dotenv').config(); // Loads the hidden .env file
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Groq = require('groq-sdk');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// --- WEB SERVER SETUP ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

// --- INITIALIZATION ---
// Secure API Key Loading
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY }); 

const VIPS = ['Puja ~🧿', 'Mom', 'Dad', 'Seema', 'Lalit', 'Isha', 'Ishaa Mam']; 
const WORK_KEYWORDS = ['INDRA-NET', 'MindQuest', 'GSoC', 'IIIT', 'assignment', 'project', 'deadline'];

let messageQueue = [];
let dailyLogs = []; // Added back for the report feature
let currentVibe = "chill";
let isDND = false;

// Helpers
function getPriorityLabel(senderName, body) {
    if (VIPS.includes(senderName)) return { level: 1, tag: '🔴 [VIP]' };
    if (WORK_KEYWORDS.some(kw => body.toLowerCase().includes(kw.toLowerCase()))) return { level: 2, tag: '🔵 [WORK]' };
    return { level: 3, tag: '⚪ [NORM]' };
}

function logInteraction(name, type) {
    dailyLogs.push({ name, type, time: new Date().toLocaleTimeString() });
}

// Socket.io (Web Dashboard Communication)
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
            console.log(`[Manual Sent to ${selected.senderName}]`);
        } else if (data.type === 'a') {
            console.log(`[JARVIS processing for ${selected.senderName}...]`);
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
                console.log(`[AI Sent]: ${aiReply}`);
            } catch (e) { console.log('AI Error'); }
        }

        // Remove from queue and update UI
        messageQueue.splice(data.index, 1);
        io.emit('update_queue', messageQueue);
    });
});

// --- WHATSAPP CLIENT ---
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ],
        timeout: 0 
    }
});

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

client.on('ready', () => {
    console.log('\n==================================');
    console.log('JARVIS BOSS INTERFACE IS ONLINE');
    console.log('Go to http://localhost:3000 in your browser!');
    console.log('==================================\n');
});

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
    console.log(`[!] New message added to UI Queue.`);
});

client.initialize();
server.listen(3000, () => console.log('Web Server running on port 3000'));