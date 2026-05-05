const { prisma } = require('./prisma');

const CREATED_BY_STEAM_ID =
  process.env.BRIDGE_CREATED_BY_STEAM_ID || '76561199122440096';

function clean(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\- .]/g, '')
    .slice(0, 120);
}

function validSteamId(steamId) {
  return /^\d{17,25}$/.test(String(steamId || '').trim());
}

async function getCommandCreator() {
  const user = await prisma.user.findUnique({
    where: { steamId: CREATED_BY_STEAM_ID },
  });

  if (!user) {
    throw new Error(`Bridge creator user not found for SteamID ${CREATED_BY_STEAM_ID}`);
  }

  return user;
}

function mapBridgeCommandToWorkerCommand(command, value) {
  const cleanCommand = clean(command).toLowerCase();
  const cleanValue = clean(value).toLowerCase();

  if (cleanCommand === 'grow') {
    if (cleanValue === '30') return 'TEST_GROWTH_30';
    throw new Error('Only grow value 30 is currently supported by WorkerCommand enum.');
  }

  if (cleanCommand === 'health') return 'TEST_HEALTH_100';
  if (cleanCommand === 'hunger') return 'TEST_HUNGER_100';
  if (cleanCommand === 'prime') return 'TEST_PRIME';

  throw new Error(
    `Command "${cleanCommand}" is not connected to AsteroidWorker yet. Supported now: grow 30, health, hunger, prime.`
  );
}

async function handleCommand(command, steamId, value) {
  const targetSteamId = String(steamId || '').trim();

  if (!validSteamId(targetSteamId)) {
    throw new Error('Invalid SteamID64');
  }

  const creator = await getCommandCreator();
  const workerCommandType = mapBridgeCommandToWorkerCommand(command, value);

  const queued = await prisma.workerCommand.create({
    data: {
      createdById: creator.id,
      targetSteamId,
      commandType: workerCommandType,
      status: 'PENDING',
    },
  });

  return {
    ok: true,
    bridgeCommand: clean(command).toLowerCase(),
    workerCommandType,
    workerCommandId: queued.id,
    targetSteamId,
  };
}

module.exports = {
  handleCommand,
};