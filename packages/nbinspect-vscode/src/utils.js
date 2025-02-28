export const MIME = 'application/x-notebook-state';  // Renderer MIME type

export const defaultNotebookFormat = { major: 4, minor: 2 };

export const CellOutputMimeTypes = {
	error: 'application/vnd.code.notebook.error',
	stderr: 'application/vnd.code.notebook.stderr',
	stdout: 'application/vnd.code.notebook.stdout'
}

export const textMimeTypes = ['text/plain', 'text/markdown', 'text/latex', 
  CellOutputMimeTypes.stderr, CellOutputMimeTypes.stdout];


/** Check if a notebook has any mime outputs.
 * @param {vscode.NotebookDocument} nb
 * @param {string} mime
 * @returns {boolean}
 */
export function hasNBMimeOutput(nb, mime) {
  return nb.getCells().some(c => c.outputs.some(o => o.items.some(it => it.mime === mime)));
}

// /** @param {vscode.NotebookDocumentCellChange} ch */
// function hasTransientOutput(ch) {
//   // return ch?.outputs?.some(o => o.metadata?.transient && Object.keys(o.metadata.transient).length > 0);
//   return ch?.outputs?.some(o => o.metadata?.transient?.display_id);
// }

// /** @param {vscode.NotebookDocumentCellChange} ch */
// function hasMimeOutput(ch, mime) {
//   return ch?.outputs?.some(o => o.items.some(it => it.mime === mime));
// }

const _CACHE = {};
export function getType(obj) {
  let key;
  return obj === null ? 'null' // null
    : obj === globalThis ? 'global' // window in browser or global in nodejs
    : (key = typeof obj) !== 'object' ? key // basic: string, boolean, number, undefined, function
    : obj.nodeType ? 'object' // DOM element
    : _CACHE[key = ({}).toString.call(obj)] // cached. date, regexp, error, object, array, math
    || (_CACHE[key] = key.slice(8, -1).toLowerCase()); // get XXXX from [object XXXX], and cache it
}

export function truncate(str, maxLength = 100) {
  return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
}

// function debounce(func, delay) {
//   let timer;
//   return function (...args) {
//     clearTimeout(timer);
//     timer = setTimeout(() => func.apply(this, args), delay);
//   };
// }

// const colors = [6, 2, 3, 4, 5, 1];
const colors = [
	'#0000CC',
	'#0000FF',
	'#0033CC',
	'#0033FF',
	'#0066CC',
	'#0066FF',
	'#0099CC',
	'#0099FF',
	'#00CC00',
	'#00CC33',
	'#00CC66',
	'#00CC99',
	'#00CCCC',
	'#00CCFF',
	'#3300CC',
	'#3300FF',
	'#3333CC',
	'#3333FF',
	'#3366CC',
	'#3366FF',
	'#3399CC',
	'#3399FF',
	'#33CC00',
	'#33CC33',
	'#33CC66',
	'#33CC99',
	'#33CCCC',
	'#33CCFF',
	'#6600CC',
	'#6600FF',
	'#6633CC',
	'#6633FF',
	'#66CC00',
	'#66CC33',
	'#9900CC',
	'#9900FF',
	'#9933CC',
	'#9933FF',
	'#99CC00',
	'#99CC33',
	'#CC0000',
	'#CC0033',
	'#CC0066',
	'#CC0099',
	'#CC00CC',
	'#CC00FF',
	'#CC3300',
	'#CC3333',
	'#CC3366',
	'#CC3399',
	'#CC33CC',
	'#CC33FF',
	'#CC6600',
	'#CC6633',
	'#CC9900',
	'#CC9933',
	'#CCCC00',
	'#CCCC33',
	'#FF0000',
	'#FF0033',
	'#FF0066',
	'#FF0099',
	'#FF00CC',
	'#FF00FF',
	'#FF3300',
	'#FF3333',
	'#FF3366',
	'#FF3399',
	'#FF33CC',
	'#FF33FF',
	'#FF6600',
	'#FF6633',
	'#FF9900',
	'#FF9933',
	'#FFCC00',
	'#FFCC33'
];

function selectColor(namespace) {
  let hash = 0;

  for (let i = 0; i < namespace.length; i++) {
    hash = ((hash << 5) - hash) + namespace.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }

  return colors[Math.abs(hash) % colors.length];
}

function createDebugger(namespace, color) {
  let prevTime;
  function debug(...args) {
    // Disabled?
    if (!debug.enabled) {
      return;
    }
    const curr = Number(new Date());
    const ms = curr - (prevTime || curr);
    self.diff = ms;
    self.prev = prevTime;
    self.curr = curr;
    prevTime = curr;
    const msg = args.reduce((acc, arg) => {
      if (typeof arg === 'string') {
        return acc + (acc.length > 0 ? ' ' : '') + arg;
      }
      return acc + (acc.length > 0 ? ' ' : '') + JSON.stringify(arg);
    }, '');
    const ts = (self.prev && ms < 1000 ? `+${ms}` : `${curr}`).padStart(13);
    // console.log(`%c${curr}${namespace} %s`, `color: #${debug.color.toString(16).padStart(6, '0')}`, msg);
    self.log(`%c${ts} ${namespace}`, `color: ${debug.color}`, `\x1B[1;34m${msg}\x1B[m`);
  }
  const self = debug;
  self.enabled = true;
  
  debug.namespace = namespace;
  debug.useColors = true;
  debug.color = color ?? selectColor(namespace);
  debug.log = console.info.bind(console);
  
  return debug;
}

export { createDebugger as debug };
