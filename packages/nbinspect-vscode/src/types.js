/**
 * @typedef {Object} NBData
 * @property {number} cellCount
 * @property {Object|undefined} [metadata]
 * @property {string|undefined} [notebookType]
 * @property {string|undefined} [notebookUri]
 */

/** 
 * @typedef {Object} StateChange
 * @property {StateCell[]} cells - state cells
 * @property {StateCell[]|undefined} added - added cells
 * @property {number[]|undefined} removed - cell indices of removed cells
 * @property {number} cellCount - number of cells after change
 */

/**
 * @typedef {Object} StateMessage
 * @property {'state'} type - Message type identifier
 * @property {string} origin - Notebook URI
 * @property {number} timestamp - Timestamp of the state message
 * @property {StateCell[]} cells - list of state cells
 * @property {NBData|undefined} NBData - Notebook metadata
 * @property {string|undefined} reqId - ID of the request
 * @property {string|undefined} [message] - Error message
 */

/**
 * @typedef {Object} DiffsMessage
 * @property {'diffs'} type - Message type identifier
 * @property {string} origin - Notebook URI
 * @property {number} timestamp - Timestamp of the state message
 * @property {StateChange[]} changes - list of state changes
 * @property {NBData|undefined} NBData - Notebook metadata
 * @property {string|undefined} reqId - ID of the request
 * @property {string|undefined} [message] - Error message
 */

/**
 * @typedef {Object} RendererStateMessage
 * @property {'getState' | 'updateState' | 'updateOpts'} type - Message type identifier
 * @property {string} reqId - ID of the request
 * @property {Object} opts - Options for the renderer
 * @property {string} origin - Origin of the request (window)
 */

/**
 * @typedef {Object} RendererDeregisterMessage
 * @property {'deregister'} type - Message type identifier
 */

/** 
 * @typedef {Object} StateCell
 * @property {'raw'|'markdown'|'code'} cell_type
 * @property {number} idx - cell index
 * @property {string} source
 * @property {Object} metadata
 * @property {Object[]|undefined} outputs
 */

// /** 
//  * @typedef {Object} CellData
//  * @property {'code' | 'markdown' | 'raw'} cell_type
//  * @property {string} source
//  * @property {Object} [metadata]
//  * @property {Array<OutputData>} [outputs]
//  */ 

// /** 
//  * @typedef {Object} OutputData
//  * @property {'stream' | 'display_data' | 'execute_result' | 'error'} output_type
//  * @property {Object} [data]
//  * @property {Object} [metadata]
//  */
