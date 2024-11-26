# Bridget
> Notebook + FastHTML - Server  

Bridget enables rich interactive HTML components in Jupyter notebooks using FastHTML and HTMX, without requiring an HTTP server.

## Key Features

- **No HTTP Server Required**: Works directly in notebook environments
- **HTMX Integration**: Full HTMX capabilities in notebook outputs
- **Extends FastHTML route system**: Use methods as route endpoints
- **Widget System**: Create complex interactive widgets
- **Environment Agnostic**: Will work across VSCode/Cursor, Jupyter nbclassic/Notebook/Lab, Colab, Marimo, and other notebook environments

## Installation

This project is currently in early development and not yet available on PyPI.

```bash
# Clone the repository
git clone https://github.com/civvic/bridget.git

# activate environment and install in dev mode
cd bridget
pip install -e ".[dev]"
```

## Development Setup

Developed with [nbdev](https://nbdev.fast.ai/).

Requirements:
- Python 3.10+
- [fasthtml](https://github.com/fasthtml/fasthtml)
- [anywidget](https://github.com/anywidget/anywidget)

Tested in VSCode/Cursor, Jupyter Notebook/Lab/NbClassic in MacOS. Should work in Windows or Linux.

## Quick Start

```python
from bridget import get_app

app, bridget, rt = get_app()  # Initialize Bridget environment

def counter(n=0):
    @rt('/inc')
    def increment(n:int):
        return Button(f"Count: {n+1}", value=f"{n+1}", name='n', 
            hx_post='/inc', hx_swap='outerHTML', 
            style=f"font-weight: bold")
    return increment(n-1)

counter()
```

The main notebooks to check are:
- `20_route_provider.ipynb` for a possible way to use methods as route endpoints.
- `22_bridget.ipynb` for Bridget itself and some examples.
- `30_details_json.ipynb` for an example of using Bridget to create a lazy-loaded JSON details widget.
- `examples/htmx_examples.ipynb` for some basic examples taken directly from the HTMX documentation.


## Development Status

This is an experimental project exploring the integration of FastHTML/HTMX within notebook environments. Current status:

- ✅ Basic proof of concept working
- ✅ Core HTMX functionality demonstrated
- ⚠️ API may change significantly
- ⚠️ Not recommended for production use
- 📝 Documentation and examples being developed


