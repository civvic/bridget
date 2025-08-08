/**
 * @fileoverview Common feedback rendering functionality for nbinspect extensions.
 * Extracted from VSCode renderer.js to be shared between VSCode and Lab extensions.
 * Uses vanilla JavaScript for maximum compatibility.
 */

// Constants
const NBSTATE_FEEDBACK_CLS = 'notebook-state-feedback';
const SUMMSTL = `
<style>
  .update-flash { animation: flash 0.5s ease-out; }
  @keyframes flash {
    0% { background-color: pink; }
    100% { background-color: transparent; }
  }
  .cell-info { margin-bottom: 1em; }
  .output-info { margin-left: 2em; }
</style>
`;
const TSFMT = { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 };
const timeFormatter = new Intl.DateTimeFormat(undefined, TSFMT);

// Utility functions
function _truncate(str, maxLength = 100) {
  return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
}

/**
 * Renders HTML for a single state change.
 * @param {Object} change - The state change object
 * @param {Array} change.cells - Array of cells that changed
 * @param {Array} [change.added] - Array of added cell indices
 * @param {Array} [change.removed] - Array of removed cell indices
 * @param {number} change.cellCount - Total cell count after change
 * @returns {string} HTML string
 */
function changeHTML({cells, added, removed, cellCount}) {
  const cc = `Cell count: ${cellCount}\n`;
  const r = removed && removed.length > 0 ? `Removed: ${removed}\n` : '';
  const a = added && added.length > 0 ? `Added: ${added.map(c => c.idx || c).join(', ')}\n` : '';
  
  return cc + r + a + cells.map((cell, idx) => {
    let src = cell.cell ? cell.cell.source : cell.source;
    // source possibly has HTML content, sanitize it
    src = src.replace(/<[^>]*>?/gm, '');
    src = _truncate(JSON.stringify(src));
    idx = cell.idx !== undefined ? cell.idx : idx;
    const cellData = cell.cell || cell;
    
    return `
    <div class="cell-info">
      <strong>Cell ${idx}</strong> (${cellData.cell_type})
      <div class="cell-text">Source: ${src}</div>
      ${cellData.metadata ? `
        <div class="cell-metadata">Metadata: ${Object.keys(cellData.metadata).join(', ')}</div>
      ` : ''}
      ${(cellData.outputs?.length) ? `
        <div class="output-info">Outputs (${cellData.outputs.length}):
          ${cellData.outputs.map(out => `
            <div>Type: ${out.output_type}${out.data ? `
              <div>MIME types: ${Object.keys(out.data).join(', ')}</div>\n` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `}).join('');
}

/**
 * Generates a summary for debugging.
 * @param {Object} message - StateMessage or DiffsMessage
 * @returns {string} HTML string
 */
function messageSummary(message) {
  const changes = message.type === 'diffs' 
      ? message.changes 
      : [{ cells: message.cells, cellCount: message.nbData?.cellCount || message.cellCount }];
  return changes.map(change => changeHTML(change)).join('\n');
}

/**
 * Renders the main notebook state feedback.
 * @param {Object} message - StateMessage or DiffsMessage
 * @param {Object} opts - Options object
 * @param {boolean} [opts.feedback=true] - Show detailed feedback
 * @param {boolean} [opts.hide=false] - Hide the output
 * @param {boolean} [opts.debug=false] - Debug mode enabled
 * @returns {string} HTML string
 */
function renderNBStateFeedback(message, opts = {}) {
  // Set defaults
  const options = {
    feedback: true,
    hide: false,
    debug: false,
    ...opts
  };
  
  // message.timestamp is a number, convert to Date
  const t = new Date(message.timestamp);
  const ts = timeFormatter.format(t);
  
  // opts is an object {feedback: true, hide: false, debug: false}; convert to HTML
  const optsShow = Object.entries(options).map(
    ([k, v]) => `<b>${k}</b>: <span style="color:${v?'green':'red'}">${v}</span>`).join(' ');
  
    if (options.hide) return `
    <div class="${NBSTATE_FEEDBACK_CLS}" style="display: none;"></div>
  `;

  if (!options.feedback) return `
    <div class="${NBSTATE_FEEDBACK_CLS}">
      <div class="timestamp">Last updated: ${ts} - ${optsShow}</div>
    </div>
  `;
  
  const updateClass = "update-flash";
  return `
    <div class="${NBSTATE_FEEDBACK_CLS}">
      <div class="timestamp">Last updated: ${ts} - ${optsShow}</div>
      ${SUMMSTL}
      <details class="${updateClass}">
        <summary><strong>Cells:</strong></summary>
        ${messageSummary(message)}
      </details>
    </div>
  `;
}

/**
 * Creates a simple status text for status bars or minimal displays.
 * @param {Object} message - StateMessage or DiffsMessage
 * @returns {string} Status text
 */
function renderStatusText(message) {
  const timestamp = new Date(message.timestamp).toLocaleTimeString();
  const changeCount = message.type === 'diffs' ? (message.changes?.length || 0) : 0;
  const cellCount = message.nbData?.cellCount || message.cellCount || 'N/A';

  if (message.type === 'state') {
    return `NBState: Initialized (${cellCount} cells)`;
  } else {
    return `NBState: ${changeCount} changes @ ${timestamp} (${cellCount} cells)`;
  }
}

// ES module exports only
export {
  renderNBStateFeedback,
  messageSummary,
  changeHTML,
  renderStatusText,
  NBSTATE_FEEDBACK_CLS,
  SUMMSTL
}; 