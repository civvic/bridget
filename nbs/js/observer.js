/**
 * @typedef {Object} ObserverConfig
 * @property {Element} target - Element to observe or null
 * @property {MutationObserverInit} options - Observer configuration
 * @property {Set<MutationCallback>} callbacks - Set of callback functions
 */

class ObserverManager {
    constructor() {
        this.observers = new Map();  // name -> {observer, target, options, callbacks}
        this.active = new Set();
    }

    has(name) { return this.observers.has(name); }

    /**
     * Register a new observer or add callbacks to existing one
     * @param {string} name - Observer name
     * @param {ObserverConfig} config - Observer configuration
     * @param {boolean} autostart - Start observing immediately
     * @param {boolean} append - Add callbacks to existing observer
     * @returns {boolean} - True if registered or callbacks added
     */
    register(name, {target, options, callback}, autostart = false, append = false) {
        if (this.has(name)) {
            if (!append) return false;
            this.addCallback(name, callback);
        } else {
            const callbacks = new Set([callback]);
            const observer = new MutationObserver(records => {
                const config = this.observers.get(name);
                config.callbacks.forEach(cb => cb(records));
            });
            this.observers.set(name, {observer, target, options, callbacks});
        }
        if (autostart) this.start(name);
        return true;
    }

    isEmpty(name) { return !this.has(name) || this.observers.get(name).callbacks.size === 0; }
    addCallback(name, callback) {
        if (!this.has(name)) return false;
        const config = this.observers.get(name);
        config.callbacks.add(callback);
        return true;
    }

    removeCallback(name, callback) {
        if (!this.has(name)) return false;
        const config = this.observers.get(name);
        return config.callbacks.delete(callback);
    }

    hasCallback(name, callback) {
        if (!this.has(name)) return false;
        const config = this.observers.get(name);
        return config.callbacks.has(callback);
    }

    unregister(name) {
        if (!this.has(name)) return;
        const config = this.observers.get(name);
        this.stop(name);
        config.callbacks.clear();
        this.observers.delete(name);
    }

    isActive(name) { return this.active.has(name); }

    start(name, {target: _target, options: _options} = {}) {
        if (!this.has(name) || this.isActive(name)) return;
        const config = this.observers.get(name);
        // Must provide new target if previous was removed
        if (!config.target && !_target) return;
        const finalConfig = {
            ...config,
            target: _target ?? config.target,
            options: _options ?? config.options
        };
        this.observers.set(name, finalConfig);
        finalConfig.observer.observe(finalConfig.target, finalConfig.options);
        this.active.add(name);
    }

    stop(name, {removeTarget = false} = {}) {
        if (!this.has(name) || !this.isActive(name)) return;
        const config = this.observers.get(name);
        config.observer.disconnect();
        if (removeTarget) config.target = null;  // Mark target as needing replacement
        this.active.delete(name);
    }

}

/** Get or create the global ObserverManager instance
 * @returns {ObserverManager}
 */
function getObserverManager() {
    window.observerManager ??= new ObserverManager();
    return window.observerManager;
}

if (window.$Brd) window.$Brd.observerManager = getObserverManager();

export default getObserverManager;
