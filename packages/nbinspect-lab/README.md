# nbinspect-lab: JupyterLab State Inspector for Bridget

`nbinspect-lab` is the companion JupyterLab and Jupyter Notebook extension for the Bridget project. It runs in the browser, monitoring the notebook's structure, cell content, and outputs in real-time. This live state information is then sent to the Bridget Python kernel, enabling its powerful introspection and dynamic capabilities.

## Features

The extension actively monitors the notebook and provides a front-end API for its findings. Key features include tracking changes to the notebook's cell structure and content, monitoring cell execution status, and providing visual feedback through a custom MIME renderer. All state changes are broadcast via a global `window.$Nb` API that front-end components can subscribe to.

## Requirements
*   JupyterLab >= 4.0.0 or Notebook >= 7.0
*   The `bridget` Python package (for standard usage).

## Installation

This extension is designed to be installed as part of the main `bridget` repository. Please follow the installation instructions in the [main project's README file](../../README.md).

Alternatively, you can install this extension standalone from its directory:

```bash
# From packages/nbinspect-lab:
pip install -e .
```

**Note on Standalone Usage:** While `nbinspect-lab` is part of Bridget, it has no direct dependency on the Python package and can be used in isolation. If you choose this path, you are responsible for creating your own front-end widget to subscribe to the state change events provided by the extension's `window.$Nb` API.

## Uninstalling

To remove the extension:

```bash
pip uninstall nbinspect_lab
```

You can verify removal with:
```bash
pip list | grep nbinspect
jupyter labextension list
```

## Development

`nbinspect-lab` is a package within the `bridget` pnpm monorepo. To contribute, you will need NodeJS and the `pnpm` package manager.

### Development Setup

1. **Install Dependencies:** From the repository root:
   ```bash
   pnpm install
   ```

2. **Install Extension in Editable Mode:** From this directory:
   ```bash
   pip install -e .
   ```

3. **Enable Live Reloading (Optional):** For automatic rebuilds during development:
   ```bash
   jupyter labextension develop . --overwrite
   ```

### Development Workflow

```bash
# In one terminal (from packages/nbinspect-lab):
pnpm watch

# In another terminal:
jupyter lab
```

After making changes, refresh your browser to see updates.

### Packaging the Extension

Instructions for creating a release are in [RELEASE.md](RELEASE.md).

## Architecture: Session Management

The extension uses a session-aware architecture to handle JupyterLab's shared window context:

### Key Components
- **SessionManager**: Global state manager mapping file paths to session state
- **NotebookMonitor**: Document-focused monitor that queries SessionManager
- **Session Lifecycle**: State persists across panel close/reopen, cleans up on kernel restart

### Session Flow
1. Notebook opens → Monitor created → Queries SessionManager for existing state
2. Notebook closes → Monitor disposed → State remains in SessionManager  
3. Notebook reopens → New monitor → Retrieves existing state from SessionManager
4. Kernel restarts → SessionManager cleans up session state
