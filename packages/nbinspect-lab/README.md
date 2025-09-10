# nbinspect-lab: JupyterLab State Inspector for Bridget

[![Github Actions Status](https://github.com/civvic/bridget/workflows/Build/badge.svg)](https://github.com/civvic/bridget/actions/workflows/build.yml)


`nbinspect-lab` is the companion JupyterLab and Jupyter Notebook extension for the Bridget project. It runs in the browser, monitoring the notebook's structure, cell content, and outputs in real-time. This live state information is then sent to the Bridget Python kernel, enabling its powerful introspection and dynamic capabilities.


## Features

The extension actively monitors the notebook and provides a front-end API for its findings. Key features include tracking changes to the notebook's cell structure and content, monitoring cell execution status, and providing visual feedback through a custom MIME renderer. All state changes are broadcast via a global `window.$Ren` API that front-end components can subscribe to.


## Requirements
*   JupyterLab >= 4.0.0 or Notebook >= 7.0
*   The `bridget` Python package (for standard usage).

## Installation
This extension is designed to be installed as part of the main `bridget` repository. Please follow the installation instructions in the [main project's README file](../../README.md). A typical development installation is done by running `pip install -e ".[dev]"` from the repository root, which automatically handles this extension.

**Note on Standalone Usage:** While `nbinspect-lab` is part of Bridget, it has no direct dependency on the Python package and can be used in isolation. If you choose this path, you are responsible for creating your own front-end widget to subscribe to the state change events provided by the extension's `window.$Ren` API.


## Development

`nbinspect-lab` is a package within the `bridget` pnpm monorepo. To contribute, you will need NodeJS and the `pnpm` package manager. The setup process begins at the root of the `bridget` repository.


### Initial Setup

1.  **Install All Monorepo Dependencies:** From the repository root, `pnpm` will install dependencies for all packages, including this one.
    ```bash
    # In the Bridget/ root directory
    pnpm install
    ```

2.  **Install Python & Link Extension:** The standard Bridget development installation also installs this extension in editable mode.
    ```bash
    # In the Bridget/ root directory
    pip install -e ".[dev]"
    ```

3.  **Enable Live Reloading:** For an efficient development workflow, create a symbolic link that tells JupyterLab to use your local source code. This command **must be run from this package's directory**.
    ```bash
    # Navigate into the package directory
    cd packages/nbinspect-lab

    # Link the extension for live reloading
    jupyter labextension develop . --overwrite
    ```

### Watching for Changes

With the setup complete, you can start a watch process that automatically rebuilds the extension whenever you save a file.

```bash
# In one terminal (run from packages/nbinspect-lab):
pnpm watch

# In a second terminal (run from any directory):
jupyter lab
```

After saving changes, `pnpm watch` will rebuild the extension. Simply refresh your browser in JupyterLab to see the updates.

### Uninstalling the Development Version

To remove the development version, unlink the extension from JupyterLab and uninstall the Python package.

```bash
jupyter labextension uninstall nbinspect-lab
pip uninstall nbinspect_lab
```

### Packaging the Extension

Instructions for creating a release are in [RELEASE.md](RELEASE.md).
