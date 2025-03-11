// nbSerializer.js - Adapted from VSCode ipynb serializers.ts
import * as vscode from 'vscode';

import { Bridged } from './bridged.mjs';
import { defaultNotebookFormat } from './utils.mjs';

const textDecoder = new TextDecoder();

// Core utility functions for MIME type handling
function isJsonMime(mime) {
  return  mime === 'application/json' || 
          mime.endsWith('+json') ||
          mime.startsWith('application/vnd.jupyter') ||
          mime.includes('json');
}

function isBinaryMime(mime) {
  return mime === 'image/png' || 
          mime === 'image/jpeg' || 
          mime === 'image/gif' ||
          mime === 'application/pdf';
}

function isTextMime(mime) {
  return mime.startsWith('text/') || 
          mime === 'image/svg+xml' ||
          mime === 'application/xml';
}

/**
 * Converts output data based on MIME type
 * @param {Uint8Array} value The data
 * @param {string} mime The MIME type
 * @returns {string|object} Converted data
 */
function convertOutputMimeToJupyterOutput(value, mime) {
  if (!value) {
    return '';
  }
  
  try {
    if (mime === 'application/vnd.code.notebook.error') {
      const stringValue = textDecoder.decode(value);
      return JSON.parse(stringValue);
    } else if (mime.startsWith('text/') || isTextMime(mime)) {
      const stringValue = textDecoder.decode(value);
      return splitMultilineString(stringValue);
    } else if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
      // Images in Jupyter are stored in base64 encoded format
      return Buffer.from(value).toString('base64');
    } else if (isJsonMime(mime)) {
      const stringValue = textDecoder.decode(value);
      return stringValue.length > 0 ? JSON.parse(stringValue) : stringValue;
    } else if (mime === 'image/svg+xml') {
      return splitMultilineString(textDecoder.decode(value));
    } else {
      return textDecoder.decode(value);
    }
  } catch (ex) {
    console.warn(`Error converting ${mime}:`, ex);
    return '';
  }
}

/**
 * Splits a multiline string into an array of lines
 * @param {string|string[]} source The source string
 * @returns {string[]} Array of lines
 */
function splitMultilineString(source) {
  if (Array.isArray(source)) {
    return source;
  }
  
  const str = source.toString();
  if (str.length > 0) {
    const arr = str.split('\n');
    return arr
      .map((s, i) => {
        if (i < arr.length - 1) {
          return `${s}\n`;
        }
        return s;
      })
      .filter(s => s.length > 0);
  }
  
  return [];
}

/**
 * Gets the output stream type (stdout/stderr)
 * @param {vscode.NotebookCellOutput} output The output
 * @returns {string} Stream type
 */
function getOutputStreamType(output) {
  if (output.items.some(item => item.mime === 'application/vnd.code.notebook.stderr')) {
    return 'stderr';
  }
  if (output.items.some(item => item.mime === 'application/vnd.code.notebook.stdout')) {
    return 'stdout';
  }
  return undefined;
}

/**
 * Processes stream output
 * @param {vscode.NotebookCellOutput} output The output
 * @returns {Object} nbformat stream output
 */
function convertStreamOutput(output) {
  const outputs = [];
  
  output.items
    .filter(item => item.mime === 'application/vnd.code.notebook.stderr' || 
                    item.mime === 'application/vnd.code.notebook.stdout')
    .map(item => textDecoder.decode(item.data))
    .forEach(value => {
      // Process multiline text
      const lines = value.split('\n');
      if (outputs.length && lines.length && lines[0].length > 0) {
        outputs[outputs.length - 1] = `${outputs[outputs.length - 1]}${lines.shift()}`;
      }
      for (const line of lines) {
        outputs.push(line);
      }
    });

  // Add newlines to all but last line
  for (let i = 0; i < (outputs.length - 1); i++) {
    outputs[i] = `${outputs[i]}\n`;
  }

  // Remove empty last line
  if (outputs.length && outputs[outputs.length - 1].length === 0) {
    outputs.pop();
  }

  const streamType = getOutputStreamType(output) || 'stdout';

  return {
    output_type: 'stream',
    name: streamType,
    text: outputs
  };
}

/**
 * Processes error output
 * @param {vscode.NotebookCellOutput} output The output
 * @returns {Object} nbformat error output
 */
function translateCellErrorOutput(output) {
  const errorItem = output.items.find(item => item.mime === 'application/vnd.code.notebook.error');
  if (!errorItem) {
    return {
      output_type: 'error',
      ename: '',
      evalue: '',
      traceback: []
    };
  }

  const errorData = JSON.parse(textDecoder.decode(errorItem.data));
  return {
    output_type: 'error',
    ename: errorData.name || '',
    evalue: errorData.message || '',
    traceback: errorData.stack ? errorData.stack.split('\n') : []
  };
}

/**
 * Translates VSCode cell output to nbformat output
 * @param {vscode.NotebookCellOutput} output The output
 * @returns {Object} nbformat output
 */
