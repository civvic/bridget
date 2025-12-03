# Bridget Extensions

Companion extensions that enable Bridget to access notebook state in real-time.

## Why Extensions?

Jupyter/VSCode kernels don't know about notebook structure (cells, outputs, order). These extensions monitor the notebook in the front-end and make that state available to Bridget.

## Packages

### `nbinspect-vscode/`
VSCode/Cursor extension. See [nbinspect-vscode/README.md](nbinspect-vscode/README.md).

**Installation:** Install `.vsix` file from Extensions view  
**Users:** VSCode, Cursor notebook users

### `nbinspect-lab/`
JupyterLab/Jupyter Notebook extension. See [nbinspect-lab/README.md](nbinspect-lab/README.md).

**Installation:** `pip install` (part of Bridget)  
**Users:** JupyterLab, Jupyter Notebook 7+ users

## Common Architecture

Both extensions:
1. Monitor notebook events (cell changes, execution)
2. Build/maintain notebook state
3. Expose via `window.$Nb` API
4. Bridge widgets subscribe to state changes

**Note:** These are **maintainer-level** packages. End users just install them as part of Bridget setup.
