

# nbinspect-vscode: VSCode State Inspector for Bridget

`nbinspect-vscode` is the companion VSCode and Cursor extension for the
Bridget project. It integrates with the VSCode notebook interface to
monitor a notebook’s state in real-time and makes that information
available to front-end JavaScript components.

## How It Works

The extension runs a monitoring process in the VSCode extension host
that listens for all notebook events (cell changes, execution, etc.). It
intelligently batches these events and sends them to a custom notebook
renderer. This renderer, running in a sandboxed webview, creates a
`window.$Nb` object that acts as a bridge, allowing Bridget’s
`anywidget` components to access the live notebook state.

## Installation

This extension is designed to be installed manually as part of the main
`bridget` repository. Please follow the installation instructions in the
[main project’s README file](../../README.md).

You can find the installable `nbinspect-*.vsix` file in this directory.
To install, open the Extensions view (Ctrl+Shift+X) in VSCode/Cursor,
click the “…” menu, and select “Install from VSIX…”.

## Development

`nbinspect-vscode` is a package within the `bridget` pnpm monorepo. To
contribute, you will need NodeJS and the `pnpm` package manager.

### Setup

From the `bridget` repository root, run `pnpm install` to install all
JavaScript dependencies for the monorepo, including those for this
package.

``` bash
# In the Bridget root directory
pnpm install
```

### VSCode Development Environment

For the best development experience, including debugging and integrated
tasks, we recommend opening the `packages/nbinspect-vscode` folder
*directly* in a new VSCode window.

You can then create a `.vscode` directory inside this folder with the
following configuration files.

#### `launch.json` for Debugging

This file configures the debugger. Pressing `F5` will launch a new
“Extension Development Host” window with the extension running, allowing
you to test changes and use the debugger.

``` json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run nbinspect-vscode",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ],
      "outFiles": [
        "${workspaceFolder}/dist/**/*.js"
      ],
      "debugWebviews": true,
      "sourceMaps": true
    }
  ]
}
```

#### `tasks.json` for Auto-Rebuild

This file sets up a background task to automatically recompile the
extension when you save a file. The `launch.json` configuration will run
this task automatically when you start debugging.

``` json
// .vscode/tasks.json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "pnpm: watch",
      "type": "npm",
      "script": "watch",
      "group": {
        "kind": "build",
        "isDefault": true
      },
      "problemMatcher": "$esbuild-watch",
      "isBackground": true,
      "presentation": {
        "reveal": "never"
      }
    }
  ]
}
```

### Packaging the Extension

To create a new `.vsix` package for distribution:

1.  **Build the extension:**

    ``` bash
    # From this directory (packages/nbinspect-vscode):
    pnpm compile
    ```

2.  **Create the package:**

    ``` bash
    # Install vsce globally if you haven't already
    npm install -g @vscode/vsce

    # Package the extension
    pnpm version patch
    vsce package
    ```

This will create a `nbinspect-*.vsix` file in the current directory that
can be installed in VSCode/Cursor.
