const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const crypto = require('crypto');
const axios = require('axios');
const yts = require('yt-search');
const fetch = require('node-fetch');
const os = require('os');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

// Safe settings load
let initUserEnvIfMissing, initEnvsettings, getSetting;
try {
    ({ initUserEnvIfMissing } = require('./settingsdb'));
    ({ initEnvsettings, getSetting } = require('./settings'));
} catch (e) {
    console.warn('Settings modules not found, using defaults:', e.message);
    initUserEnvIfMissing = async () => {};
    initEnvsettings = async () => {};
    getSetting = () => null;
}

const autoReact = getSetting('AUTO_REACT') || 'on';

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent
} = require('@whiskeysockets/baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['🧩','🍉','💜','🌸','🪴','💊','💫','🍂','🌟','🎋','😶‍🌫️','🫀','🧿','👀','🤖','🚩','🥰','🗿','💜','💙','🌝','🖤','💚'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/E74x12RpocT8psA9axsFZm',
    ADMIN_LIST_PATH: './admin.json',
    IMAGE_PATH: 'https://files.catbox.moe/2fzvp7.jpg',
    NEWSLETTER_JID: '120363426365565222@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    NEWS_JSON_URL: '',
    BOT_NAME: 'LUCIFER-X-MINI-V1',
    OWNER_NAME: '#SANDARU UDAN',
    OWNER_NUMBER: '94765634418',
    BOT_VERSION: '1.0.0',
    BOT_FOOTER: '> © 𝙻𝚄𝙲𝙸𝙵𝙴𝚁-x-ᴍɪɴɪ ʙᴏᴛ',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb7FroF77qVOZdgZPj33',
    BUTTON_IMAGES: {
        ALIVE: 'https://files.catbox.moe/2fzvp7.jpg',
        MENU: 'https://files.catbox.moe/2fzvp7.jpg',
        OWNER: 'https://files.catbox.moe/2fzvp7.jpg',
        SONG: 'https://files.catbox.moe/2fzvp7.jpg',
        VIDEO: 'https://files.catbox.moe/2fzvp7.jpg'
    }
};

const mongoUri = 'mongodb+srv://heshancamika_db_user:XM8EiSj9zHJLeMuG@cluster0.nimdgb1.mongodb.net/?appName=Cluster0';
const client = new MongoClient(mongoUri);
let db;

async function initMongo() {
    if (!db) {
        await client.connect();
        db = client.db('data1');
        await db.collection('sessions').createIndex({ number: 1 });
    }
    return db;
}

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `${title}\n\n${content}\n\n${footer}`;
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

function runtime(seconds) {
    seconds = Number(seconds);
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const dDisplay = d > 0 ? d + (d === 1 ? ' day, ' : ' days, ') : '';
    const hDisplay = h > 0 ? h + (h === 1 ? ' hour, ' : ' hours, ') : '';
    const mDisplay = m > 0 ? m + (m === 1 ? ' minute, ' : ' minutes, ') : '';
    const sDisplay = s > 0 ? s + (s === 1 ? ' second' : ' seconds') : '';
    return dDisplay + hDisplay + mDisplay + sDisplay;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
};

