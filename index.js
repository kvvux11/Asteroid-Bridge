require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');

const { prisma } = require('./prisma');
const {
  sendRconCommand,
  getServerDetails,
  getPlayerList,
  getPlayerData,
} = require('./rcon');

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.BRIDGE_API_KEY || '';
const syncIntervalMs = Number(process.env.SYNC_INTERVAL_MS || 30000);
const commandDelayMs = Number(process.env.COMMAND_DELAY_MS || 1000);
const { handleCommand } = require('./commands');

const app = express();
app.use(express.json());

const logsDir = path.join(__dirname, 'logs');
const logFile = path.join(logsDir, 'bridge.log');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function log(message, extra = '') {
  const line = `[${new Date().toISOString()}] ${message}${extra ? ` ${extra}` : ''}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireApiKey(req, res, next) {
  if (!API_KEY || API_KEY === 'CHANGE_THIS_TO_A_LONG_SECRET') {
    return res.status(500).json({
      ok: false,
      error: 'Bridge API key is not configured',
    });
  }

  const provided = req.headers['x-api-key'];

  if (provided !== API_KEY) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid API key',
    });
  }

  next();
}

function validSteamId(steamId) {
  return /^\d{17,25}$/.test(String(steamId || '').trim());
}

function cleanValue(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\- .]/g, '')
    .slice(0, 120);
}

// =====================
// RCON COMMAND QUEUE
// =====================
const commandQueue = [];
let processingQueue = false;

function enqueueCommand(command, source = 'unknown') {
  const item = {
    id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    command,
    source,
    createdAt: Date.now(),
  };

  commandQueue.push(item);
  processCommandQueue();

  return item;
}

async function processCommandQueue() {
  if (processingQueue) return;

  processingQueue = true;

  while (commandQueue.length > 0) {
    const item = commandQueue.shift();

    try {
      log('[QUEUE] Sending command:', `${item.command} | source=${item.source}`);

      const response = await sendRconCommand(item.command);

      log('[QUEUE] Command response:', String(response).slice(0, 500));
    } catch (error) {
      log('[QUEUE] Command failed:', `${item.command} | ${error.message}`);
    }

    await sleep(commandDelayMs);
  }

  processingQueue = false;
}

// =====================
// PARSERS
// =====================
function parseServerDetails(detailsRaw) {
  const serverNameMatch = detailsRaw.match(/Server:\s*(.+)/i);
  const mapMatch = detailsRaw.match(/Map:\s*([^\|\n]+)/i);
  const playersMatch = detailsRaw.match(/Players:\s*(\d+)\s*\/\s*(\d+)/i);

  return {
    serverName: serverNameMatch?.[1]?.trim() || 'Asteroid',
    mapName: mapMatch?.[1]?.trim() || 'Gateway',
    playerCount: playersMatch ? Number(playersMatch[1]) : 0,
    maxPlayers: playersMatch ? Number(playersMatch[2]) : 0,
  };
}

function parsePlayerList(raw) {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const players = [];

  for (const line of lines) {
    const match = line.match(/^(.+?)\s*-\s*(\d{17,25})$/);

    if (match) {
      players.push({
        name: match[1].trim(),
        steamId: match[2].trim(),
      });
    }
  }

  return players;
}

function extractString(raw, pattern) {
  const re = new RegExp(pattern, 'i');
  const match = raw.match(re);

  return match?.[1]?.trim() || '';
}

function parseDecimalPercent(raw) {
  const n = Number.parseFloat(String(raw || '').trim());

  if (!Number.isFinite(n)) return null;

  return n * 100;
}

function parsePlayerData(raw, fallbackSteamId) {
  return {
    steamId: extractString(raw, String.raw`PlayerID:\s*([0-9]{17,25})`) || fallbackSteamId,
    name: extractString(raw, String.raw`Name:\s*([^,]+)`),
    className: extractString(raw, String.raw`Class:\s*([^,]+)`),
    growthPercent: parseDecimalPercent(extractString(raw, String.raw`Growth:\s*([0-9.]+)`)),
    healthPercent: parseDecimalPercent(extractString(raw, String.raw`Health:\s*([0-9.]+)`)),
    staminaPercent: parseDecimalPercent(extractString(raw, String.raw`Stamina:\s*([0-9.]+)`)),
    hungerPercent: parseDecimalPercent(extractString(raw, String.raw`Hunger:\s*([0-9.]+)`)),
    thirstPercent: parseDecimalPercent(extractString(raw, String.raw`Thirst:\s*([0-9.]+)`)),
    raw,
  };
}

// =====================
// DATABASE SYNC
// =====================
async function syncServerStatus() {
  try {
    const [detailsRaw, playerListRaw] = await Promise.all([
      getServerDetails(),
      getPlayerList(),
    ]);

    const details = parseServerDetails(detailsRaw);
    const players = parsePlayerList(playerListRaw);

    await prisma.serverStatus.upsert({
      where: { id: 'asteroid-server-status' },
      update: {
        isOnline: true,
        playerCount: details.playerCount,
        maxPlayers: details.maxPlayers,
        mapName: details.mapName,
      },
      create: {
        id: 'asteroid-server-status',
        isOnline: true,
        playerCount: details.playerCount,
        maxPlayers: details.maxPlayers,
        mapName: details.mapName,
      },
    });

    await prisma.user.updateMany({
      data: {
        isOnline: false,
        currentDinosaur: null,
        currentGrowthPercent: null,
      },
    });

    for (const player of players) {
      let parsed = null;

      try {
        const rawPlayerData = await getPlayerData(player.steamId);
        parsed = parsePlayerData(rawPlayerData, player.steamId);
      } catch (error) {
        log('[SYNC] getPlayerData failed:', `${player.steamId} | ${error.message}`);
      }

      await prisma.user.updateMany({
        where: { steamId: player.steamId },
        data: {
          isOnline: true,
          currentDinosaur: parsed?.className || null,
          currentGrowthPercent: parsed?.growthPercent ?? null,
        },
      });

      log(
        '[SYNC] Player:',
        `${player.steamId} ${parsed?.className || 'unknown'} ${parsed?.growthPercent ?? 'unknown'}%`
      );
    }

    log(
      '[SYNC]',
      `${details.serverName} | ${details.mapName} | ${details.playerCount}/${details.maxPlayers}`
    );
  } catch (error) {
    log('[SYNC] Failed:', error.message);

    await prisma.serverStatus.upsert({
      where: { id: 'asteroid-server-status' },
      update: {
        isOnline: false,
        playerCount: 0,
        maxPlayers: 0,
      },
      create: {
        id: 'asteroid-server-status',
        isOnline: false,
        playerCount: 0,
        maxPlayers: 0,
        mapName: null,
      },
    }).catch(() => null);
  }
}

// =====================
// HTTP API
// =====================
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    name: 'AsteroidBridge',
    queueLength: commandQueue.length,
    processingQueue,
    syncIntervalMs,
  });
});

app.post('/command', requireApiKey, (req, res) => {
  const command = cleanValue(req.body.command);

  if (!command) {
    return res.status(400).json({
      ok: false,
      error: 'Missing command',
    });
  }

  const queued = enqueueCommand(command, 'api:/command');

  res.json({
    ok: true,
    queued,
  });
});

app.post('/announce', requireApiKey, (req, res) => {
  const message = cleanValue(req.body.message);

  if (!message) {
    return res.status(400).json({
      ok: false,
      error: 'Missing message',
    });
  }

  const queued = enqueueCommand(`announce ${message}`, 'api:/announce');

  res.json({
    ok: true,
    queued,
  });
});

app.post('/redeem', requireApiKey, (req, res) => {
  const steamId = String(req.body.steamId || '').trim();
  const dino = cleanValue(req.body.dino);
  const redeemType = cleanValue(req.body.redeemType || 'NORMAL');

  if (!validSteamId(steamId)) {
    return res.status(400).json({ ok: false, error: 'Invalid steamId' });
  }

  if (!dino) {
    return res.status(400).json({ ok: false, error: 'Missing dino' });
  }

  /*
    These asteroid_* commands are OUR bridge language.
    Right now they will only work once a real mod/custom command layer exists.
    This daemon is the translator/future-proof layer.
  */
  const queued = enqueueCommand(
    `asteroid_redeem ${steamId} ${dino} ${redeemType}`,
    'api:/redeem'
  );

  res.json({
    ok: true,
    queued,
    steamId,
    dino,
    redeemType,
  });
});

app.post('/api/command', requireApiKey, async (req, res) => {
  try {
    const { command, steamId, value } = req.body;

    const result = await handleCommand(command, steamId, value);

    res.json({
      ok: true,
      result,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post('/slay', requireApiKey, (req, res) => {
  const steamId = String(req.body.steamId || '').trim();

  if (!validSteamId(steamId)) {
    return res.status(400).json({ ok: false, error: 'Invalid steamId' });
  }

  const queued = enqueueCommand(`asteroid_slay ${steamId}`, 'api:/slay');

  res.json({
    ok: true,
    queued,
    steamId,
  });
});

app.post('/park', requireApiKey, (req, res) => {
  const steamId = String(req.body.steamId || '').trim();

  if (!validSteamId(steamId)) {
    return res.status(400).json({ ok: false, error: 'Invalid steamId' });
  }

  const queued = enqueueCommand(`asteroid_park ${steamId}`, 'api:/park');

  res.json({
    ok: true,
    queued,
    steamId,
  });
});

app.post('/grow-test', requireApiKey, (req, res) => {
  const steamId = String(req.body.steamId || '').trim();
  const growth = Number(req.body.growth || 30);

  if (!validSteamId(steamId)) {
    return res.status(400).json({ ok: false, error: 'Invalid steamId' });
  }

  const queued = enqueueCommand(`growth "${steamId}" ${growth}`, 'api:/grow-test');

  res.json({
    ok: true,
    queued,
  });
});

app.get('/players', requireApiKey, async (req, res) => {
  try {
    const playerListRaw = await getPlayerList();
    const players = parsePlayerList(playerListRaw);

    res.json({
      ok: true,
      players,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get('/player/:steamId', requireApiKey, async (req, res) => {
  try {
    const steamId = String(req.params.steamId || '').trim();

    if (!validSteamId(steamId)) {
      return res.status(400).json({ ok: false, error: 'Invalid steamId' });
    }

    const raw = await getPlayerData(steamId);
    const parsed = parsePlayerData(raw, steamId);

    res.json({
      ok: true,
      player: parsed,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// =====================
// STARTUP
// =====================
async function main() {
  log('[BRIDGE] Starting AsteroidBridge v2...');
  log('[BRIDGE] Sync interval:', `${syncIntervalMs}ms`);
  log('[BRIDGE] HTTP port:', String(PORT));

  app.listen(PORT, '0.0.0.0', () => {
    log('[HTTP]', `AsteroidBridge running on port ${PORT}`);
  });

  await syncServerStatus();

  setInterval(async () => {
    await syncServerStatus();
  }, syncIntervalMs);
}

main().catch(async (error) => {
  log('[BRIDGE] Fatal error:', error.message);
  await prisma.$disconnect();
  process.exit(1);
});

process.on('SIGINT', async () => {
  log('[BRIDGE] Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('[BRIDGE] Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});