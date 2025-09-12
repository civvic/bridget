# NBInspect Lab Extension - Python Widget API

## Overview

The NBInspect Lab extension provides a global `$Nb` API for Python widgets to monitor and interact with notebook state changes. This API maintains compatibility with the VSCode extension.

## Global API: `window.$Nb`

The `$Nb` object is available in the browser's global scope and provides the following methods:

### `addStateObserver(callback)`
Subscribe to notebook state changes.

**Parameters:**
- `callback: (state: DiffsMessage | StateMessage) => void` - Function called when state changes

**Returns:**
- `() => void` - Cleanup function to unsubscribe

**Example:**
```javascript
const unsubscribe = window.$Nb.addStateObserver((state) => {
    console.log('Notebook state changed:', state);
});

// Later, to unsubscribe:
unsubscribe();
```

### `getNBState()`
Get the current notebook state.

**Returns:**
- `DiffsMessage | StateMessage | null` - Current notebook state or null if none

### `update(message)`
Request a synchronous state update.

**Parameters:**
- `message: MIMEMessage` - Update configuration

### `aupdate(message)`
Request an asynchronous state update.

**Parameters:**
- `message: MIMEMessage` - Update configuration

**Returns:**
- `Promise<DiffsMessage | StateMessage>` - Promise resolving to updated state

## Message Types

### StateMessage (Full State)
Complete notebook state snapshot:
```typescript
{
  type: 'state';
  origin: string;           // Notebook path
  timestamp: number;        // When state was captured
  cells: Array<{           // All notebook cells
    idx: number;           // Cell index
    cell: StateCell;       // Cell content and metadata
  }>;
  nbData?: NBData;         // Notebook-level metadata
}
```

### DiffsMessage (Incremental Changes)
Incremental notebook changes:
```typescript
{
  type: 'diffs';
  origin: string;          // Notebook path
  timestamp: number;       // When changes occurred
  changes: StateChange[];  // Array of change sets
  nbData?: NBData;        // Notebook-level metadata
}
```

### MIMEMessage (Update Requests)
Configuration for update requests:
```typescript
{
  id: string;              // Unique request ID
  update: 'full' | 'diff' | 'opts' | null;
  feedback?: boolean;      // Show visual feedback
  hide?: boolean;         // Hide renderer output
  debug?: boolean;        // Enable debug logging
}
```

## Usage Examples

### Basic State Monitoring
```javascript
// Subscribe to all state changes
const cleanup = window.$Nb.addStateObserver((state) => {
    if (state.type === 'diffs') {
        console.log('Incremental changes:', state.changes);
    } else if (state.type === 'state') {
        console.log('Full state:', state.cells);
    }
});
```

### Request State Updates
```javascript
// Synchronous update request
window.$Nb.update({
    id: 'my-request-1',
    update: 'full',
    feedback: true
});

// Asynchronous update request
const state = await window.$Nb.aupdate({
    id: 'my-request-2', 
    update: 'diff'
});
console.log('Current state:', state);
```

## Complete Examples

- **`outputs.ipynb`** - Testing and debugging examples, see cell #37 for working widget
- **`07_nb.ipynb`** - Comprehensive documentation and examples of handling diffs/full messages with helpers

## Python Integration

From Python notebooks, use the MIME renderer to configure the extension:

```python
from IPython.display import display

# Configure extension
display({
    'application/x-notebook-state': {
        'feedback': True,
        'debug': True,
        'update': 'full'
    }
}, raw=True)
```
```
