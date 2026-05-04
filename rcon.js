require('dotenv').config();

const BASE_URL = `http://${process.env.RCON_HOST}:${process.env.RCON_PORT}`;
const PASSWORD = process.env.RCON_PASSWORD;

if (!process.env.RCON_HOST || !process.env.RCON_PORT || !process.env.RCON_PASSWORD) {
  throw new Error('Missing RCON_HOST, RCON_PORT, or RCON_PASSWORD in .env');
}

async function sendRconCommand(command, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url =
      `${BASE_URL}/?password=${encodeURIComponent(PASSWORD)}` +
      `&command=${encodeURIComponent(command)}`;

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`RCON request failed: ${res.status} ${text}`);
    }

    return text;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`RCON timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getServerDetails() {
  return sendRconCommand('serverdetails');
}

async function getPlayerList() {
  return sendRconCommand('playerlist');
}

async function getPlayerData(playerIdOrSteamId) {
  return sendRconCommand(`getplayerdata ${playerIdOrSteamId}`);
}

module.exports = {
  sendRconCommand,
  getServerDetails,
  getPlayerList,
  getPlayerData,
};