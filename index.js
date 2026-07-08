import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { SubBots } from 'meowsab';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';

dotenv.config();

const configData = {
  BOT_NAME: process.env.BOT_NAME || '⏧𝕱ɪᴋᴛᴀᴛᴜʀ',
  RIGHTS: process.env.RIGHTS || '⏧𝕱ɪᴋᴛᴀᴛᴜʀ',
  DEVELOPER: process.env.DEVELOPER || '⏧𝕱ɪᴋᴛᴀᴛᴜʀ',
  PASSWORD: process.env.PASSWORD || 'Fiktator',
  PREFIX: process.env.PREFIX || '.',
  CHANNEL_JID: process.env.CHANNEL_JID || '120363409838303399@newsletter',
  CHANNEL_URL: process.env.CHANNEL_URL || 'https://whatsapp.com/channel/0029Vb8QtAcCHDynKvfaS93T',
  WELCOME_IMAGES: [
    process.env.WELCOME_IMAGE_1 || 'https://i.ibb.co/30B3jP0/1000490440.jpg',
    process.env.WELCOME_IMAGE_2 || 'https://i.ibb.co/C0WbLzD/1000490439.jpg',
    process.env.WELCOME_IMAGE_3 || 'https://i.ibb.co/sK08rZp/1000490442.jpg'
  ],
  FOCUS_SECTION: 'الأرقام',
  OUTPUT_DIR: './output',
  UPLOAD_DIR: './uploads'
};

const owners = [
  {
    name: '⏧𝕱ɪᴋᴛᴀᴛᴜʀ',
    lid: '90452816580615@lid',
    jid: '967737116116@s.whatsapp.net'
  },
  {
    name: '⏧𝕱ɪᴋᴛᴀᴛᴜʀ',
    lid: '96169082515632@lid',
    jid: '967777019212@s.whatsapp.net'
  }
];

function isOwner(jid) {
  return owners.some(o => o.jid === jid || o.lid === jid);
}

