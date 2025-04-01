const bridge = globalThis.$Brd;
const logger = bridge.logger.config({ ns: 'loader' });

const cmdMap = {
  'load': 'loadESMs',
  'loadLinks': 'loadLinks'
};

async function onLoaderMsg(msg) {
    const txt = JSON.stringify(msg);
  logger.log(`new message: ${txt.slice(0, 100)}${txt.length>100?'...':''}`);
  const { cmd, args=[], msg_id } = msg;
  const fn = cmdMap[cmd];
  if (!fn || typeof bridge[fn] !== 'function') {
    logger.error(`Unknown command: ${cmd}`);
    // model.send({ ctx: 'loader', kind: 'error', error: `Unknown command: ${cmd}`, msg_id });
    bridge.model.send({ ctx: 'loader', kind: 'error', error: `Unknown command: ${cmd}`, msg_id });
    return;
  }
  const { success, failed } = await bridge[fn](args);
  bridge.model.send({ ctx: 'loader', kind: cmd, success: success, failed: failed, msg_id });
}

export function initializeLoader(model) {
  bridge.on('loader', onLoaderMsg);
  logger.log('Loader initialized!');
  return () => {
    bridge.off('loader');
    logger.log('Loader removed!');
  }
}
