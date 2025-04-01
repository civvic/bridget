const bridge = globalThis.$Brd;

function basicFmt(ts, ns, color, msg) {
  return [`${ts}${ns?` ${ns}`:''} ${msg}`];
}

function htmlFmt(ts, ns, color, msg) {
  return [`<span class="ts">${ts}</span><span class="ns" style="color: ${color}">${ns?` ${ns}`:''}</span> ${msg}`];
}

const FMTS = {
  basicFmt,
  htmlFmt,
};
Object.entries(FMTS).forEach(([key, value]) => { bridge.logger.FMTS[key] = value; });

export function initLogger(model) {
  let mylogger, canvas/* , config */;
  
  const sink = (msg) => {
    if (!canvas) setupCanvas();
    if (!canvas) return;
    canvas.innerHTML += `${msg}<br>`;
    canvas.scrollTop = canvas.scrollHeight;
  };

  function setupCanvas() {
    const elid = model.get('elid');
    if (!elid) return;
    const newCanvas = document.querySelector(`#${elid}`);
    if (newCanvas && newCanvas !== canvas) {
      if (canvas) {
        canvas.style.display = 'none';
        newCanvas.innerHTML = canvas.innerHTML;
        newCanvas.scrollTop = newCanvas.scrollHeight;
        canvas.innerHTML = '';
      }  
      canvas = newCanvas;
      updateConfig();
      if (!mylogger) mylogger = bridge.logger.config({ ns: 'logger', color: 'purple'});
    }  
  }  

  function updateConfig() {
    if (canvas) bridge.logger = bridge.logger.config(model.get('logger_config'), sink);
  }    
  
  setupCanvas();
  model.on('change:elid', setupCanvas);
  model.on('change:logger_config', updateConfig);
  
  model.on('msg:custom', ({ rec, clear }) => {
    if (clear && canvas) canvas.innerHTML = '';
    mylogger.log(rec.message);
  });
  (mylogger || bridge.logger).log('Bridge logger initialized!');
  model.send({ ctx: "logger", kind: "info", info: "loaded" });
  return () => {
    bridge.logger = null;
    mylogger.log('Bridge logger cleanup!');
  };
}
