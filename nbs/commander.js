debugger;

function processNode(n) {
    if (!window.htmx) return;
    // n.setAttribute('ready', '');  // mark for observation, Faster than walking MutationObserver 
    //                               // results when receiving subtree (DOM swap, htmx, ajax, jquery).
    htmx.process(n);
    // console.log('Processed output cell', n.outerHTML);
    console.log('Processed output node', n);
}

async function htmxSetup(sels) {
    // if (!window.proc_htmx) await import('https://cdn.jsdelivr.net/gh/answerdotai/fasthtml-js@1.0.4/fasthtml.js');
    if (!window.htmx) {
        const { default: htmx } = await import('https://cdn.jsdelivr.net/npm/htmx.org@2.0.3/dist/htmx.esm.js');
        window.htmx = htmx;
    }
    if (window.htmx) {
        htmx.config.selfRequestsOnly = false;
        for (const sel of sels) {
            // htmx.process(globalThis.document.body);
            // Process only output cells.
            document.querySelectorAll(sel).forEach(el => processNode(el));
        }
    }
    return htmx;
}

function initializeObserver(sels) {
    if (!window.bridgetObserver) {
        console.log('bridgetObserver not found, creating');
        window.bridgetObserver ??= new MutationObserver(recs => { // Allow 1 observer.
            // console.log('MutationObserver triggered, records', recs.length);
            for (const r of recs) {
                if (r.addedNodes.length < 1 || !sels.some(sel => r.target.matches(sel))) continue;
                // console.log('record', r);
                for (const n of r.addedNodes) {
                    if (n.nodeType === 1) requestAnimationFrame(() => processNode(n))
                }
            }
        });
        window.bridgetObserver.observe(document.body, {childList: true, subtree: true});
    } else {
        console.log('bridgetObserver already exists, skipping');
    }
}

function on_msg(msg) {
    // debugger;
    console.log(`new message: ${JSON.stringify(msg)}`);
    const { cmd, args } = msg;
    if (cmd in htmx) {
        try {
            htmx[cmd](...(Array.isArray(args) ? args : Object.values(args)));
        } catch (e) {
            console.error(e);
        }
    } else {
        console.warn(`Unknown HTMX command: ${cmd}`);
    }
}

async function initializeCommander(sels) {
    await htmxSetup(sels);
    if (!window.htmx) console.warn('HTMX not loaded!');
    initializeObserver(sels);
    console.log('Commander initialized');
}

