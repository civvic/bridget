# Bridget
> FastHTML + HTMX in Jupyter, no server required.  

Bridget enables rich, server-free interactive HTML components in Jupyter notebooks using FastHTML and HTMX. It provides dynamic access to the notebook's state and aims to replicate ipywidgets' functionality with simpler, HTML-based components.

The notebook's state includes its structure, cell content, outputs, and metadata, all captured dynamically as you work, without needing to save the file. This enables powerful introspection and allows for tools that can read and react to the notebook's contents in real-time.


## Key Features

Bridget's core strength is its ability to bring the full power of FastHTML and HTMX into any Jupyter environment, no HTTP server required. It offers real-time notebook introspection, a powerful widget system for creating UIs with minimal JavaScript, and an extended routing system that works seamlessly with Python methods. The framework is designed to be environment-agnostic, supporting VSCode, JupyterLab, and other notebook interfaces.

To enable this, Bridget includes companion extensions for both JupyterLab/Notebook and VSCode/Cursor. These extensions are responsible for capturing the live notebook state within their respective environments, feeding that information directly to Bridget's Python kernel.


## Installation

As Bridget is in early development, it is not yet on PyPI. A development installation requires NodeJS and the pnpm package manager.

To install, first clone the repository. Then, from the project's root directory, install the JavaScript dependencies using pnpm. Finally, perform an editable Python installation. This last step builds the necessary JavaScript components and automatically installs the nbinspect-lab Jupyter extension.

```bash
# 1. Clone the repository
git clone https://github.com/civvic/bridget.git
cd bridget

# 2. Install JavaScript dependencies for the monorepo
pnpm install

# 3. Install Python packages and build the extension
pip install -e ".[dev]"
```


## VSCode Extension Installation

For VSCode and Cursor users, the `nbinspect-vscode` extension must be installed manually. You can find the `.vsix` installation file inside the `packages/nbinspect-vscode` directory. To install, open the Extensions view, click the "..." menu, and select "Install from VSIX...".


## Quick Start

Here is a simple example of a stateful counter component (could also use class instances).

```python
from bridget.common import get_app
from fasthtml.components import Button

app, bridget, rt = get_app()  # Initialize Bridget and app

def counter(n=0):
    @rt('/inc')
    def increment(n:int):
        return Button(f"Count: {n+1}", value=f"{n+1}", name='n', hx_post='/inc', hx_swap='outerHTML')
    return increment(n-1)

counter()
```

For more detailed examples, review the notebooks in the `nbs/` directory, especially `14_bridge.ipynb`, `32_bridget.ipynb`, `50_widget.ipynb`, and the contents of the `nbs/examples/` folder.


## Compatibility and Development

Bridget is developed with [nbdev](https://nbdev.fast.ai/) and requires Python 3.12+. Core dependencies like `fasthtml` and `anywidget` are installed automatically. It is regularly tested on macOS with VSCode, Jupyter Notebook, and JupyterLab, and is expected to function in any environment where `anywidget` is supported. Please note that while most features work in NbClassic, notebook state introspection is not yet implemented for that environment. The project is also expected to work on Windows and Linux.


## Exploring the Codebase
The project is developed entirely in Jupyter Notebooks using `nbdev`. To understand how it works, explore these key source notebooks in the `nbs/` directory.

### FastHTML Foundation
Bridget's core depends on adapting FastHTML for a serverless environment. **`03_fasthtml_patching.ipynb`** details the minimal modifications made to enable this, while **`04_route_provider.ipynb`** explains the modified routing system allows Bridget to use methods as route endpoints.

### The Bridge and Bridget Core
The communication layer is central to the project. **`10_bridge_widget.ipynb`** implements the core `BridgeWidget` infrastructure using `anywidget`, including the `BlockingMixin` for synchronous execution and the `brdimport` utility for managing JavaScript modules.  
Building on this, **`14_bridge.ipynb`** defines the primary `Bridge` class that handles low-level messaging.  

Functionality is extended via a plugin system, detailed in **`14_bridge.ipynb`** and **`16_bridge_plugins.ipynb`**.  
Finally, **`32_bridget.ipynb`** provides the main `Bridget` class and the `get_app` entry point, creating the high-level API.

For practical examples, see **`40_details_json.ipynb`** for an advanced, lazy-loading JSON viewer, **`50_widget.ipynb`** for first steps developing widgets, and the notebooks inside the **`nbs/examples/`** directory for simpler HTMX patterns.

### Notebook State Introspection
While optional, Bridget's most powerful features come from its ability to introspect the notebook's state.  **`15_nb_hooks.ipynb`** and **`21_nb_state.ipynb`** implement the core logic for capturing the live state of the notebook—- its structure, cells, content, and metadata.  
The high-level API for interacting with this state is defined in **`07_nb.ipynb`**. **`21_nb_state.ipynb`** also defines the `Bridge` plugin.

### Companion Extensions
The state introspection functionality is powered by two companion extensions located in the `packages/` directory. `nbinspect-lab` serves JupyterLab and Notebook environments, while `nbinspect-vscode` supports VSCode and Cursor. These extensions act as the front-end agents, capturing notebook events and sending them to the Python kernel for processing.

## Project Status
This is an experimental project that integrates Jupyter, FastHTML, and HTMX.  

Its primary goal, inspired by Donald Knuth's concept of Literate Programming, is to create truly dynamic documents where any content (including cell outputs) can be directly edited and interacted with. The project aims to provide a simple and lightweight IDE-like experience within the notebook itself. This enables a wide range of applications, from authoring programs and libraries in the style of `nbdev` to creating sophisticated live context editors for generative models.

Current status:
- ✅ Core architecture for serverless HTMX and notebook introspection is functional.
- ✅ Key HTMX patterns are supported and demonstrated in the `nbs/examples/` notebooks.
- ⚠️ The API is unstable and subject to significant change.
- ⛔ Not recommended for use in production environments.
- 📝 Documentation and more complex examples are in active development.
