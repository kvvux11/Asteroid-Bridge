const { sendRconCommand } = require('./rcon');

function clean(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\- .]/g, '')
    .slice(0, 120);
}

function validSteamId(steamId) {
  return /^\d{17,25}$/.test(String(steamId || '').trim());
}

async function handleCommand(command, steamId, value) {
  const cleanCommand = clean(command).toLowerCase();
  const cleanSteamId = String(steamId || '').trim();
  const cleanValue = clean(value);

  if (!validSteamId(cleanSteamId)) {
    throw new Error('Invalid SteamID64');
  }

  switch (cleanCommand) {
    case 'redeem':
      if (!cleanValue) throw new Error('Missing dino value');

      // Bridge command language.
      // Later this can become the real C++/mod command.
      await sendRconCommand(`asteroid_redeem ${cleanSteamId} ${cleanValue}`);
      return {
        ok: true,
        command: 'redeem',
        sent: `asteroid_redeem ${cleanSteamId} ${cleanValue}`,
      };

    case 'slay':
      await sendRconCommand(`asteroid_slay ${cleanSteamId}`);
      return {
        ok: true,
        command: 'slay',
        sent: `asteroid_slay ${cleanSteamId}`,
      };

    case 'park':
      await sendRconCommand(`asteroid_park ${cleanSteamId}`);
      return {
        ok: true,
        command: 'park',
        sent: `asteroid_park ${cleanSteamId}`,
      };

    case 'mutate':
      if (!cleanValue) throw new Error('Missing mutation value');

      await sendRconCommand(`asteroid_mutate ${cleanSteamId} ${cleanValue}`);
      return {
        ok: true,
        command: 'mutate',
        sent: `asteroid_mutate ${cleanSteamId} ${cleanValue}`,
      };

    case 'grow':
      if (!cleanValue) throw new Error('Missing growth value');

      await sendRconCommand(`asteroid_grow ${cleanSteamId} ${cleanValue}`);
      return {
        ok: true,
        command: 'grow',
        sent: `asteroid_grow ${cleanSteamId} ${cleanValue}`,
      };

    case 'heal':
      await sendRconCommand(`asteroid_heal ${cleanSteamId}`);
      return {
        ok: true,
        command: 'heal',
        sent: `asteroid_heal ${cleanSteamId}`,
      };

    default:
      throw new Error(`Unknown command: ${cleanCommand}`);
  }
}

module.exports = {
  handleCommand,
};