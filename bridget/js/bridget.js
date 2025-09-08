// bridget.js

import { bridge } from './bridge.js';

const ctx = 'bridget';

const logger = bridge.logger.create({ ns: ctx, color: 'Sienna', 'fmt': 'htmlFmt', 
    'ERROR': {color: 'red'}, 'WARN': {color: 'LightSalmon'} });

function getCurrentDateGMT() {
  return new Date().toUTCString();
}

const pending = {};
// let debug_req = true;

function truncate(str, maxLength = 140) {
  return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
}

function on_request(request, callback) {
  let req = { ...request, req_id: bridge.uuid() };
  delete req.xhr;
  delete req.upload;
  logger.log('Request:', truncate(JSON.stringify(req, null, 2)));
  pending[req.req_id] = callback;
  bridge.model.send({ ctx, kind: 'request', request: req });
}

function onBridgetMsg(msg) {
  logger.log(`new bridget message: truncate(${JSON.stringify(msg)})`);
  if (msg.cmd === "response") {
    on_response(msg);
  } else if (msg.cmd === "debug") {
    bridge.logging.debug.enable();
  }
}
function on_response(msg) {
  const txt = JSON.stringify(msg);
  logger.log(`new message: ${truncate(txt)}`);
  const { response } = msg;
  let req_id = response?.req_id;
  // if (debug_req) {
  //   logger.log('Response:', JSON.stringify(response, null, 2));
  // }
  const callback = pending?.[req_id];
  if (callback) {
    delete pending[req_id];
    callback(response);
  }
}  

export async function setupBridget() {
  bridge.on(ctx, on_response);
  const { default: xhook } = await import('https://unpkg.com/xhook@1.6.2/es/main.js');
  if (xhook) xhook.before(on_request);
  logger.log('Bridget initialized');
  return () => {
    if (bridge.model) xhook.removeEventListener('before', on_request);
    bridge.off('response');
    logger.log('Bridget removed!');
  };
}