async function fetchNews() {
    try {
        const response = await axios.get(config.NEWS_JSON_URL);
        return response.data || [];
    } catch (error) {
        console.error('Failed to fetch news:', error.message);
        return [];
    }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) return { status: 'failed', error: 'Invalid group invite link' };
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) return { status: 'success', gid: response.gid };
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) errorMessage = 'Bot is not authorized to join';
            else if (error.message.includes('conflict')) errorMessage = 'Already a member';
            else if (error.message.includes('gone')) errorMessage = 'Invite link expired';
            if (retries === 0) return { status: 'failed', error: errorMessage };
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const caption = formatMessage(
        '*Connected Successful ✅*',
        ` ❗Number: ${number}\n 🧚‍♂️ Status: Online`,
        `${config.BOT_FOOTER}`
    );
    for (const admin of admins) {
        try {
            await socket.sendMessage(`${admin}@s.whatsapp.net`, {
                image: { url: config.IMAGE_PATH },
                caption
            });
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== config.NEWSLETTER_JID) return;
        try {
            const messageId = message.newsletterServerId;
            if (!messageId) return;
            let retries = config.MAX_RETRIES;
            while (retries > 0) {
                try {
                    await socket.newsletterReactMessage(config.NEWSLETTER_JID, messageId.toString(), '❤️‍🩹');
                    break;
                } catch (error) {
                    retries--;
                    if (retries === 0) throw error;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
        } catch (error) {
            console.error('Newsletter reaction error:', error);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
        try {
            if (autoReact === 'on') {
                await socket.sendPresenceUpdate('recording', message.key.remoteJid);
            }
            if (config.AUTO_VIEW_STATUS === 'true') {
                await socket.readMessages([message.key]);
            }
            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                await socket.sendMessage(
                    message.key.remoteJid,
                    { react: { text: randomEmoji, key: message.key } },
                    { statusJidList: [message.key.participant] }
                );
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;
        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        const message = formatMessage(
            '╭──◯',
            `│ \`D E L E T E\`\n│ *⦁ From :* ${messageKey.remoteJid}\n│ *⦁ Time:* ${deletionTime}\n│ *⦁ Type: Normal*\n╰──◯`,
            `${config.BOT_FOOTER}`
        );
        try {
            await socket.sendMessage(userJid, { image: { url: config.IMAGE_PATH }, caption: message });
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

function setupCommandHandlers(socket, number) {
    // dailyfact state
    let isFactEnabled = false;
    let factTimer = null;

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        let command = null;
        let args = [];
        let sender = msg.key.remoteJid;

        if (msg.message.conversation || msg.message.extendedTextMessage?.text) {
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            if (text.startsWith(config.PREFIX)) {
                const parts = text.slice(config.PREFIX.length).trim().split(/\s+/);
                command = parts[0].toLowerCase();
                args = parts.slice(1);
            }
        } else if (msg.message.buttonsResponseMessage) {
            const buttonId = msg.message.buttonsResponseMessage.selectedButtonId;
            if (buttonId && buttonId.startsWith(config.PREFIX)) {
                const parts = buttonId.slice(config.PREFIX.length).trim().split(/\s+/);
                command = parts[0].toLowerCase();
                args = parts.slice(1);
            }
        }

        if (!command) return;

        try {
            switch (command) {

                case 'alive': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);
                    const title = '*❛𝙻𝚄𝙲𝙸𝙵𝙴𝚁-𝚇-𝙼𝙸𝙽𝙸 V1 🧚‍♂️❛*';
                    const content = `*© 𝐏ᴏᴡᴇʀᴅ 𝐁ʏ Lucifer ❛🧚‍♂️*\n*𝐁ᴏᴛ 𝐎ᴡɴᴇʀ :- hashen*\n*𝐎ᴡᴇɴʀ 𝐍ᴜᴍʙᴇʀ :- 94765634418*\n*ᴍɪɴɪ ꜱɪᴛᴇ*\n> https://hashen-mini-bot.onrender.com/`;
                    await socket.sendMessage(sender, {
                        image: { url: config.BUTTON_IMAGES.ALIVE },
                        caption: formatMessage(title, content, config.BOT_FOOTER),
                        buttons: [
                            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: 'MENU' }, type: 1 },
                            { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: 'PING' }, type: 1 }
                        ],
                        quoted: msg
                    });
                    break;
                }

                case 'menu': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);
                    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                    const kariyane = `┏━❐  \`ᴀʟʟ ᴍᴇɴᴜ\`
┃ *⭔ ʙᴏᴛ ɴᴀᴍᴇ - 𝙻𝚄𝙲𝙸𝙵𝙴𝚁-𝚇-𝙼𝙸𝙽𝙸*
┃ *⭔ ᴘʟᴀᴛꜰʀᴏᴍ - Heroku*
┃ *⭔ ᴜᴘᴛɪᴍᴇ:* ${hours}h ${minutes}m ${seconds}s
┗━❐

╭─═❮ ⚡ ʙᴏᴛ ᴍᴇɴᴜ ⚡ ❯═━───❖
┣📌 𝑺ʏꜱᴛᴇᴍ
*│ 🟢 .ᴀʟɪᴠᴇ →* ┣ ʙᴏᴛ ᴏɴʟɪɴᴇ ᴄʜᴇᴄᴋ
*│ 📶 .ᴘɪɴɢ →* ┣ ꜱᴘᴇᴇᴅ ᴛᴇꜱᴛ
*│ ⚙️ .ꜱʏꜱᴛᴇᴍ →* ┣ ʙᴏᴛ ꜱʏꜱᴛᴇᴍ ɪɴꜰᴏ
*│ 👑 .ᴏᴡɴᴇʀ →* ┣ ꜱʜᴏᴡ ʙᴏᴛ ᴏᴡɴᴇʀꜱ
┢━━━━━━━━━━━━━━━━━━━━➢
┡🎵 𝑴ᴇᴅɪᴀ
*│ 🎼 .ꜱᴏɴɢ <ɴᴀᴍᴇ> →* ┣ ᴅᴏᴡɴʟᴏᴀᴅ ꜱᴏɴɢ
*│ 📘 .ꜰʙ <ᴜʀʟ> →* ┣ ꜰᴀᴄᴇʙᴏᴏᴋ ᴠɪᴅᴇᴏ
*│ 🎵 .ᴛɪᴋᴛᴏᴋ <ᴜʀʟ> →* ┣ ᴛɪᴋᴛᴏᴋ ᴅʟ
*│ 📲 .ᴀᴘᴋ <ɴᴀᴍᴇ> →* ┣ ᴀᴘᴋ ᴅᴏᴡɴʟᴏᴀᴅ
┢━━━━━━━━━━━━━━━━━━━━➢
┡🛠 𝑻ᴏᴏʟꜱ
*│ 📦 .ɴᴘᴍ <ᴘᴀᴄᴋᴀɢᴇ> →* ┣ ɴᴘᴍ ɪɴꜰᴏ
*│ 🔍 .ɢᴏᴏɢʟᴇ <ǫᴜᴇʀʏ> →* ┣ ɢᴏᴏɢʟᴇ ꜱᴇᴀʀᴄʜ
*│ 🤖 .ᴀɪ <ᴘʀᴏᴍᴘᴛ> →* ┣ ᴄʜᴀᴛ ᴡɪᴛʜ ᴀɪ
*│ 🖼️ .ɢᴇᴛᴅᴘ <ɴᴜᴍ> →* ┣ ᴘʀᴏꜰɪʟᴇ ᴘɪᴄ
┢━━━━━━━━━━━━━━━━━━━━➢
┡🔗 𝑾ʜᴀᴛꜱᴀᴘᴘ
*│ 🔗 .ᴘᴀɪʀ <ɴᴜᴍ> →* ┣ ᴘᴀɪʀ ꜱᴇꜱꜱɪᴏɴ
*│ 🆔 .ᴊɪᴅ →* ┣ ɢᴇᴛ ᴄʜᴀᴛ ᴊɪᴅ
*│ 📡 .ᴄɪᴅ <ʟɪɴᴋ> →* ┣ ᴄʜᴀɴɴᴇʟ ɪɴꜰᴏ
╰━━━━━━━━━━━━━━━━━━━┈⊷`;
                    await socket.sendMessage(sender, {
                        image: { url: 'https://files.catbox.moe/2fzvp7.jpg' },
                        caption: kariyane,
                        contextInfo: {
                            externalAdReply: {
                                title: 'ᴍᴜʟᴛɪ ᴅᴇᴠɪᴄᴇ ᴍɪɴɪ ᴡʜᴀᴛꜱᴀᴘᴘ ʙᴏᴛ',
                                body: '𝙻𝚄𝙲𝙸𝙵𝙴𝚁-x-ᴍɪɴɪ-ᴠ1',
                                mediaType: 1,
                                sourceUrl: 'https://hashen-mini-bot.onrender.com/',
                                thumbnailUrl: 'https://files.catbox.moe/2fzvp7.jpg',
                                renderLargerThumbnail: false,
                                showAdAttribution: false
                            }
                        }
                    });
                    break;
                }

                case 'song': {
                    try {
                        const text = args.join(' ');
                        if (!text) return await socket.sendMessage(sender, { text: '🎶 *කරුණාකර සිංදුවක නමක් ලබා දෙන්න!*' });
                        const search = await yts(text);
                        if (!search || !search.videos.length) return await socket.sendMessage(sender, { text: '❌ කිසිවක් හමුනොවුණා.' });
                        const video = search.videos[0];
                        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });
                        const apiUrl = `https://ytmp333-chama-woad.vercel.app/api/ytdl?url=${encodeURIComponent(video.url)}`;
                        const apiResponse = await axios.get(apiUrl);
                        if (!apiResponse.data || !apiResponse.data.success) {
                            return await socket.sendMessage(sender, { text: '❌ API එක හරහා ගීතය ලබා ගැනීමට නොහැකි වුණා.' });
                        }
                        const downloadUrl = apiResponse.data.download;
                        const songTitle = apiResponse.data.title || video.title;
                        const filePath = path.join(os.tmpdir(), `${Date.now()}.mp3`);
                        const caption = `╭───────────────╮\n🎶 *Title:* ${songTitle}\n⏱️ *Duration:* ${video.timestamp}\n👁️ *Views:* ${video.views}\n🔗 *Link:* ${video.url}\n╰───────────────╯\n\n> © 𝙻𝚄𝙲𝙸𝙵𝙴𝚁-x-ᴍɪɴɪ ʙᴏᴛ`;
                        await socket.sendMessage(sender, { image: { url: video.thumbnail }, caption }, { quoted: msg });
                        const response = await axios({ method: 'get', url: downloadUrl, responseType: 'stream' });
                        const writer = fs.createWriteStream(filePath);
                        response.data.pipe(writer);
                        writer.on('finish', async () => {
                            await socket.sendMessage(sender, { audio: { url: filePath }, mimetype: 'audio/mpeg', fileName: `${songTitle}.mp3` }, { quoted: msg });
                            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                        });
                        writer.on('error', (err) => {
                            console.error(err);
                            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                        });
                    } catch (e) {
                        console.error(e);
                        await socket.sendMessage(sender, { text: '❌ ERROR: ' + e.message });
                    }
                    break;
                }

                case 'ping': {
                    const inital = new Date().getTime();
                    let ping = await socket.sendMessage(sender, { text: '*_Pinging to Module..._* ❗' });
                    const final = new Date().getTime();
                    await socket.sendMessage(sender, { text: '《 █▒▒▒▒▒▒▒▒▒▒▒》10%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '《 ████▒▒▒▒▒▒▒▒》30%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '《 ███████▒▒▒▒▒》50%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '《 ██████████▒▒》80%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '《 ████████████》100%', edit: ping.key });
                    await socket.sendMessage(sender, { text: `❗ *Pong ${final - inital} Ms*`, edit: ping.key });
                    break;
                }

                case 'owner': {
                    await socket.sendMessage(sender, { react: { text: '👤', key: msg.key } });
                    await socket.sendMessage(sender, {
                        contacts: {
                            displayName: 'My Contacts',
                            contacts: [{
                                vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:Sandaru Udan\nTEL;TYPE=Owner,VOICE:+94765634418\nEND:VCARD'
                            }]
                        }
                    });
                    break;
                }

                case 'fb':
                case 'fbdl':
                case 'facebook': {
                    try {
                        const fbUrl = args.join(' ');
                        if (!fbUrl) return await socket.sendMessage(sender, { text: '*Please provide a Facebook video URL.*' }, { quoted: msg });
                        const apiUrl = `https://api.nexoracle.com/downloader/facebook?apikey=e276311658d835109c&url=${encodeURIComponent(fbUrl)}`;
                        const response = await axios.get(apiUrl);
                        if (!response.data?.result?.sd) return await socket.sendMessage(sender, { text: '*❌ Invalid or unsupported Facebook video URL.*' }, { quoted: msg });
                        await socket.sendMessage(sender, { video: { url: response.data.result.sd }, caption: `*❒🚀 𝙻𝚄𝙲𝙸𝙵𝙴𝚁-X-FB VIDEO DL 🚀❒*` });
                    } catch (error) {
                        console.error('Facebook DL error:', error);
                        await socket.sendMessage(sender, { text: '❌ Unable to download the Facebook video.' }, { quoted: msg });
                    }
                    break;
                }

                case 'system': {
                    const title = '*❗ ꜱʏꜱᴛᴇᴍ ɪɴꜰᴏ ❗*';
                    const content = `
  ◦ *Runtime*: ${runtime(process.uptime())}
  ◦ *Total Ram*: ${Math.floor(os.totalmem() / 1024 / 1024)}MB
  ◦ *Free Ram*: ${Math.floor(os.freemem() / 1024 / 1024)}MB
  ◦ *CPU Speed*: ${os.cpus()[0].speed / 1000} GHz
  ◦ *CPU Cores*: ${os.cpus().length}`;
                    await socket.sendMessage(sender, {
                        image: { url: 'https://files.catbox.moe/2fzvp7.jpg' },
                        caption: formatMessage(title, content, config.BOT_FOOTER)
                    });
                    break;
                }

                case 'npm': {
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]npm\s*/i, '').trim();
                    if (!q) return await socket.sendMessage(sender, { text: '📦 *Usage:* .npm <package-name>' }, { quoted: msg });
                    try {
                        await socket.sendMessage(sender, { text: `🔎 Searching npm for: *${q}*` }, { quoted: msg });
                        const { data } = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(q)}`);
                        const latestVersion = data['dist-tags']?.latest || 'N/A';
                        const description = data.description || 'No description available.';
                        const license = data.license || 'Unknown';
                        const repository = data.repository ? data.repository.url.replace('git+', '').replace('.git', '') : 'Not available';
                        await socket.sendMessage(sender, {
                            text: `📦 *NPM Package Search*\n\n🔰 *Package:* ${q}\n📄 *Description:* ${description}\n⏸️ *Latest Version:* ${latestVersion}\n🪪 *License:* ${license}\n🪩 *Repository:* ${repository}\n🔗 *NPM URL:* https://www.npmjs.com/package/${q}`
                        }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '❌ Package not found or error occurred.' }, { quoted: msg });
                    }
                    break;
                }

                case 'tiktokstalk':
                case 'tstalk':
                case 'ttstalk': {
                    try {
                        const username = args[0];
                        if (!username) return await socket.sendMessage(sender, { text: '❎ Please provide a TikTok username.\n\nExample: *.tiktokstalk username*' }, { quoted: msg });
                        await socket.sendMessage(sender, { react: { text: '📱', key: msg.key } });
                        const { data } = await axios.get(`https://www.tikwm.com/api/user/info/?unique_id=@${encodeURIComponent(username)}`);
                        if (data.code !== 0 || !data.data) return await socket.sendMessage(sender, { text: '❌ Could not fetch profile.' }, { quoted: msg });
                        const user = data.data.user;
                        const stats = data.data.stats;
                        const caption = `🎭 *TikTok Profile Viewer* 🎭\n\n👤 *Username:* @${user.uniqueId}\n📛 *Nickname:* ${user.nickname}\n📝 *Bio:* ${user.signature || 'No bio'}\n🔒 *Private:* ${user.privateAccount ? 'Yes' : 'No'}\n\n📊 *Statistics*\n👥 Followers: ${stats.followerCount.toLocaleString()}\n👤 Following: ${stats.followingCount.toLocaleString()}\n❤️ Likes: ${stats.heartCount.toLocaleString()}\n🎥 Videos: ${stats.videoCount.toLocaleString()}\n\n> *© 𝙻𝚄𝙲𝙸𝙵𝙴𝚁-x-ᴍɪɴɪ ʙᴏᴛ*`;
                        await socket.sendMessage(sender, { image: { url: user.avatarLarger }, caption }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '⚠️ Something went wrong fetching TikTok data.' }, { quoted: msg });
                    }
                    break;
                }

                case 'dailyfact': {
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]dailyfact\s*/i, '').trim().toLowerCase();
                    if (q === 'on') {
                        if (isFactEnabled) return await socket.sendMessage(sender, { text: '❌ Daily fact is already enabled.' }, { quoted: msg });
                        isFactEnabled = true;
                        await socket.sendMessage(sender, { text: '✅ Daily fact enabled.' }, { quoted: msg });
                    } else if (q === 'off') {
                        if (!isFactEnabled) return await socket.sendMessage(sender, { text: '❌ Daily fact is already disabled.' }, { quoted: msg });
                        if (factTimer) clearInterval(factTimer);
                        isFactEnabled = false;
                        await socket.sendMessage(sender, { text: '❌ Daily fact disabled.' }, { quoted: msg });
                    } else {
                        await socket.sendMessage(sender, { text: "❌ Please specify 'on' or 'off'. Example: `.dailyfact on`" }, { quoted: msg });
                    }
                    break;
                }

                case 'apk': {
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]apk\s*/i, '').trim();
                    if (!q) return await socket.sendMessage(sender, { text: '*🔍 Please provide an app name.*\n\nUsage: .apk Instagram' }, { quoted: msg });
                    try {
                        await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
                        const response = await axios.get(`http://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(q)}/limit=1`);
                        const data = response.data;
                        if (!data.datalist?.list?.length) return await socket.sendMessage(sender, { text: '❌ *No APK found.*' }, { quoted: msg });
                        const app = data.datalist.list[0];
                        const caption = `🎮 *App Name:* ${app.name}\n📦 *Package:* ${app.package}\n📅 *Updated:* ${app.updated}\n📁 *Size:* ${(app.size / (1024 * 1024)).toFixed(2)} MB\n\n> 𝐏ᴏᴡᴇʀᴅ ʙʏ 𝐋𝐔𝐂𝐈𝐅𝐄𝐑 ❗`;
                        await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });
                        await socket.sendMessage(sender, {
                            document: { url: app.file.path_alt },
                            fileName: `${app.name}.apk`,
                            mimetype: 'application/vnd.android.package-archive',
                            caption
                        }, { quoted: msg });
                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                    } catch (e) {
                        await socket.sendMessage(sender, { text: `❌ Error: ${e.message}` }, { quoted: msg });
                    }
                    break;
                }

                case 'boom': {
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '');
                    const parts = q.replace(/^[.\/!]boom\s*/i, '').split(',').map(x => x?.trim());
                    const [target, bombText, countRaw] = parts;
                    const count = parseInt(countRaw) || 5;
                    if (!target || !bombText) return await socket.sendMessage(sender, { text: '📌 *Usage:* .boom <number>,<message>,<count>' }, { quoted: msg });
                    if (count > 20) return await socket.sendMessage(sender, { text: '❌ Limit is 20 messages.' }, { quoted: msg });
                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(jid, { text: bombText });
                        await delay(700);
                    }
                    await socket.sendMessage(sender, { text: `✅ Bomb sent to ${target} — ${count}x` }, { quoted: msg });
                    break;
                }

                case 'pair': {
                    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]pair\s*/i, '').trim();
                    if (!q) return await socket.sendMessage(sender, { text: '*📌 Usage:* .pair +94765634418' }, { quoted: msg });
                    try {
                        const response = await fetch(`https://dinu-3ab31409578e.herokuapp.com/code?number=${encodeURIComponent(q)}`);
                        const bodyText = await response.text();
                        let result;
                        try { result = JSON.parse(bodyText); } catch (e) {
                            return await socket.sendMessage(sender, { text: '❌ Invalid response from server.' }, { quoted: msg });
                        }
                        if (!result?.code) return await socket.sendMessage(sender, { text: '❌ Failed to retrieve pairing code.' }, { quoted: msg });
                        await socket.sendMessage(sender, { text: `*01 📋 Copy This Code*\n*02 🔗 Go to Link Device*\n*03 ✂️ Paste the Code*\n\n*🔑 Your pairing code is:* ${result.code}` }, { quoted: msg });
                        await sleep(2000);
                        await socket.sendMessage(sender, { text: `${result.code}` }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '❌ An error occurred. Please try again.' }, { quoted: msg });
                    }
                    break;
                }

                case 'jid': {
                    await socket.sendMessage(sender, { text: `${sender}` });
                    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                    break;
                }

                case 'ai': {
                    const GEMINI_API_KEY = 'AIzaSyBdBivCo6jWSchTb8meP7VyxbHpoNY_qfQ';
                    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]ai\s*/i, '').trim();
                    if (!q) return await socket.sendMessage(sender, { text: 'Hy i am Freedom ai ❗' }, { quoted: msg });
                    const prompt = `ඔබ සැබෑ ගැහැනු ලමයෙකු මෙන් හැසිරිය යුතුය. User Message: ${q}`;
                    try {
                        const response = await axios.post(GEMINI_API_URL, { contents: [{ parts: [{ text: prompt }] }] }, { headers: { 'Content-Type': 'application/json' } });
                        const aiResponse = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (!aiResponse) return await socket.sendMessage(sender, { text: '❌ Error.' }, { quoted: msg });
                        await socket.sendMessage(sender, { text: aiResponse }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '❌Error' }, { quoted: msg });
                    }
                    break;
                }

                case 'cid': {
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]cid\s*/i, '').trim();
                    if (!q) return await socket.sendMessage(sender, { text: '❎ Please provide a WhatsApp Channel link.' }, { quoted: msg });
                    const match = q.match(/whatsapp\.com\/channel\/([\w-]+)/);
                    if (!match) return await socket.sendMessage(sender, { text: '⚠️ Invalid channel link format.' }, { quoted: msg });
                    try {
                        const metadata = await socket.newsletterMetadata('invite', match[1]);
                        if (!metadata?.id) return await socket.sendMessage(sender, { text: '❌ Channel not found.' }, { quoted: msg });
                        const infoText = `📡 *WhatsApp Channel Info*\n\n🆔 *ID:* ${metadata.id}\n📌 *Name:* ${metadata.name}\n👥 *Followers:* ${metadata.subscribers?.toLocaleString() || 'N/A'}`;
                        if (metadata.preview) {
                            await socket.sendMessage(sender, { image: { url: `https://pps.whatsapp.net${metadata.preview}` }, caption: infoText }, { quoted: msg });
                        } else {
                            await socket.sendMessage(sender, { text: infoText }, { quoted: msg });
                        }
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '⚠️ Error fetching channel info.' }, { quoted: msg });
                    }
                    break;
                }

                case 'getdp':
                case 'getpp':
                case 'getprofile': {
                    if (!args[0]) return await socket.sendMessage(sender, { text: '🔥 Please provide a phone number\n\nExample: .getdp 94765634418' }, { quoted: msg });
                    const targetJid = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    try {
                        const ppUrl = await socket.profilePictureUrl(targetJid, 'image');
                        await socket.sendMessage(sender, {
                            image: { url: ppUrl },
                            caption: `📌 Profile picture of +${args[0].replace(/[^0-9]/g, '')}`
                        }, { quoted: msg });
                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                    } catch (e) {
                        await socket.sendMessage(sender, { text: '🖼️ No profile picture or cannot be accessed!' }, { quoted: msg });
                    }
                    break;
                }

                case 'tiktok':
                case 'ttdl':
                case 'tt':
                case 'tiktokdl': {
                    try {
                        const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
                        const link = q.replace(/^[.\/!](tiktok(dl)?|tt(dl)?)\s*/i, '').trim();
                        if (!link) return await socket.sendMessage(sender, { text: '📌 *Usage:* .tiktok <link>' }, { quoted: msg });
                        if (!link.includes('tiktok.com')) return await socket.sendMessage(sender, { text: '❌ Invalid TikTok link.' }, { quoted: msg });
                        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });
                        const { data } = await axios.get(`https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(link)}`);
                        if (!data?.status || !data?.data) return await socket.sendMessage(sender, { text: '❌ වීඩියෝව සොයාගත නොහැකි විය.' }, { quoted: msg });
                        const { title, like, comment, share, author, meta } = data.data;
                        const video = meta?.media?.find(v => v.type === 'video');
                        if (!video?.org) return await socket.sendMessage(sender, { text: '❌ Download URL not found.' }, { quoted: msg });
                        const caption = `╭───────────────╮\n🎵 *LUCIFER-MD TIKTOK* 🎵\n\n👤 *User:* ${author.nickname}\n📖 *Title:* ${title || 'No Title'}\n👍 *Likes:* ${like}\n╰───────────────╯\n\n> *© 𝙻𝚄𝙲𝙸𝙵𝙴𝚁-x-ᴍɪɴɪ ʙᴏᴛ*`;
                        await socket.sendMessage(sender, { video: { url: video.org }, caption }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: `❌ *ERROR:* ${err.message}` }, { quoted: msg });
                    }
                    break;
                }

                case 'google':
                case 'gsearch':
                case 'search': {
                    if (!args.length) return await socket.sendMessage(sender, { text: '⚠️ Please provide a search query.' }, { quoted: msg });
                    try {
                        const query = args.join(' ');
                        const apiUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=AIzaSyDMbI3nvmQUrfjoCJYLS69Lej1hSXQjnWI&cx=baf9bdb0c631236e5`;
                        const response = await axios.get(apiUrl);
                        if (!response.data?.items?.length) return await socket.sendMessage(sender, { text: `⚠️ No results found for: ${query}` }, { quoted: msg });
                        let results = `🔍 *Google Search Results for:* "${query}"\n\n`;
                        response.data.items.slice(0, 5).forEach((item, index) => {
                            results += `*${index + 1}. ${item.title}*\n🔗 ${item.link}\n📝 ${item.snippet}\n\n`;
                        });
                        const thumbUrl = response.data.items[0].pagemap?.cse_image?.[0]?.src || 'https://files.catbox.moe/2fzvp7.jpg';
                        await socket.sendMessage(sender, { image: { url: thumbUrl }, caption: results.trim() }, { quoted: msg });
                    } catch (error) {
                        await socket.sendMessage(sender, { text: `⚠️ Search error: ${error.message}` }, { quoted: msg });
                    }
                    break;
                }

                default:
                    break;
            }
        } catch (err) {
            console.error('Command handler error:', err);
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;
        if (autoReact === 'on') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

async function deleteSessionFromMongo(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        await db.collection('sessions').deleteOne({ number: sanitizedNumber });
    } catch (error) {
        console.error('Failed to delete session from MongoDB:', error);
    }
}

async function renameCredsOnLogout(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        const count = (await db.collection('sessions').countDocuments({ active: false })) + 1;
        await db.collection('sessions').updateOne(
            { number: sanitizedNumber },
            { $rename: { creds: `delete_creds${count}` }, $set: { active: false } }
        );
    } catch (error) {
        console.error('Failed to rename creds on logout:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        const doc = await db.collection('sessions').findOne({ number: sanitizedNumber, active: true });
        if (!doc) return null;
        return JSON.parse(doc.creds);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

function setupAutoRestart(socket, number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            activeSockets.delete(sanitizedNumber);
            socketCreationTime.delete(sanitizedNumber);
            if (statusCode === 401) {
                await renameCredsOnLogout(number);
            } else {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    await initUserEnvIfMissing(sanitizedNumber);
    await initEnvsettings(sanitizedNumber);

    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        await fs.ensureDir(sessionPath);
        await fs.writeFile(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());
        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) res.send({ code });
        } else {
            if (!res.headersSent) res.send({ status: 'already_paired', message: 'Session restored and connecting' });
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            const db = await initMongo();
            await db.collection('sessions').updateOne(
                { number: sanitizedNumber },
                { $set: { sessionId: uuidv4(), number: sanitizedNumber, creds: fileContent, active: true, updatedAt: new Date() } },
                { upsert: true }
            );
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);
                    const groupResult = await joinGroup(socket);
                    try {
                        await socket.newsletterFollow(config.NEWSLETTER_JID);
                        await socket.sendMessage(config.NEWSLETTER_JID, { react: { text: '❤️', key: { id: config.NEWSLETTER_MESSAGE_ID } } });
                    } catch (error) {
                        console.error('Newsletter error:', error.message);
                    }
                    activeSockets.set(sanitizedNumber, socket);
                    await socket.sendMessage(userJid, {
                        image: { url: config.IMAGE_PATH },
                        caption: formatMessage(
                            '*ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴍꜱɢ*',
                            `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}`,
                            '╾╾╾'
                        )
                    });
                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);
                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
    }
}

router.get('/', async (req, res) => {
    const { number, force } = req.query;
    if (!number) return res.status(400).send({ error: 'Number parameter is required' });
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    if (activeSockets.has(sanitizedNumber)) return res.status(200).send({ status: 'already_connected' });
    if (force === 'true') {
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        await deleteSessionFromMongo(sanitizedNumber);
        if (fs.existsSync(sessionPath)) await fs.remove(sessionPath);
    }
    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({ count: activeSockets.size, numbers: Array.from(activeSockets.keys()) });
});

router.get('/ping', (req, res) => {
    res.status(200).send({ status: 'active', message: 'BOT is running', activesession: activeSockets.size });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) return res.status(404).send({ error: 'No numbers found' });
        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        const results = [];
        const promises = numbers.map(number => {
            if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); return; }
            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            return EmpirePair(number, mockRes).then(() => results.push({ number, status: 'initiated' })).catch(e => results.push({ number, status: 'failed', error: e.message }));
        });
        await Promise.all(promises);
        res.status(200).send({ status: 'success', connections: results });
    } catch (error) {
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const db = await initMongo();
        const docs = await db.collection('sessions').find({ active: true }).toArray();
        if (!docs.length) return res.status(404).send({ error: 'No active sessions found' });
        const results = [];
        const promises = docs.map(doc => {
            if (activeSockets.has(doc.number)) { results.push({ number: doc.number, status: 'already_connected' }); return; }
            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            return EmpirePair(doc.number, mockRes).then(() => results.push({ number: doc.number, status: 'initiated' })).catch(e => results.push({ number: doc.number, status: 'failed', error: e.message }));
        });
        await Promise.all(promises);
        res.status(200).send({ status: 'success', connections: results });
    } catch (error) {
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) return res.status(400).send({ error: 'Number and target are required' });
    const socket = activeSockets.get(number.replace(/[^0-9]/g, ''));
    if (!socket) return res.status(404).send({ error: 'No active session found' });
    try {
        const statusData = await socket.fetchStatus(`${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`);
        res.status(200).send({ status: 'success', number: target, about: statusData.status || 'No status' });
    } catch (error) {
        res.status(500).send({ status: 'error', message: error.message });
    }
});

process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        try { socket.ws.close(); } catch (e) {}
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    client.close();
});

process.on('uncaughtException', async (err) => {
    console.error('Uncaught exception:', err);
});

(async () => {
    try {
        await initMongo();
        const docs = await db.collection('sessions').find({ active: true }).toArray();
        for (const doc of docs) {
            if (!activeSockets.has(doc.number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(doc.number, mockRes);
            }
        }
        console.log('Auto-reconnect completed on startup');
    } catch (error) {
        console.error('Failed to auto-reconnect on startup:', error);
    }
})();

module.exports = router;

