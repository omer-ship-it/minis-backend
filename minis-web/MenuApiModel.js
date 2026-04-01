(function () {
  class MenuApiModel {
    constructor(options) {
      this.options = options || {};
    }

    async load(miniAppId) {
      try {
        // Minimal safe fallback so the app can boot without crashing
        // when the real MenuApiModel implementation is unavailable.
        this.options.onCustomizationApplied?.();
        this.options.onItemsChanged?.([]);
      } catch (err) {
        this.options.onError?.(String(err?.message || err));
      }
    }
  }

  window.MenuApiModel = MenuApiModel;
})();
