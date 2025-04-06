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
