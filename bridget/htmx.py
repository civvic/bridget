"""Python wrapper of HTMX API."""

# AUTOGENERATED! DO NOT EDIT! File to edit: ../nbs/21_htmx.ipynb.

# %% ../nbs/21_htmx.ipynb 1
from __future__ import annotations


# %% auto 0
__all__ = ['SwapStyleT', 'swap']

# %% ../nbs/21_htmx.ipynb 4
from typing import Literal
from typing import TypeAlias


# %% ../nbs/21_htmx.ipynb 6
from .helpers import update_


# %% ../nbs/21_htmx.ipynb 20
SwapStyleT: TypeAlias = Literal['innerHTML','outerHTML','testContent','beforebegin','afterbegin',
                        'beforeend','afterend','delete','none']


# %% ../nbs/21_htmx.ipynb 21
def swap(self, 
        target, 
        content, 
        *, 
        # ---- swapSpec:SwapSpec, 
        swapStyle: SwapStyleT='innerHTML',
        swapDelay: int|None=None, settleDelay: int|None=None,
        transition: bool|None=None,
        # ignoreTitle: bool|None=None, head: Literal['merge', 'append']|None=None,
        scroll: str|None=None, scrollTarget: str|None=None,
        show: str|None=None, showTarget: str|None=None, focusScroll: bool|None=None,
        # ---- swapOptions=None,
        select: str|None=None, selectOOB: str|None=None,
        # eventInfo: dict|None=None,
        anchor: str|None=None,        
        # contextElement: str|None=None,
        # afterSwapCallback: Callable|None=None, afterSettleCallback: Callable|None=None,
    ):
    d = {
        'target': target,
        'content': content,
        'swapSpec': update_(**{
            'swapStyle': swapStyle, 'swapDelay': swapDelay, 'settleDelay': settleDelay,
            'transition': transition,
            # 'ignoreTitle': ignoreTitle, 'head': head,
            'scroll': scroll, 'scrollTarget': scrollTarget,
            'show': show, 'showTarget': showTarget, 'focusScroll': focusScroll,
            # 'afterSwapCallback': afterSwapCallback, 'afterSettleCallback': afterSettleCallback,
        }),
        'swapOptions': update_(**{
            'select': select, 'selectOOB': selectOOB,
            # 'eventInfo': eventInfo,
            'anchor': anchor,
            # 'contextElement': contextElement,
            # 'afterSwapCallback': afterSwapCallback, 'afterSettleCallback': afterSettleCallback,
        }),
    }
    self.send({
        'cmd': 'swap',
        'args': [*d.values()]
    })

