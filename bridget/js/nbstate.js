// nbstate.js
// @ts-check

import { bridge } from './bridge.js';

const ctx = 'fetcher';

const logger = bridge.logger.create({ ns: ctx, color: 'green', 'fmt': 'htmlFmt', 
  'ERROR': {color: 'red'}, 'WARN': {color: 'LightSalmon'} });

export function initializeNBState(bridge) {

  function onNBStateMsg(msg) {
    logger.log(`new fetcher message: ${JSON.stringify(msg)}`);
    msg.origin = document.location.href;
    if (msg.cmd === "get_state") {
      renderer.update(msg);
    } else if (msg.cmd === "update") {
      renderer.update(msg);
    }
  }
  
  function stateChanged(msg) {
    const reqId = msg.reqId;
    const ts = msg.timestamp;
    // logger.log(`state changed: ${ts}`);
    bridge.model.send({ ctx, kind: "state_update", state: msg, reqId, ts });
  }

  let cleanupRenderer;
  let renderer = globalThis.$Ren;

  if (renderer) {
    cleanupRenderer = renderer.addStateObserver(stateChanged);
    logger.log("NBState initialized");
  } else {
    bridge.model.send({ ctx, kind: "info", info: "renderer not found" });
  }
  
  bridge.on(ctx, onNBStateMsg);
  
  return () => {
    bridge.off(ctx);
    if (cleanupRenderer) cleanupRenderer();
    bridge.logger.log("NBState disconnected");
  }
}