function ensureDirs() {
  for (const dir of [configData.OUTPUT_DIR, configData.UPLOAD_DIR, './logs']) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeNumber(num) {
  let n = String(num || '').replace(/[^d+]/g, '');
  if (n.startsWith('00')) n = '+' + n.slice(2);
  if (!n.startsWith('+')) n = '+' + n.replace(/^0+/, '');
  return n;
}

function extractNumbersFromText(text) {
  const matches = String(text || '').match(/+?d[ds-]{6,}d/g) || [];
  return [...new Set(matches.map(normalizeNumber))];
}

function isPatternNumber(num) {
  const s = String(num).replace(/D/g, '');
  if (!s) return false;
  if (/(.)\u0001{4,}/.test(s)) return true;
  if (/(.)\u0001{2,}/.test(s)) return true;
  if (/12345|23456|34567|45678|56789/.test(s)) return true;
  if (/(d{2})\u0001{2,}/.test(s)) return true;
  return false;
}

function scorePattern(num) {
  const s = String(num).replace(/D/g, '');
  let score = 0;
  const repeats = s.match(/(.)\u0001+/g) || [];
  for (const r of repeats) score += r.length * 10;
  if (/12345|23456|34567|45678|56789/.test(s)) score += 50;
  if (/(d{2})\u0001{2,}/.test(s)) score += 40;
  return score;
}

async function downloadDocumentBuffer(msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const doc = msg.message?.documentMessage || quoted?.documentMessage;
  if (!doc) return null;

  const stream = await downloadContentFromMessage(doc, 'document');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function saveIncomingTextFile(msg) {
  const doc = msg.message?.documentMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage;
  if (!doc) return null;

  fs.mkdirSync(configData.UPLOAD_DIR, { recursive: true });
  const fileName = doc.fileName || `input_${Date.now()}.txt`;
  const outPath = path.join(configData.UPLOAD_DIR, fileName);

  const buffer = await downloadDocumentBuffer(msg);
  if (!buffer) return null;

  fs.writeFileSync(outPath, buffer);
  return outPath;
}

let stopScan = false;
let scanPaused = false;
let pauseTimer = null;
const scanWindow = [];
const MAX_SCAN_REQ = 4;
const SCAN_PERIOD_MS = 1000;

function requestStop() {
  stopScan = true;
}

function resetStop() {
  stopScan = false;
}

function pauseScan(ms = 10 * 60 * 1000) {
  scanPaused = true;
  if (pauseTimer) clearTimeout(pauseTimer);
  pauseTimer = setTimeout(() => {
    scanPaused = false;
    pauseTimer = null;
  }, ms);
}

function isPaused() {
  return scanPaused;
}

async function waitTurn() {
  const now = Date.now();
  while (scanWindow.length && now - scanWindow[0] > SCAN_PERIOD_MS) scanWindow.shift();

  if (scanWindow.length < MAX_SCAN_REQ) {
    scanWindow.push(Date.now());
    return;
  }

  const wait = Math.max(0, SCAN_PERIOD_MS - (now - scanWindow[0]));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  return waitTurn();
}

function saveList(fileName, arr) {
  fs.mkdirSync(path.dirname(fileName), { recursive: true });
  fs.writeFileSync(fileName, arr.join('
') + (arr.length ? '
' : ''), 'utf8');
}

async function scanNumbers(sock, numbers, onProgress, onPauseNotify) {
  const found = [];
  const notFound = [];
  const stats = { checked: 0, found: 0, notFound: 0, stopped: false, errors: 0 };
  stopScan = false;

  for (const raw of numbers) {
    if (stopScan || isPaused()) {
      stats.stopped = true;
      break;
    }

    await waitTurn();
    await new Promise(r => setTimeout(r, 120 + Math.floor(Math.random() * 280)));

    const jid = normalizeNumber(raw).replace('+', '') + '@s.whatsapp.net';
    stats.checked++;

    try {
      const res = await sock.onWhatsApp(jid);
      if (res?.[0]?.exists) {
        found.push(raw);
        stats.found++;
      } else {
        notFound.push(raw);
        stats.notFound++;
      }
    } catch (error) {
      stats.errors++;
      notFound.push(raw);

      if (stats.errors >= 5) {
        pauseScan(10 * 60 * 1000);
        stats.stopped = true;
        if (onPauseNotify) {
          await onPauseNotify('⏸️ تم إيقاف الفحص مؤقتًا بسبب كثرة الأخطاء. سيتم الاستئناف تلقائيًا لاحقًا.');
        }
        break;
      }
    }

    if (onProgress) await onProgress(stats);
  }

  return { found, notFound, stats };
}

async function handleNumberCommand(sock, msg, cmd, args) {
  const jid = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;

  if (!isOwner(sender)) {
    return sock.sendMessage(jid, { text: 'هذا القسم خاص بالمطور فقط.' }, { quoted: msg });
  }

  if (cmd === 'خلاص') {
    requestStop();
    return sock.sendMessage(jid, { text: '⏹️ تم إيقاف الفحص الحالي.' }, { quoted: msg });
  }

  const filePath = await saveIncomingTextFile(msg);
  if (!filePath && cmd !== 'خلاص') {
    return sock.sendMessage(jid, { text: 'الرجاء الرد على ملف txt أولاً.' }, { quoted: msg });
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const allNumbers = extractNumbersFromText(content);

  if (cmd === 'فك') {
    const outPath = path.join(configData.OUTPUT_DIR, 'numbers_with_plus.txt');
    const out = allNumbers.map(n => (n.startsWith('+') ? n : `+${n.replace(/D/g, '')}`));
    saveList(outPath, out);

    return sock.sendMessage(
      jid,
      {
        document: fs.readFileSync(outPath),
        fileName: 'numbers_with_plus.txt',
        mimetype: 'text/plain',
        caption: `✅ تم استخراج ${out.length} رقم.`
      },
      { quoted: msg }
    );
  }

  if (cmd === 'مميز') {
    const map = new Map();

    for (const n of allNumbers) {
      if (isPatternNumber(n)) map.set(n, (map.get(n) || 0) + 1);
    }

    const data = [...map.entries()]
      .map(([num, count]) => ({ num, count, score: scorePattern(num) }))
      .sort((a, b) => b.score - a.score || b.count - a.count);

    const txt = data.length
      ? data.map((x, i) => `${i + 1}. ${x.num} | تكرار: ${x.count} | نقاط: ${x.score}`).join('
')
      : 'لا توجد أرقام مميزة.';

    return sock.sendMessage(jid, { text: txt }, { quoted: msg });
  }

  if (cmd === 'قص') {
    const prefix = args.join(' ').trim();
    if (!prefix) {
      return sock.sendMessage(jid, { text: 'اكتب البادئة المطلوبة مثل: .قص 96659' }, { quoted: msg });
    }

    const cut = [...new Set(allNumbers.filter(n => n.replace(/D/g, '').startsWith(prefix)))];
    const outPath = path.join(configData.OUTPUT_DIR, `cut_${prefix}.txt`);
    saveList(outPath, cut);

    return sock.sendMessage(
      jid,
      {
        document: fs.readFileSync(outPath),
        fileName: `cut_${prefix}.txt`,
        mimetype: 'text/plain',
        caption: `✅ تم قص ${cut.length} رقم يبدأ بـ ${prefix}`
      },
      { quoted: msg }
    );
  }

  if (cmd === 'فحص') {
    resetStop();

    const result = await scanNumbers(
      sock,
      allNumbers,
      async (stats) => {
        if (stats.checked % 20 === 0) {
          await sock.sendMessage(
            jid,
            {
              text: `⏳ جارٍ الفحص...
تم فحص: ${stats.checked}
موجود: ${stats.found}
غير موجود: ${stats.notFound}`
            },
            { quoted: msg }
          );
        }
      },
      async (note) => {
        await sock.sendMessage(jid, { text: note }, { quoted: msg });
      }
    );

    const outPath = path.join(configData.OUTPUT_DIR, 'الأرقام_غير_الموجودة.txt');
    saveList(outPath, result.notFound);

    return sock.sendMessage(
      jid,
      {
        text: `✅ انتهى الفحص.
تم فحص: ${result.stats.checked}
موجودة: ${result.stats.found}
غير موجودة: ${result.stats.notFound}
${result.stats.stopped ? '⏹️ تم الإيقاف/التبريد مؤقتًا.' : ''}`
      },
      { quoted: msg }
    );
  }
}

function getMessageText(msg) {
  if (!msg.message) return null;
  if (msg.message.conversation) return msg.message.conversation;
  if (msg.message.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
  if (msg.message.imageMessage?.caption) return msg.message.imageMessage.caption;
  if (msg.message.videoMessage?.caption) return msg.message.videoMessage.caption;
  return msg.body || null;
}

async function main(client) {
  ensureDirs();

  global.subBots = new SubBots(client.commandSystem);
  SubBots.pariCode(configData.PASSWORD);

  const { config } = client;

  await global.subBots.setConfig({
    commandsPath: config.commandsPath || './plugins',
    owners,
    prefix: config.prefix || configData.PREFIX,
    info: {
      ...(config.info || {}),
      name: configData.BOT_NAME,
      rights: configData.RIGHTS,
      developer: configData.DEVELOPER,
      password: configData.PASSWORD,
      focusSection: configData.FOCUS_SECTION,
      channelJid: configData.CHANNEL_JID,
      channelUrl: configData.CHANNEL_URL,
      welcomeImages: configData.WELCOME_IMAGES
    },
    printQR: false
  });

  global.subBots.on('error', (uid, error) => {
    console.error(`❌ [SubBot ${uid}] Error:`, error?.message || error);
  });

  const loadedCount = await global.subBots.load();
  console.log(`✅ Loaded ${loadedCount} saved bots`);

  global.subBots.on('ready', async (uid) => {
    console.log(`✅ [SubBot ${uid}] Connected!`);
  });

  global.subBots.on('pair', (uid, code) => {
    console.log(`🔐 [SubBot ${uid}] Pairing code: ${code}`);
  });

  global.subBots.on('message', async (uid, msg) => {
    if (msg.key?.id?.includes('3EB0')) return;

    const body = getMessageText(msg);
    const bot = global.subBots.get(uid);
    const sock = bot?.sock;
    if (!sock || !body) return;

    try {
      const clean = body.trim();
      const withoutPrefix = clean.startsWith('.') ? clean.slice(1) : clean;
      const cmd = withoutPrefix.split(/s+/)[0];
      const args = withoutPrefix.split(/s+/).slice(1);

      if (clean === 'تست') {
        await sock.sendMessage(msg.key.remoteJid, {
          react: { text: '✅', key: msg.key }
        });
      }

      if (clean === 'اوامر' || clean === '.اوامر' || clean === 'بوت') {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            image: { url: configData.WELCOME_IMAGES[0] },
            caption: `*مرحباً بك يا @${msg.pushName || 'User'} 👋*

اهلاً وسهلاً بك في بوت ${configData.RIGHTS} نواتك الرقميه في المهام المطوره،

👑 *الحقوق:* ${configData.RIGHTS}
📡 *قناة البوت:* ${configData.CHANNEL_URL}
🆔 *قناة البوت:* ${configData.CHANNEL_JID}

📌 *القسم الأساسي:* ${configData.FOCUS_SECTION}
- .فك
- .مميز
- .قص
- .فحص
- .خلاص

> اضغط على زر القسم لعرض الاوامر
بوت ${configData.RIGHTS}`,
            mentions: [msg.key.participant || msg.key.remoteJid]
          },
          { quoted: msg }
        );
      }

      if (['فك', 'مميز', 'قص', 'فحص', 'خلاص'].includes(cmd)) {
        return handleNumberCommand(sock, msg, cmd, args);
      }

      if ((body.includes('ستوري') || body.toLowerCase().includes('story')) && msg.key.remoteJid.endsWith('@g.us')) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: '⚠️ ممنوع ذكر الستوري داخل القروب.'
        }, { quoted: msg });
      }
    } catch (error) {
      console.error(`❌ [SubBot ${uid}] Send error:`, error?.message || error);
    }
  });

  global.subBots.on('close', (uid) => {
    console.log(`🔌 [SubBot ${uid}] Disconnected`);
  });

  global.subBots.on('badSession', (uid) => {
    console.log(`⚠️ [SubBot ${uid}] Bad session, removed`);
  });

  return global.subBots;
}

export default main;
