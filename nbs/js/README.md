# Bridget JavaScript Modules

Browser-side JavaScript components that enable Bridget's functionality. These modules are bundled and loaded automatically by the Bridge system.

## Core Modules

### `brdimport.js`
Dynamic ES module import transformer. Converts static `import` statements to dynamic `await import()` for runtime module loading. See `02_JStransform.ipynb` for implementation details.

### `bridge.js`
Core Bridge communication layer. Handles message passing between browser and Python kernel via Comm protocol.

### `bridget.js`
Main Bridget client. Coordinates Bridge, HTMX, and widget functionality.

### `observer.js`
DOM mutation observer for tracking dynamic content changes.

### `commander.js`
Python-callable wrapper for HTMX JavaScript API. Enables Python code to trigger HTMX swaps and operations.

### `brdmark.js`
Custom HTML element (`<brd-mark>`) for marking and identifying cell outputs.

### Canvas & Logger

- `bcanvas.js` - Browser canvas for log display
- `fcanvas.js` - HTML-integrated canvas
- `nbstate.js` - Notebook state management

## Development

These files are the **source** in `nbs/js/` and **bundled output** in `bridget/js/`.

**Edit:** `nbs/js/*.js`  
**Bundle:** Run `nbdev_prepare` (handled automatically)  
**Load:** Bridget loads these automatically via `BridgeWidget`

## Architecture

```
Python (Kernel)
    ↕ Comm protocol
Bridge (bridge.js)
    ↕ Message passing
HTMX / Bridget (bridget.js)
    ↕ DOM operations
Notebook Output Cells
```

See notebooks for detailed documentation:
- `10_bridge_widget.ipynb` - Bridge widget & bundling
- `14_bridge.ipynb` - Bridge system
- `16_bridge_plugins.ipynb` - Plugin examples
```
