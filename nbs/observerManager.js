/**
 * @typedef {Object} ObserverConfig
 * @property {Element} target - Element to observe or null
 * @property {MutationObserverInit} options - Observer configuration
 * @property {MutationCallback} callback - Callback function
 */

class ObserverManager {
    constructor() {
        this.observers = new Map();
        this.active = new Set();
    }

    has(name) { return this.observers.has(name); }

    /**
     * Register a new observer
     * @param {ObserverConfig} config - Observer configuration
     */
    register(name, {target, options, callback}, autostart = false) {
        if (this.has(name)) return;
        const observer = new MutationObserver(callback);
        this.observers.set(name, {observer, target, options});
        if (autostart) this.start(name);
    }

    unregister(name) {
        if (!this.has(name)) return;
        this.stop(name);
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
        if (!this.isActive(name)) return;
        const config = this.observers.get(name);
        config.observer.disconnect();
        if (removeTarget) {
            config.target = null;  // Mark target as needing replacement
        }
        this.active.delete(name);
    }

}

/**
 * Get or create the global ObserverManager instance
 * @returns {ObserverManager}
 */
function getObserverManager() {
    window.observerManager ??= new ObserverManager();
    return window.observerManager;
}

const observerManager = getObserverManager();

// export default getObserverManager;
