// Adapted from VSCode ipynb serializers
import * as vscode from 'vscode';
import { Bridged } from './bridged.js';

/** 
 * @typedef {Object} StateCell
 * @property {'raw'|'markdown'|'code'} cell_type
 * @property {string} source
 * @property {Object} metadata
 * @property {Object[]|undefined} outputs
 */

const textDecoder = new TextDecoder();

/**
 * Determines if a MIME type is JSON-based
 * @param {string} mime The MIME type
 * @returns {boolean}
 */
function isJsonMime(mime) {
  return mime === 'application/json' || 
         mime.endsWith('+json') ||
         mime.startsWith('application/vnd.jupyter') ||
         mime.includes('json');
}

/**
 * Determines if a MIME type is binary
 * @param {string} mime The MIME type
 * @returns {boolean}
 */
function isBinaryMime(mime) {
  return mime === 'image/png' || 
         mime === 'image/jpeg' || 
         mime === 'image/gif' ||
         mime === 'application/pdf';
}

/**
 * Determines if a MIME type is text-based
 * @param {string} mime The MIME type
 * @returns {boolean}
 */
function isTextMime(mime) {
  return mime.startsWith('text/') || 
         mime === 'image/svg+xml' ||
         mime === 'application/xml';
}

/**
 * Converts a buffer to an appropriate string representation based on MIME type
 * @param {Buffer} data The data buffer
 * @param {string} mime The MIME type
 * @returns {string|object}
 */
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

/**
 * Creates a MIME bundle from output items
 * @param {vscode.NotebookCellOutputItem[]} items Output items
 * @returns {Object} MIME bundle
 */
function getMimeBundle(items) {
  return items.reduce((bundle, item) => {
    if (item.data) {
      bundle[item.mime] = bufferToString(item.data, item.mime);
    }
    return bundle;
  }, {});
}

/**
 * Extracts metadata from an output
 * @param {vscode.NotebookCellOutput} output The output
 * @returns {Object|undefined} Output metadata
 */
function getOutputMetadata(output) {
  if (!output.metadata) return undefined;
  const { outputType, metadata, ...rest } = output.metadata;  // eslint-disable-line no-unused-vars
  const md = { ...rest, ...metadata };
  return Object.keys(md).length > 0 ? md : undefined;
}

/**
 * Splits a multiline string into an array of lines
 * @param {string} source The source string
 * @returns {string[]} Array of lines
 */
function splitMultilineString(source) {
  if (Array.isArray(source)) {
    return source;
  }
  
  const str = source.toString();
  if (str.length > 0) {
    // Each line should be a separate entry, but end with a \n if not last entry
    const arr = str.split('\n');
    return arr
      .map((s, i) => {
        if (i < arr.length - 1) {
          return `${s}\n`;
        }
        return s;
      })
      .filter(s => s.length > 0); // Skip last one if empty
  }
  
  return [];
}

/**
 * Processes a cell output to nbformat structure
 * @param {vscode.NotebookCellOutput} output The output
 * @returns {Object} nbformat output
 */