function translateCellDisplayOutput(output) {
  const customMetadata = output.metadata;
  let result;
  
  // Determine output type
  const outputType = customMetadata?.outputType;
  
  switch (outputType) {
    case 'error': {
      result = translateCellErrorOutput(output);
      break;
    }
    case 'stream': {
      result = convertStreamOutput(output);
      break;
    }
    case 'display_data': {
      result = {
        output_type: 'display_data',
        data: output.items.reduce((prev, curr) => {
          prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.data, curr.mime);
          return prev;
        }, {}),
        metadata: customMetadata?.metadata || {}
      };
      break;
    }
    case 'execute_result': {
      result = {
        output_type: 'execute_result',
        data: output.items.reduce((prev, curr) => {
          prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.data, curr.mime);
          return prev;
        }, {}),
        execution_count: customMetadata?.executionCount ?? null,
        metadata: customMetadata?.metadata || {}
      };
      break;
    }
    default: {
      // Infer type from content if not specified
      if (output.items.some(item => item.mime === 'application/vnd.code.notebook.error')) {
        result = translateCellErrorOutput(output);
      } else if (output.items.some(item => 
        item.mime === 'application/vnd.code.notebook.stdout' || 
        item.mime === 'application/vnd.code.notebook.stderr')) {
        result = convertStreamOutput(output);
      } else if (customMetadata?.executionCount !== undefined) {
        result = {
          output_type: 'execute_result',
          data: output.items.reduce((prev, curr) => {
            prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.data, curr.mime);
            return prev;
          }, {}),
          execution_count: customMetadata.executionCount,
          metadata: customMetadata?.metadata || {}
        };
      } else {
        result = {
          output_type: 'display_data',
          data: output.items.reduce((prev, curr) => {
            prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.data, curr.mime);
            return prev;
          }, {}),
          metadata: customMetadata?.metadata || {}
        };
      }
    }
  }
  
  return result;
}

/**
 * Gets cell metadata
 * @param {vscode.NotebookCell} cell The cell
 * @returns {Object} Cell metadata
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
  
  return metadata;
}

/**
 * Creates a markdown cell from a notebook cell
 * @param {vscode.NotebookCell} cell The cell
 * @returns {Object} nbformat markdown cell
 */
function createMarkdownCellFromNotebookCell(cell) {
  const cellMetadata = getCellMetadata(cell);
  const markdownCell = {
    cell_type: 'markdown',
    source: splitMultilineString(cell.document.getText()),
    metadata: cellMetadata || {}
  };
  
  if (cellMetadata?.id) {
    markdownCell.id = cellMetadata.id;
  }
  
  return markdownCell;
}

/**
 * Creates a raw cell from a notebook cell
 * @param {vscode.NotebookCell} cell The cell
 * @returns {Object} nbformat raw cell
 */
function createRawCellFromNotebookCell(cell) {
  const cellMetadata = getCellMetadata(cell);
  const rawCell = {
    cell_type: 'raw',
    source: splitMultilineString(cell.document.getText()),
    metadata: cellMetadata || {}
  };
  
  if (cellMetadata?.attachments) {
    rawCell.attachments = cellMetadata.attachments;
  }
  
  if (cellMetadata?.id) {
    rawCell.id = cellMetadata.id;
  }
  
  return rawCell;
}

/**
 * Creates a code cell from a notebook cell
 * @param {vscode.NotebookCell} cell The cell
 * @returns {Object} nbformat code cell
 */
function createCodeCellFromNotebookCell(cell) {
  const cellMetadata = getCellMetadata(cell);
  
  const codeCell = {
    cell_type: 'code',
    execution_count: cellMetadata.execution_count ?? null,
    source: splitMultilineString(cell.document.getText()),
    outputs: cell.outputs.map(translateCellDisplayOutput),
    metadata: cellMetadata || {}
  };
  
  if (cellMetadata?.id) {
    codeCell.id = cellMetadata.id;
  }
  
  // Remove empty outputs array
  if (codeCell.outputs.length === 0) {
    delete codeCell.outputs;
  }
  
  return codeCell;
}

/**
 * Creates a Jupyter cell from a notebook cell
 * @param {vscode.NotebookCell} cell The cell
 * @returns {Object} nbformat cell
 */
function createJupyterCellFromNotebookCell(cell) {
  if (cell.kind === vscode.NotebookCellKind.Markup) {
    return createMarkdownCellFromNotebookCell(cell);
  } else if (cell.document.languageId === 'raw') {
    return createRawCellFromNotebookCell(cell);
  } else {
    return createCodeCellFromNotebookCell(cell);
  }
}

/**
 * Processes a cell to nbformat structure
 * @param {vscode.NotebookCell} cell The cell
 * @returns {Object} nbformat cell
 */
export function processCell(cell) {
  return createJupyterCellFromNotebookCell(cell);
}

/**
 * Gets notebook metadata
 * @param {vscode.NotebookDocument} document
 * @returns {Object}
 */
export function getNotebookMetadata(document) {
	const existingContent = document.metadata || {};
	const notebookContent = {};
	// notebookContent.cells = existingContent.cells || [];
	notebookContent.nbformat = existingContent.nbformat || defaultNotebookFormat.major;
	notebookContent.nbformat_minor = existingContent.nbformat_minor ?? defaultNotebookFormat.minor;
	notebookContent.metadata = existingContent.metadata || {};
	return notebookContent;
}

export default {
  processCell,
  translateCellDisplayOutput,
  splitMultilineString,
  getNotebookMetadata
};
