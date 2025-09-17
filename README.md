# Bridget
> FastHTML + HTMX in Jupyter, no server required.  

Bridget brings rich, server-free interactive HTML components to Jupyter notebooks using **FastHTML** and **HTMX**. It provides dynamic access to the notebook’s state and aims to replicate much of `ipywidgets`’ functionality with simpler, HTML-based components.

The notebook state includes its structure, cell content, outputs, and metadata, all captured live as you work—without needing to save the file. This enables powerful introspection and allows tools to read and react to notebook contents in real time.


## Key Features

- **Serverless HTMX + FastHTML**: full FastHTML + HTMX functionality in Jupyter environments, with no HTTP server required.  
- **Extended FastHTML routing system**: integrates seamlessly with Python methods.  
- **Widget system (WIP)**: build UI components with minimal JavaScript.  
- **Real-time notebook introspection**: capture the full notebook structure dynamically, without `.ipynb` files.  
- **Environment-agnostic**: supports VSCode, JupyterLab, and other interfaces.  

Bridget relies on companion extensions for JupyterLab/Notebook and VSCode/Cursor. These capture the live notebook state and feed it directly to Bridget’s Python kernel.


## Installation

As Bridget is in early development, it is not yet on PyPI. A development installation requires NodeJS and the pnpm package manager.

Clone the repository, install JS dependencies with `pnpm`, then perform an editable Python install. This builds the JS components and installs the `nbinspect-lab` Jupyter extension automatically.

```bash
# 1. Clone the repository
git clone https://github.com/civvic/bridget.git
cd bridget

# 2. Install JavaScript dependencies for the monorepo
pnpm install

# 3. Install Python packages in editable mode
pip install -r requirements-dev.txt
```

> Note: step 2 is only necessary if you are going to use Jupyter Lab/Notebook. For VSCode, simply install the extension. See below.

## VSCode Extension Installation

For VSCode and Cursor, install the nbinspect-vscode extension manually.
The .vsix file is inside packages/nbinspect-vscode.

To install:
	•	Run the command Extensions: Install from VSIX…
	•	Or open the Extensions view, click the “…” menu, and select Install from VSIX….


## Quick Start

A minimal stateful counter component (could also use class instances):

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

For more detailed examples, review the notebooks in the `nbs/` directory, especially `10_bridge_widget.ipynb` `14_bridge.ipynb`, `32_bridget.ipynb`, `50_widget.ipynb`, and the contents of the `nbs/examples/` folder.


## Compatibility and Development

Bridget is developed with [nbdev](https://nbdev.fast.ai/) and requires Python 3.12+. Core dependencies like `fasthtml` and `anywidget` are installed automatically. It is regularly tested on macOS with VSCode, Jupyter Notebook, and Jupyter Lab, and is expected to function in any environment where `anywidget`/`ipywidgets` is supported. Please note that while most features will work in NBClassic, currently is untested, and notebook state introspection is not yet implemented there.

## Main External dependencies

- [xhook](https://github.com/jpillora/xhook): for HTMLX AJAX request interception. It's lightweight and stable; may be internalized later.
- [jupyter-ui-poll](https://github.com/Kirill888/jupyter-ui-poll): for blocking widgets. Lightweight and stable; may be internalized later.
- [tree-sitter](https://github.com/tree-sitter/tree-sitter): for `brdimport` ESM import functionality. Well maintained.
- [AnyWidget](https://github.com/manzt/anywidget): initially used to simplify ipywidget creation. With `brdimport`, Bridget now offers a more flexible alternative, so AnyWidget may eventually be removed.

## Exploring the Codebase
The project is developed entirely in Jupyter Notebooks using `nbdev`. It follows a literate programming approach, the notebooks in `nbs/` are the primary source of truth from which the Python library is generated.

### FastHTML Foundation
Bridget's core depends on adapting FastHTML for a serverless environment. **`03_fasthtml_patching.ipynb`** details the minimal modifications made to enable this, while **`04_route_provider.ipynb`** explains the modified routing system allows Bridget to use methods as route endpoints.

### The Bridge and Bridget Core
The communication layer is central to the project. **`10_bridge_widget.ipynb`** implements the core `BridgeWidget` infrastructure using `anywidget`, including the `BlockingMixin` for synchronous execution and the `brdimport` utility for managing JavaScript modules.  
Building on this, **`14_bridge.ipynb`** defines the primary `Bridge` class that handles low-level messaging.  

Functionality is extended via a plugin system, detailed in **`14_bridge.ipynb`** and **`16_bridge_plugins.ipynb`**.  
Finally, **`32_bridget.ipynb`** provides the main `Bridget` class and the `get_app` entry point, creating the high-level API.

For practical examples, see **`40_details_json.ipynb`** for an advanced, lazy-loading JSON viewer, **`50_widget.ipynb`** for first steps developing widgets, and the notebooks inside the **`nbs/examples/`** directory for simpler HTMX patterns.

### Notebook State Introspection
While optional, Bridget's most powerful features will come from its ability to introspect the notebook's state.  **`15_nb_hooks.ipynb`** and **`21_nb_state.ipynb`** implement the core logic for capturing the live state of the notebook—- its structure, cells, content, and metadata.  
The high-level API for interacting with this state is defined in **`07_nb.ipynb`**. **`21_nb_state.ipynb`** also defines the `Bridge` plugin.

### Companion Extensions
The state introspection functionality is powered by two companion extensions located in the `packages/` directory. `nbinspect-lab` serves JupyterLab and Notebook environments, while `nbinspect-vscode` supports VSCode and derivations. These extensions act as the front-end monitors, capturing notebook events and sending them to the Python kernel for processing.

## Project Status
Bridget is experimental and integrates Jupyter, FastHTML, and HTMX.  

Its primary goal, inspired by Donald Knuth's concept of Literate Programming, is to create truly dynamic documents where any content (including cell outputs) can be directly edited and interacted with in place. The project aims to provide a simple and lightweight editor-like experience within the notebook itself. This enables workflows from nbdev-style literate programming to live context editors for generative models.


Current status:
- ✅ Core architecture for serverless HTMX and notebook introspection is functional.
- ✅ Key HTMX patterns are supported and demonstrated in the `nbs/examples/` notebooks.
- ⚠️ The API is unstable and subject to significant change.
- ⛔ Not recommended for use in production environments.
- 📝 Documentation and more complex examples are in active development.
