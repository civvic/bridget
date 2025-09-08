// bcanvas.js
// @ts-check

import { FCanvas } from './fcanvas.js';
import { bridge } from './bridge.js';

const l2f = {'INFO': 'log', 'ERROR': 'error', 'WARN': 'warn'};
const ERROR = {color: 'red'}
const WARN = {color: 'LightSalmon'}

class BCanvas extends FCanvas {
  
  constructor(model) {
    super(model);
    this.connected = false;
    this.logger.log('Bridge canvas created.');
  }
  
  setup(model) {
    super.setup(model);
    if (model) {
      this.setupLoggers();
    } else {
      this.logger.log('Bridge canvas cleanup.');
      if (this.connected) {
        this.logger.close();
        this.blogger.close();
        bridge.logging.resetLogger();  // revert to default logger
      }
    }
  }
  
  setupLoggers(config) {
    const logging = bridge.logging;
    if (this.canvas) {
      const logger = logging.logger;
      if (!config) config = bridge.model?.get('logger_config');
      logger.update(config, this.sink.bind(this));
      this.logger = logger.create({ ns: 'canvas', color: 'orange', 'fmt': 'htmlFmt', ERROR, WARN });
      this.blogger = logger.create({ ns: 'logger', color: 'purple', 'fmt': 'htmlFmt', ERROR, WARN });
      this.connected = true;
    }
  }

  update(msg, kw) {
    const { ctx, level } = kw ?? {};
    if (ctx) {
      if (!this.connected) this.setupLoggers();
      (bridge.logging.loggers.get(ctx) || this.blogger || this.logger)[l2f[level] || 'log'](msg);
    }
    else super.update(msg, kw);
  }

  updateCanvas(newCanvas) {
    super.updateCanvas(newCanvas);
    if (!this.connected) this.setupLoggers();
    else bridge.logging.logger.update(null, this.sink.bind(this));
  }

  updateConfig(config) {
    if (this.connected) bridge.logging.logger.update(config);
  }

}

const bcanvas = new BCanvas();

export { bcanvas };
