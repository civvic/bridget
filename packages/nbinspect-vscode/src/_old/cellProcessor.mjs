import * as vscode from 'vscode';

import { Bridged } from './bridged.mjs';

/** 
 * @typedef {Object} StateCell
 * @property {'raw'|'markdown'|'code'} cell_type
 * @property {string} source
 * @property {Object} metadata
 * @property {Object[]|undefined} outputs
 */

// const textDecoder = new TextDecoder();

function isJsonMime(mime) {
  return  mime === 'application/json' || 
          mime.endsWith('+json') ||
          mime.startsWith('application/vnd.jupyter') ||
          mime.includes('json');
}

function isBinaryMime(mime) {
  return  mime === 'image/png' || 
          mime === 'image/jpeg' || 
          mime === 'image/gif' ||
          mime === 'application/pdf';
}

function isTextMime(mime) {
  return  mime.startsWith('text/') || 
          mime === 'image/svg+xml' ||
          mime === 'application/xml';
}

function bufferToString(data, mime) {
  // If not a buffer, return as is
  if (!Buffer.isBuffer(data)) return data;
  if (mime) {
    // Binary types need base64 encoding
    if (isBinaryMime(mime)) return data.toString('base64');
    // JSON types need parsing
    if (isJsonMime(mime)) {
        try {
          return JSON.parse(data.toString('utf8'));
        } catch (e) {
          console.warn(`Failed to parse JSON for ${mime}`, e);
          return data.toString('utf8');
        }
    }
    // Text types (including SVG) use UTF-8
    if (isTextMime(mime)) return data.toString('utf8');
  }
  // Default to UTF-8 for unknown types
  return data.toString('utf8');
}

/** @param {vscode.NotebookCellOutputItem[]} items */
function getMimeBundle(items) {
  return items.reduce((bundle, item) => {
    if (item.data) {
      bundle[item.mime] = bufferToString(item.data, item.mime);
    }
    return bundle;
  }, {});
}

function getOutputMetadata(output) {
  if (!output.metadata) return undefined;
  const { outputType, metadata, ...rest } = output.metadata;  // eslint-disable-line no-unused-vars
  const md = { ...rest, ...metadata };
  return Object.keys(md).length > 0 ? md : undefined;
}

// function processOutputData(mime, data) {
//   if (!data) return null;
  
//   try {
//     if (mime.startsWith('text/') || mime === 'application/json') {
//       return textDecoder.decode(data);
//     }
//     if (mime.startsWith('image/')) {
//       return Buffer.from(data).toString('base64');
//     }
//     return textDecoder.decode(data);
//   } catch (ex) {
//     log('Error processing output:', ex);
//     return null;
//   }
// }

// function processOutput(output) {
//   const items = output.items.map(item => ({
//     mime: item.mime,
//     data: processOutputData(item.mime, item.data)
//   }));
  
//   return {
//     items,
//     metadata: output.metadata
//   };
// }
/** @param {vscode.NotebookCellOutput} o */
function processOutput(output) {
  let fields/* , item */, mime, text;
  const data = getMimeBundle(output.items);
  let metadata = getOutputMetadata(output);
  const t = output?.metadata?.outputType;  // 0: stream, 1: display_data, 2: execute_result, 3: error
  if (!t) {
    // This happens with new or pasted cells
    debugger;
    fields = {items: output.items};
    return fields;
  };
  switch(t) {
    case 'stream':  // application/vnd.code.notebook.stdout stderr
      // item = output.items[0];
      // const text = bufferToString(item.data);
      [mime, text] = Object.entries(data)[0]
      fields = { output_type: t, name: /* item. */mime.includes('stderr') ? 'stderr' : 'stdout', text: text };
      break;
    case 'error':  // application/vnd.code.notebook.error
      // item = output.items[0];
      // const errorData = JSON.parse(bufferToString(item.data));
      [mime, text] = Object.entries(data)[0]
      const errorData = JSON.parse(text);
      fields = { output_type: t, ename: errorData.name, evalue: errorData.message };
      if (errorData.stack) fields.traceback = errorData.stack.split('\n');
      metadata = null;
      break;
    case 'execute_result':  // application/vnd.jupyter.widget-view+json, image/png...
      fields = { output_type: t, data: data };
      fields.execution_count = metadata?.executionCount;
      delete metadata?.executionCount;
      break;
    default:  // display_data
      fields = { output_type: t, data: data };
  }
  if (metadata && Object.keys(metadata).length > 0) fields.metadata = metadata;
  return fields;
}

function getCellMetadata(cell) {
  const cellMd = cell.metadata;
  const brdId = Bridged.brdId(cell);
  if (!brdId) throw new Error("Bridged id not found");
  const metadata = { 'brd': brdId, 'cell_id': cell.document.uri.fragment };
  if (cellMd.tags?.length > 0) metadata.tags = cellMd.tags;
  if (cellMd.jupyter) metadata.jupyter = cellMd.jupyter;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}


const _cellKind = ['raw', 'markdown', 'code'];
function getCellType(cell) {
  return _cellKind[cell.kind];
}

/** 
 * @param {vscode.NotebookCell} cell 
 * @returns {StateCell} */
export function processCell(cell) {
  // if (DEBUG) console.log("processCell", cell.index);
  // /* const brd = */ Bridged.bridgedOf(cell);
  const cellData = { idx: cell.index, cell_type: getCellType(cell), source: cell.document.getText() };
  const metadata = getCellMetadata(cell);
  if (metadata) cellData.metadata = metadata;
  if (cell.kind === vscode.NotebookCellKind.Code && cell.outputs.length > 0) {
    cellData.outputs = cell.outputs.map(processOutput);
  }
  if (cellData.outputs?.length === 0) delete cellData.outputs;
  return cellData;
}
