# NBInspect Lab Extension - Usage Examples

## Overview

This document provides examples and references for using the NBInspect Lab extension with Python widgets and notebooks.

## Test & Debug Notebooks

### `outputs.ipynb`
**Primary testing and debugging notebook** - Contains comprehensive examples of different output types and widget interactions.

**Key Examples:**
- **Cell #37**: Complete working widget example using `anywidget`
- **Cells #24-36**: MIME renderer configuration and update examples  
- **Cells #1-23**: Various output types (HTML, JavaScript, images, widgets, etc.)
- **Cells #38-41**: Widget communication and state requests

**Usage:**
```bash
cd packages/nbinspect-lab
jupyter lab nbs/outputs.ipynb
```

### `07_nb.ipynb` (from main Bridget project)
**Comprehensive documentation notebook** - Contains detailed explanations of message handling and helper functions.

**Key Content:**
- **Message Types**: Detailed examples of `DiffsMessage` and `StateMessage` structures
- **Helper Functions**: Utilities for processing state changes
- **Diff Processing**: How to handle incremental notebook changes
- **State Analysis**: Examples of extracting useful information from state messages

**Location:** `../../nbs/07_nb.ipynb` (relative to lab extension directory)

## Quick Start Examples

### 1. Basic State Observer Widget

```python
import anywidget
import ipywidgets as W
from IPython.display import display

class StateObserverWidget(anywidget.AnyWidget):
    _esm = '''
    export default {
        async initialize({ model }) {
            function onStateChange(state) {
                console.log('State changed:', state);
                model.send({ 
                    type: state.type,
                    cellCount: state.nbData?.cellCount || 0,
                    timestamp: state.timestamp 
                });
            }
            
            // Subscribe to state changes
            if (window.$Ren) {
                const cleanup = window.$Ren.addStateObserver(onStateChange);
                return cleanup; // Return cleanup function
            }
        }
    };
    '''
    
    def __init__(self):
        super().__init__()
        self.on_msg(self._handle_message)
        self.output = W.Output()
        display(self.output)
    
    def _handle_message(self, widget, msg, buffers):
        with self.output:
            print(f"Received: {msg}")

# Create and display widget
widget = StateObserverWidget()
```

### 2. State Request Widget

```python
class StateRequestWidget(anywidget.AnyWidget):
    _esm = '''
    export default {
        async initialize({ model }) {
            // Request full state
            const button = document.createElement('button');
            button.textContent = 'Get Full State';
            button.onclick = async () => {
                if (window.$Ren) {
                    try {
                        const state = await window.$Ren.aupdate({
                            id: Date.now().toString(),
                            update: 'full'
                        });
                        model.send({ 
                            action: 'state_received',
                            cellCount: state.cells?.length || 0,
                            type: state.type
                        });
                    } catch (error) {
                        model.send({ 
                            action: 'error',
                            message: error.message 
                        });
                    }
                }
            };
            
            model.el.appendChild(button);
        }
    };
    '''
    
    def __init__(self):
        super().__init__()
        self.on_msg(self._handle_message)
        self.output = W.Output()
        display(self.output)
    
    def _handle_message(self, widget, msg, buffers):
        with self.output:
            if msg['action'] == 'state_received':
                print(f"Notebook has {msg['cellCount']} cells (type: {msg['type']})")
            elif msg['action'] == 'error':
                print(f"Error: {msg['message']}")

# Create widget
request_widget = StateRequestWidget()
```

### 3. Configure Extension from Python

```python
from IPython.display import display

# Enable feedback and debugging
display({
    'application/x-notebook-state': {
        'feedback': True,
        'debug': True,
        'update': 'full'  # Request full state update
    }
}, raw=True)
```

```python
# Request incremental updates only
display({
    'application/x-notebook-state': {
        'feedback': True,
        'debug': False,
        'update': 'diff'  # Request only changes
    }
}, raw=True)
```

