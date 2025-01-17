"""..."""

# AUTOGENERATED! DO NOT EDIT! File to edit: ../nbs/01_helpers.ipynb.

# %% ../nbs/01_helpers.ipynb 1
from __future__ import annotations

# %% auto 0
__all__ = ['Singleling', 'update_', 'cleanupwidgets', 'pretty_repr', 'rich_display', 'CLog', 'kounter', 'simple_id', 'id_gen',
           'find', 'read_vfile', 'nb_app']

# %% ../nbs/01_helpers.ipynb 4
import json
import os
import sys
from binascii import hexlify
from functools import reduce
from inspect import Parameter
from typing import Any
from typing import DefaultDict
from typing import Hashable
from typing import Mapping
from typing import overload
from typing import Sequence

import fastcore.all as FC
from fasthtml.core import FastHTML
from IPython.display import display
from IPython.display import DisplayHandle


# %% ../nbs/01_helpers.ipynb 11
class Singleling:
    def __new__(cls, *args, **kwargs):
        if '__instance__' not in cls.__dict__: cls.__instance__ = super().__new__(cls, *args, **kwargs)
        return cls.__instance__
    
    def setup(self, *args, **kwargs):
        "One-time setup"
        setattr(type(self), 'setup', FC.noop)


# %% ../nbs/01_helpers.ipynb 14
def update_(d:dict|None=None, /, empty_value=None, **kwargs):
    "Update `d` in place with `kwargs` whose values aren't `empty_value`"
    d = d if d is not None else {}
    for k, v in kwargs.items():
        if v is not empty_value: d[k] = v
    return d


# %% ../nbs/01_helpers.ipynb 18
def _get_globals(mod: str):
    if hasattr(sys, '_getframe'):
        glb = sys._getframe(2).f_globals
    else:
        glb = sys.modules[mod].__dict__
    return glb


# %% ../nbs/01_helpers.ipynb 21
def cleanupwidgets(*ws, mod: str|None=None, clear=True):
    from IPython.display import clear_output
    glb = _get_globals(mod or __name__)
    if clear: clear_output(wait=True)
    for w in ws:
        _w = glb.get(w) if isinstance(w, str) else w
        if _w:
            try: _w.close()  # type: ignore
            except: pass


# %% ../nbs/01_helpers.ipynb 26
@overload
def pretty_repr(*o, html:bool=True, text:bool=False, **kwargs) -> str: ...
@overload
def pretty_repr(*o, html:bool=False, text:bool=True, **kwargs) -> str: ...
def pretty_repr(*o, html:bool=True, text:bool=True, **kwargs) -> dict[str, str]|str:
    from rich.pretty import Pretty
    d = Pretty(*o, **kwargs)._repr_mimebundle_(
        include=((),('text/plain',))[text] + ((),('text/html',))[html], 
        exclude=((),('text/plain',))[not text] + ((),('text/html',))[not html]
        )
    return d if len(d) > 1 else tuple(d.values())[0]


# %% ../nbs/01_helpers.ipynb 28
def rich_display(*o, dhdl: DisplayHandle|None=None):
    if not o: return
    vv:tuple[str, ...] = tuple(FC.flatten([_.items() for _ in map(pretty_repr, o)]))  # type: ignore
    dd = {'text/plain':'\n'.join(vv[1::4]), 'text/html':'\n'.join(vv[3::4])}
    if dhdl: dhdl.update(dd, raw=True)
    else: display(dd, raw=True)


# %% ../nbs/01_helpers.ipynb 32
def CLog(*o):
    return f"<script>console.log({','.join(map(repr, o))})</script>"


# %% ../nbs/01_helpers.ipynb 35
class kounter:
    def __init__(self): self.d = DefaultDict(int)
    def __call__(self, k): d = self.d; d[k] += 1; return self.d[k]


# %% ../nbs/01_helpers.ipynb 38
def simple_id():
    return 'b'+hexlify(os.urandom(16), '-', 4).decode('ascii')

def id_gen():
    kntr = kounter()
    def _(o:Any=None): 
        if o is None: return simple_id()
        return f"{type(o).__name__}_{id(o) if isinstance(o, Hashable) else kntr(type(o).__name__)}"
    return _

# %% ../nbs/01_helpers.ipynb 48
_II = isinstance
def _at(d: Mapping|Sequence, k: str) -> Any:
    return d[k] if _II(d, Mapping) else d[int(k)] if _II(d, Sequence) and not _II(d, (str, bytes)) else None

def find(key_path: str, j: Mapping|Sequence|str|bytes|bytearray, default:Any=Parameter.empty, sep:str='.') -> Any:
    try: return reduce(_at, key_path.split(sep), json.loads(j) if _II(j, (str, bytes, bytearray)) else j)
    except KeyError as e:
        if default is not Parameter.empty: return default
        raise e


# %% ../nbs/01_helpers.ipynb 52
def read_vfile(cts:str)->str|None:
    import anywidget
    from anywidget._file_contents import _VIRTUAL_FILES
    if cts.startswith('vfile:'):
        if fn := _VIRTUAL_FILES.get(cts, None):
            return fn.contents


# %% ../nbs/01_helpers.ipynb 54
@FC.delegates(FastHTML)  # type: ignore
def nb_app(**kwargs):
    from starlette.middleware.cors import CORSMiddleware
    kwargs.update(default_hdrs=False, sess_cls=None)
    app = FastHTML(**kwargs)
    app.user_middleware = list(filter(lambda x: x.cls is not CORSMiddleware, app.user_middleware))
    return app

