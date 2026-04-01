(function () {
  class MenuApiModel {
    constructor(options) {
      this.options = options || {};
    }

    async load(miniAppId) {
      const id = String(miniAppId || "").trim() || "12";

      try {
        const payload = await this._loadPayload(id);
        if (!payload) {
          this.options.onError?.(
            "No menu JSON found. Add minis-web/data/menu-" + id + ".json or pass ?menuUrl=<json-url>."
          );
          this.options.onCustomizationApplied?.();
          this.options.onItemsChanged?.([]);
          return;
        }

        const items = this._extractItems(payload);
        const customization = this._extractCustomization(payload);

        this._persistCustomization(customization);

        this.options.onCustomizationApplied?.();
        this.options.onItemsChanged?.(Array.isArray(items) ? items : []);
      } catch (err) {
        this.options.onError?.(String(err?.message || err));
        this.options.onCustomizationApplied?.();
        this.options.onItemsChanged?.([]);
      }
    }

    async _loadPayload(miniAppId) {
      const params = new URLSearchParams(window.location.search);
      const queryUrl = params.get("menuUrl") || params.get("dataUrl");
      const lsUrl = localStorage.getItem("menuJsonUrl");

      const candidates = [
        queryUrl,
        lsUrl,
        `/api/menu/${miniAppId}`,
        `https://minis.studio/json/${miniAppId}.json`,
        `/data/menu-${miniAppId}.json`,
        `/data/menu.json`,
        `/menu-${miniAppId}.json`,
        `/menu.json`,
      ].filter(Boolean);

      for (const url of candidates) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) continue;
          const json = await res.json();
          if (json && typeof json === "object") return json;
        } catch (_) {
          // try next candidate
        }
      }

      return null;
    }

    _extractItems(payload) {
      if (Array.isArray(payload?.items)) return payload.items;
      if (Array.isArray(payload?.products)) return payload.products;
      if (Array.isArray(payload?.menu?.items)) return payload.menu.items;
      if (Array.isArray(payload?.data?.items)) return payload.data.items;
      if (Array.isArray(payload?.data?.products)) return payload.data.products;
      return [];
    }

    _extractCustomization(payload) {
      return (
        payload?.customization ||
        payload?.miniCustomization ||
        payload?.theme ||
        payload?.data?.customization ||
        payload?.data?.theme ||
        {}
      );
    }

    _persistCustomization(customization) {
      const c = customization || {};
      const direction = String(c.direction || c.dir || "ltr").toLowerCase() === "rtl" ? "rtl" : "ltr";
      const fontName = String(c.fontName || c.font || "");

      const miniService = c.service || c.miniService || null;
      const miniLocations = c.locations || c.miniLocations || null;
      const miniLoyalty = c.loyalty || c.miniLoyalty || null;

      const miniTitle = c.title || c.miniTitle || "";
      const miniSubtitle = c.subtitle || c.miniSubtitle || "";
      const miniImage = c.image || c.miniImage || "";

      try {
        localStorage.setItem("direction", direction);
        if (fontName) localStorage.setItem("fontName", fontName);

        if (miniService) localStorage.setItem("miniService", JSON.stringify(miniService));
        if (miniLocations) localStorage.setItem("miniLocations", JSON.stringify(miniLocations));
        if (miniLoyalty) localStorage.setItem("miniLoyalty", JSON.stringify(miniLoyalty));

        if (miniTitle) localStorage.setItem("miniTitle", String(miniTitle));
        if (miniSubtitle) localStorage.setItem("miniSubtitle", String(miniSubtitle));
        if (miniImage) localStorage.setItem("miniImage", String(miniImage));

        localStorage.setItem("customization", JSON.stringify(c));
      } catch (_) {
        // ignore localStorage failures
      }
    }
  }

  window.MenuApiModel = MenuApiModel;
})();
