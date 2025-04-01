const STATE_ID = "notebook-state-json";
const STATE_SEL = `#${STATE_ID}`;
let stateEl = null;

const logger = $Brd.logger.config({ ns: 'nbstate', color: 'purple' });
// const log = $Brd.debug("nbstate", 'purple', logger.log.fmt, logger.log.sink);

let model = null;

function getOutputHTML(outputId) {
  const outputElement = document.querySelector(`#${outputId}`);
  return outputElement ? outputElement.innerHTML : null;
}

function getNotebookState() {
  const nbstate = window?.$Ren?.NBState;
  if (nbstate) return nbstate;
  return stateEl ? stateEl.textContent : null;
}

// ---------- Observers stuff ----------
function sendState(model) {
  const state = getNotebookState();
  if (state) stateChanged(model, state);
}

function registerObservers(model) {
  stateEl = document.querySelector(STATE_SEL);
  const observerManager = $Brd.observerManager;

  const notebook_cb = (recs) => {
    logger.log("notebookObserver triggered, records", recs.length);
    if (!stateEl) {
      stateEl = document.querySelector(STATE_SEL);
      if (stateEl) {
        observerManager.start("state", { target: stateEl });
        requestAnimationFrame(() => sendState(model));
      }
    } else {
      if (!document.querySelector(STATE_SEL)) {
        // State element is gone.
        observerManager.stop("state", { removeTarget: true });
      }
    }
  };
  observerManager.register(
    "notebook",
    { target: document.body, options: { childList: true }, callback: notebook_cb },
    true,
    true
  );

  const registered = observerManager.has("state");
  const state_cb = (recs) => {
    logger.log("stateObserver triggered, records", recs);
    requestAnimationFrame(() => sendState(model));
  };
  observerManager.register(
    "state",
    {
      target: stateEl,
      options: { characterData: true, childList: true, subtree: true },
      callback: state_cb,
    },
    stateEl != null,
    true
  );

  if (registered) {
    logger.log("Found existing state observers");
    model.send({ ctx: "nbstate", kind: "info", info: "found existing state observers" });
  }
  
  return () => {
    observerManager.removeCallback("state", state_cb);
    observerManager.removeCallback("notebook", notebook_cb);
    if (observerManager.isEmpty("state")) observerManager.stop("state");
    if (observerManager.isEmpty("notebook")) observerManager.stop("notebook");
  };
}
// ---------- ---------- ----------

function onNBStateMsg(msg) {
  logger.log(`new nbstate message: ${JSON.stringify(msg)}`);
  msg.origin = document.location.href;
  if (msg.cmd === "get_state") {
    // const state = getNotebookState();
    // model.send({ ctx: "nbstate", kind: "state_update", state });
    window?.$Ren?.update(msg);
  } else if (msg.cmd === "update") {
    window?.$Ren?.update(msg);
  } else if (msg.cmd === "get_output_html") {
    const html = getOutputHTML(msg.output_id);
    model.send({ ctx: "nbstate", kind: "output_html", output_id: msg.output_id, html });
  }
}

function stateChanged(model, msg) {
  const reqId = msg.reqId;
  const ts = msg.timestamp;
  logger.log(`state changed: ${ts}`);
  model.send({ ctx: "nbstate", kind: "state_update", state: msg, reqId, ts });
}

function initializeNBState(theModel) {
  model = theModel;
  model.on("msg:custom", onNBStateMsg);
  const renderer = window.$Ren;
  const cleanup = renderer ? renderer.addStateObserver((msg) => stateChanged(model, msg)) : registerObservers(model);
  // const cleanup = registerObservers(model);
  // if (stateEl) requestAnimationFrame(() => sendState(model))
  logger.log("NBState initialized");
  model.send({ ctx: "nbstate", kind: "info", info: "loaded" });
  return () => {
    cleanup();
    logger.log("NBState disconnected");
  };
}
