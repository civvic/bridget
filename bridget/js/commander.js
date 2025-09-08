// commander.js

import { getObserverManager } from './observer.js';
import { bridge, initBridge } from './bridge.js';

const logger = bridge.logger.create({ ns: 'commander', color: 'blue', 'fmt': 'htmlFmt', 
    'ERROR': {color: 'red'}, 'WARN': {color: 'LightSalmon'} });

export function onCommanderMsg(msg) {
    logger.log(`new message: <code>${JSON.stringify(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`);
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

export async function setupCommander(sels) {
    const observer = getObserverManager();
    if (observer.has('commander')) { // just 1 observer
        logger.log('Commander already initialized'); return;
    }
    if (!bridge.model) {
        logger.error('Bridge not initialized');
        return;
    }
    await bridge.htmx.setup(sels);
    if (!window.htmx) logger.error('HTMX not loaded!');
    const processNode = bridge.htmx.processNode;
    const commander_cb = recs => {
        for (const r of recs) {
            if (r.addedNodes.length < 1 || !sels.some(sel => r.target.matches(sel))) continue;
            for (const n of r.addedNodes) {
                if (n.nodeType === 1) requestAnimationFrame(() => processNode(n))
            }
        }
    }
    observer.register(
        'commander', 
        {target: document.body, options: {childList: true, subtree: true}, callback: commander_cb}, 
        true, true
    );
    logger.log('Commander initialized');
    return () => {
        observer.removeCallback('commander', commander_cb);
        logger.log("Commander disconnected");
        logger.close()
    };
}