function processOutput(output) {
  // Create a MIME bundle from output items
  const data = getMimeBundle(output.items);
  let metadata = getOutputMetadata(output);
  
  // Determine output type from metadata or content analysis
  let outputType = output?.metadata?.outputType;
  
  // If no output type in metadata, infer from content
  if (!outputType) {
    // Check for error output
    if (output.items.some(item => item.mime === 'application/vnd.code.notebook.error')) {
      outputType = 'error';
    }
    // Check for stream output (stdout/stderr)
    else if (output.items.some(item => 
      item.mime === 'application/vnd.code.notebook.stdout' || 
      item.mime === 'application/vnd.code.notebook.stderr')) {
      outputType = 'stream';
    }
    // Check for execute result (presence of execution count suggests this)
    else if (metadata?.executionCount !== undefined) {
      outputType = 'execute_result';
    }
    // Default to display_data
    else {
      outputType = 'display_data';
    }
  }
  
  // Process based on output type
  let result;
  switch (outputType) {
    case 'stream': {
      // Determine stream name (stdout/stderr)
      const isStderr = output.items.some(item => item.mime === 'application/vnd.code.notebook.stderr');
      const streamName = isStderr ? 'stderr' : 'stdout';
      
      // Extract text content
      const textItems = output.items
        .filter(item => item.mime === `application/vnd.code.notebook.${streamName}`)
        .map(item => textDecoder.decode(item.data));
      
      const text = textItems.join('');
      result = {
        output_type: 'stream',
        name: streamName,
        text: text// splitMultilineString(text)
      };
      break;
    }
    
    case 'error': {
      // Find error item
      const errorItem = output.items.find(item => item.mime === 'application/vnd.code.notebook.error');
      if (errorItem) {
        const errorData = JSON.parse(textDecoder.decode(errorItem.data));
        result = {
          output_type: 'error',
          ename: errorData.name || '',
          evalue: errorData.message || '',
          traceback: errorData.stack ? errorData.stack.split('\n') : []
        };
      } else {
        // Fallback for missing error data
        result = {
          output_type: 'error',
          ename: '',
          evalue: '',
          traceback: []
        };
      }
      break;
    }
    
    case 'execute_result': {
      result = {
        output_type: 'execute_result',
        data: data,
        execution_count: metadata?.executionCount ?? null,
        metadata: {}
      };
      // Remove executionCount from metadata as it's now in execution_count
      if (metadata?.executionCount !== undefined) {
        delete metadata.executionCount;
      }
      break;
    }
    
    case 'display_data':
    default: {
      result = {
        output_type: 'display_data',
        data: data,
        metadata: {}
      };
      break;
    }
  }
  
  // Add remaining metadata if present
  if (metadata && Object.keys(metadata).length > 0) {
    result.metadata = { ...result.metadata, ...metadata };
  }
  
  return result;
}

/**
 * Gets cell type from VSCode cell kind
 * @param {vscode.NotebookCell} cell The cell
 * @returns {string} nbformat cell type
 */
function getCellType(cell) {
  const cellKind = ['raw', 'markdown', 'code'];
  return cellKind[cell.kind];
}

/**
 * Extracts metadata from a cell
 * @param {vscode.NotebookCell} cell The cell
 * @returns {Object|undefined} Cell metadata
 */
function getCellMetadata(cell) {
  const cellMd = cell.metadata || {};
  const brdId = Bridged.brdId(cell);
  if (!brdId) throw new Error("Bridged id not found");
  
  const metadata = { 
    'brd': brdId, 
    'cell_id': cell.document.uri.fragment 
  };
  
  if (cellMd.tags?.length > 0) metadata.tags = cellMd.tags;
  if (cellMd.jupyter) metadata.jupyter = cellMd.jupyter;
  
  // Add execution_count for code cells
  if (cell.kind === vscode.NotebookCellKind.Code && cellMd.executionOrder !== undefined) {
    metadata.execution_count = cellMd.executionOrder;
  }
  
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * Processes a cell to nbformat structure
 * @param {vscode.NotebookCell} cell
 * @returns {StateCell} nbformat cell
 */
export function processCell(cell) {
  const cellType = getCellType(cell);
  const source = cell.document.getText();//splitMultilineString(cell.document.getText());
  const metadata = getCellMetadata(cell);
  
  // Create base cell structure
  const cellData = {
    idx: cell.index,
    cell_type: cellType,
    source: source,
  };
  
  // Add metadata if present
  if (metadata) {
    cellData.metadata = metadata;
  }
  
  // Add outputs for code cells
  if (cell.kind === vscode.NotebookCellKind.Code && cell.outputs.length > 0) {
    cellData.outputs = cell.outputs.map(processOutput);
    
    // Add execution_count from metadata
    if (metadata?.execution_count !== undefined) {
      cellData.execution_count = metadata.execution_count;
    }
  }
  
  // Remove empty outputs array
  if (cellData.outputs?.length === 0) {
    delete cellData.outputs;
  }
  
  return cellData;
}

export default {
  processCell,
  processOutput,
  getMimeBundle,
  splitMultilineString
};
