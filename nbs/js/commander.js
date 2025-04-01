// import { getObserverManager } from './observer.js';
const bridge = globalThis.$Brd;
const logger = bridge.logger.config({ ns: 'commander' });

function on_commander_msg(msg) {
    // debugger;
    logger.log(`new message: ${JSON.stringify(msg)}`);
    const { cmd, args } = msg;
    if (cmd in htmx) {
        try {
            htmx[cmd](...(Array.isArray(args) ? args : Object.values(args)));
        } catch (e) {
            logger.error(e);
        }
    } else {
        logger.error(`Unknown HTMX command: ${cmd}`);
    }
}

async function initializeCommander(sels) {
    if (bridge.observerManager.has('commander')) { // just 1 observer
        logger.log('Commander already initialized'); return;
    }
    await bridge.htmxSetup(sels);
    if (!window.htmx) logger.error('HTMX not loaded!');
    const commander_cb = recs => {
        for (const r of recs) {
            if (r.addedNodes.length < 1 || !sels.some(sel => r.target.matches(sel))) continue;
            for (const n of r.addedNodes) {
                if (n.nodeType === 1) requestAnimationFrame(() => bridge.processNode(n))
            }
        }
    }
    bridge.observerManager.register(
        'commander', 
        {target: document.body, options: {childList: true, subtree: true}, callback: commander_cb}, 
        true, true
    );
    logger.log('Commander initialized');
    return () => {
        bridge.observerManager.removeCallback('commander', commander_cb);
        logger.log("Commander disconnected");
    };
}

// export { initializeCommander, on_commander_msg };
