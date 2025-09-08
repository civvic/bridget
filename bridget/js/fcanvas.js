// fcanvas.js
// @ts-check

export class FCanvas {
  constructor(model) {
    this.canvas = null, this.logger = console, this.model = model;
  }
  
  setup(model) {
    if (!model) {
      if (this._model) this._model.off('msg:custom', this.handle_cmd);
      this.canvas = null, this._model = null;
      return;
    }
    this._model = model;
    this.setupCanvas(this._model.get('elid'));
    this._model.on('msg:custom', this.handle_cmd.bind(this));
    this._model.send({ ctx: "canvas", kind: "info", info: "loaded" });
  }
  
  get model() { return this._model; }
  set model(model) { this.setup(model); }
  
  handle_cmd({ cmd, content, kw, msg_id }) {
    if (!this.canvas && cmd==='show') this.show(content, kw, msg_id);
    if (this.canvas) {
      this[cmd] ? this[cmd](content, kw, msg_id) : this.logger.error(`FCanvas: ******** unknown command: ${cmd}`);
    }
  }

  show(elid, kw, msg_id) { 
    this.setupCanvas(elid).then(res => {
      if (res) this.model.send({ msg_id: msg_id, elid: elid });
    });
  }
  update(msg, kw) { if (msg) this.sink(msg); }
  clear(msg, kw) { this.canvas.innerHTML = ''; }
  hide(msg, kw) { this.canvas.style.display = 'none'; }

  updateCanvas(newCanvas) {
    if (!this.canvas) { this.model.set('_displayed', true); this.model.save_changes(); }
    this.canvas = newCanvas;
  }

  async _lookupCanvas(elid, maxRetries = 20, delay = 100) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const el = document.getElementById(elid);
      if (el) return el;
      if (attempt < maxRetries - 1) await new Promise(resolve => setTimeout(resolve, delay));
    }
    return null;
  }
  async setupCanvas(elid) {
    if (!elid || (this.canvas && this.canvas.id == elid)) return;
    const newCanvas = await this._lookupCanvas(elid);
    if (newCanvas) {
      if (this.canvas) {
        this.canvas.style.display = 'none';
        newCanvas.innerHTML = this.canvas.innerHTML;
        newCanvas.scrollTop = newCanvas.scrollHeight;
        this.canvas.innerHTML = '';
      }
      this.updateCanvas(newCanvas);
      return true;
    } else {
      this.logger.log('FCanvas: ******** canvas element not found');
    }
  }

  sink(msg, ...rest) {
    if (this.canvas) {
      this.canvas.innerHTML += `${msg}`;
      this.canvas.scrollTop = this.canvas.scrollHeight;
    } else {
      this.setupCanvas(this.model.get('elid')).then(res => {
        if (res) {
          this.canvas.innerHTML += `${msg}`;
          this.canvas.scrollTop = this.canvas.scrollHeight;      
        }
      })
    }
  }
}
