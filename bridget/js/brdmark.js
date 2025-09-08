// brdmark.js
// @ts-check

if (!customElements.get('brd-mark')) {
  const logger = globalThis?.bridge?.logger.create({ ns: 'brd-mark', color: 'pink' });
  class BridgetMarker extends HTMLElement {
      connectedCallback() {
          this.style.display = 'none';
          const pel = this.parentElement;
          if (pel) {
              const bridgetId = this.getAttribute('id');
              if (bridgetId) {
                  if (!pel.hasAttribute('data-brt-id')) pel.setAttribute('data-brt-id', bridgetId);
                  logger?.log('set', bridgetId);
                  this.remove();
              }
              globalThis?.htmx?.process(pel);
          }
      }
  }
  customElements.define('brd-mark', BridgetMarker);
  logger?.log('brd-mark defined');
} else {
  globalThis?.bridge?.logger.log('brd-mark is already defined');
}
