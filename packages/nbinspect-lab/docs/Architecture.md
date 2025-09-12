## Architecture Documentation

**`ARCHITECTURE.md`**:

# NBInspect Lab Extension - Architecture Overview

## High-Level Architecture

The NBInspect Lab extension uses a **monitor-based architecture** where each open notebook has its own dedicated monitor that tracks state changes and provides the `$Nb` API when active.

### Key Components

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Plugin        │    │  NotebookMonitor │    │  Python Widgets │
│   (index.ts)    │◄──►│  (per notebook)  │◄──►│  via $Nb API   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  StatusWidget   │    │   ChangeCollator │    │  MIME Renderer  │
│  (status bar)   │    │   (diff logic)   │    │  (feedback UI)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Data Flow

### 1. Notebook Opens
1. **Plugin** detects new notebook via `notebookTracker.widgetAdded`
2. **Plugin** creates dedicated `NotebookMonitor` for the notebook
3. **Monitor** connects to cell signals and creates its own `$Nb` API instance
4. If notebook becomes active, **Plugin** calls `monitor.setActive()`
5. **Active Monitor** sets `window.$Nb = this._renAPI`

### 2. User Edits Notebook
1. **JupyterLab** emits cell change signals
2. **Monitor** receives signals via connected handlers
3. **ChangeCollator** accumulates and processes changes
4. **Monitor** emits state change via `this._stateChanged.emit(message)`
5. **StatusWidget** and **MIME Renderers** receive state updates
6. **Python widgets** receive updates via `$Nb.addStateObserver()` callbacks

### 3. Active Notebook Switches
1. **Plugin** detects change via `notebookTracker.currentChanged`
2. **Plugin** calls `currentMonitor.setInactive()` (if any)
3. **Plugin** calls `newMonitor.setActive()`
4. **New Monitor** sets `window.$Nb = this._renAPI`
5. **MIME Renderers** automatically reconnect to new `$Nb`

## Key Architectural Decisions

### Monitor-per-Notebook
- **Before**: Single `StateManager` shared by all notebooks (caused cross-contamination)
- **After**: Each notebook has its own `NotebookMonitor` with isolated state
- **Benefit**: Perfect isolation between notebooks, no cross-contamination

### Active Monitor Pattern  
- Only the **active notebook's monitor** exposes `window.$Nb`
- **Inactive monitors** continue tracking their notebook's state internally
- **Python widgets** always interact with the active notebook's state
- **Benefit**: Maintains VSCode API compatibility while supporting multiple notebooks

### Direct Function Calls
- **VSCode**: Complex async messaging between extension and renderer
- **Lab**: Direct function calls between components (no messaging overhead)
- **Benefit**: Simpler, faster, more reliable communication

## Component Responsibilities

### Plugin (`index.ts`)
- **Orchestrates** notebook lifecycle (create/dispose monitors)
- **Manages** active notebook switching
- **Coordinates** StatusWidget notifications
- **Provides** MIME renderer factory

### NotebookMonitor (`notebookMonitor.ts`)  
- **Owns** notebook state for one specific notebook
- **Tracks** all cell changes via JupyterLab signals
- **Provides** `$Nb` API when active
- **Emits** state changes to subscribers
- **Manages** change collation and debouncing

### ChangeCollator (`changeCollatorLab.ts`)
- **Accumulates** cell changes over time
- **Generates** diff messages when changes complete
- **Handles** execution state tracking
- **Provides** change deduplication and optimization

### StatusWidget (`statusWidget.ts`)
- **Displays** active notebook state in status bar
- **Subscribes** to active monitor's state changes only
- **Shows** visual feedback for state updates

### MIME Renderer (`mimeRenderer.ts`)
- **Displays** notebook state feedback in cell outputs
- **Subscribes** to state changes via `window.$Nb` (like Python widgets)
- **Handles** configuration from Python `display()` calls
- **Auto-reconnects** when active notebook changes

## State Message Flow

```
Cell Change → Monitor → ChangeCollator → Monitor.updateState() → 
              ↓
    ┌─────────────────┐
    │ _stateChanged   │ (Lumino Signal)
    │     .emit()     │
    └─────────────────┘
              ↓
    ┌─────────────────┐
    │ All Subscribers │
    │ • StatusWidget  │
    │ • MIME Renderer │ 
    │ • Python Widgets│
    └─────────────────┘
```

## Thread Safety & Isolation

- **Per-notebook isolation**: Each monitor operates independently
- **Signal-based communication**: Uses JupyterLab's Lumino signals (thread-safe)
- **Debounced processing**: Prevents excessive updates during rapid changes
- **Clean disposal**: Proper cleanup when notebooks close

## Comparison with VSCode Extension

| Aspect | VSCode Extension | Lab Extension |
|--------|------------------|---------------|
| **Architecture** | Extension ↔ Renderer messaging | Direct function calls |
| **State Management** | Single renderer per notebook | Monitor per notebook |
| **Global API** | Per-notebook `$Nb` | Shared `$Nb` (active notebook) |
| **Communication** | Async postMessage | Sync function calls |
| **Isolation** | Natural (separate webviews) | Engineered (monitor pattern) |

## Development Notes

- **Source maps enabled** - Debug TypeScript directly in browser DevTools  
- **Hot reload working** - Changes picked up automatically during development
- **Build time acceptable** - No optimization needed currently
- **Watch mode functional** - `pnpm watch` works reliably
