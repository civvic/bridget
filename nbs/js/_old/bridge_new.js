
import { debug } from '../../packages/nbinspect-vscode/src/debug.mjs';

class Bridge {
  /** @param {import("@anywidget/types").AnyModel<Model>} model*/
  constructor(model) {
    this.model = model;
    this.logger = {
      log: debug('brd'),
      error: debug('brd:error'),
    };
    /** @type {Map<string, Function>} */
    this.msgHub = new Map();
    model.on("msg:custom", (msg) => {
      const fn = this.msgHub.get(msg.ctx);
      if (fn) fn(msg);
    });
    this.logger.log('BridgeWidget initialized!');
    model.send({ ctx: model.get('ctx_name'), kind: 'info', info: 'initialized' });
  }

  cleanup() {
    // return () => { 
    //   cleanup.forEach(fn => fn());
    this.logger.log('BridgeWidget cleanup!');
  }

  /** @param {string} ctx @param {Function} fn */
  on(ctx, fn) {
    this.msgHub.set(ctx, fn);
  }
  
  /** @param {string} ctx */
  off(ctx) {
    this.msgHub.delete(ctx);
  }
}

const bridge = new Bridge();
export default bridge;

/**
 * @typedef Model
 * @prop {string} ctx_name - the name of the context
 */
