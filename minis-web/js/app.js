const DEBUG_MODE = false;
        let MINI_SERVICE = { sit: false, ta: false, delivery: false };
        const $ = (id) => document.getElementById(id);

        let __checkoutInFlight = false;
        let __checkoutStartedAt = 0;

        function lockCheckout() {
            const now = Date.now();

            // stale lock protection
            if (__checkoutInFlight && (now - __checkoutStartedAt) > 60000) {
                __checkoutInFlight = false;
                __checkoutStartedAt = 0;
            }

            if (__checkoutInFlight) return false;

            __checkoutInFlight = true;
            __checkoutStartedAt = now;
            return true;
        }

        function unlockCheckout(reason = "") {
            console.warn("🔓 unlockCheckout:", reason);
            __checkoutInFlight = false;
            __checkoutStartedAt = 0;
        }


        let __bootLoadFinished = false;

        function showBootLoader() {
            const el = document.getElementById("bootLoader");
            if (!el) return;
            el.classList.remove("hidden");
            el.setAttribute("aria-hidden", "false");
        }

        function hideBootLoader() {
            if (__bootLoadFinished) return;
            __bootLoadFinished = true;

            const el = document.getElementById("bootLoader");
            if (!el) return;

            el.classList.add("hidden");
            el.setAttribute("aria-hidden", "true");
        }

        showBootLoader();

        (function resetDirOnIdChange() {
            const id = String(new URLSearchParams(location.search).get("id") || "");
            const key = "pwa.lastId.v1";
            const last = String(localStorage.getItem(key) || "");

            if (id && id !== last) {
                // ✅ baseline to LTR immediately (before any render)
                document.documentElement.dir = "ltr";
                try { localStorage.setItem("direction", "ltr"); } catch { }

                try {
                    localStorage.removeItem("miniTitle");
                    localStorage.removeItem("miniSubtitle");
                    localStorage.removeItem("miniImage");
                    localStorage.removeItem("miniService");
                    localStorage.removeItem("checkout.intent");
                } catch { }

                localStorage.setItem(key, id);
            }
        })();

        function getMiniLoyalty() {
            try {
                const raw = localStorage.getItem("miniLoyalty") || "";
                const j = raw ? JSON.parse(raw) : null;
                return (j && typeof j === "object") ? j : null;
            } catch {
                return null;
            }
        }

        function canRedeemFreeCoffee() {
            if (!isMember()) return false;
            return memberStampsNow() >= 10;
        }

        // Find a coffee product to add (uses your existing coffee-name list)
        function findCoffeeProductForReward() {
            // `items` is your global menu items array in the PWA script
            // We look for the first item that qualifies as coffee
            return (items || []).find(p => isCoffeeStampName(p?.name || "")) || null;
        }

      

        function renderLoyaltyBenefitsHTML(loyalty, { rtl = true } = {}) {
            if (!loyalty) return "";

            const rows = [];

            // ✅ stamps (implicit: every 10 -> 11th free)
            if (loyalty.stamps?.label) {
                const label = loyalty.stamps.label;
                rows.push(
                    rtl
                        ? `☕️ כל 10 ${escapeHtml(label)} ה־11 חינם`
                        : `☕️ Every 10 ${escapeHtml(label)} — the 11th is free`
                );
            }

            // ✅ happy hour
            if (loyalty.happyHour?.percent && loyalty.happyHour?.start && loyalty.happyHour?.end) {
                const p = Number(loyalty.happyHour.percent) || 0;
                const start = String(loyalty.happyHour.start);
                const end = String(loyalty.happyHour.end);
                rows.push(
                    rtl
                        ? `🥐 ${p}% הנחה בין ${start}–${end}`
                        : `🥐 ${p}% off between ${start}–${end}`
                );
            }

            // ✅ birthday
            if (loyalty.birthday?.percent && loyalty.birthday?.cap) {
                const p = Number(loyalty.birthday.percent) || 0;
                const cap = Number(loyalty.birthday.cap) || 0;
                rows.push(
                    rtl
                        ? `🎁 ${p}% שובר יום הולדת (עד ${cap})`
                        : `🎁 ${p}% birthday voucher (up to ${cap})`
                );
            }

            if (!rows.length) return "";

            return rows
                .map(t => `<div class="benefit">${t}</div>`)
                .join("");
        }

        // escapeHtml already exists in your code; if not, keep this:
        function escapeHtml(s) {
            return String(s || "")
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#039;");
        }

        function markReturnHandledOnce(key) {
            try {
                const k = `returnHandled:${key}`;
                if (sessionStorage.getItem(k) === "1") return false;
                sessionStorage.setItem(k, "1");
                return true;
            } catch {
                return true;
            }
        }

        function applyLoyaltyUI() {
            const loyalty = getMiniLoyalty();
            const rtl = document.documentElement.dir === "rtl";

            // If no loyalty configured -> optionally hide the entry point (coffee icon)
            const membersBtn = document.querySelector(".headerIcon.left");
            if (!loyalty) {
                // choose behavior:
                // A) hide button entirely
                // membersBtn?.classList.add("hidden");

                // B) keep it visible but show a message on tap
                // (do nothing here)
                return;
            }

            // If you chose to hide it above, unhide:
            membersBtn?.classList.remove("hidden");

            // ✅ Update title inside members modal
            const titleEl = document.querySelector("#membersModal .studentTitle");
            if (titleEl) titleEl.textContent = loyalty.title || (rtl ? "מועדון חברים" : "Members club");

            // ✅ Replace benefits list dynamically
            const benefitsHost = document.querySelector("#membersModal .membersBenefits");
            if (benefitsHost) {
                const html = renderLoyaltyBenefitsHTML(loyalty, { rtl });
                benefitsHost.innerHTML = html || "";
                benefitsHost.style.display = html ? "" : "none";
            }
        }
        function getMiniAppId() {
            // 1️⃣ try URL param (and persist it!)
            const params = new URLSearchParams(window.location.search);
            const urlId = Number(params.get("id"));

            if (!Number.isNaN(urlId) && urlId > 0) {
                try { localStorage.setItem("miniAppId", String(urlId)); } catch { }
                console.log("✅ miniAppId from URL:", urlId, "(saved to localStorage)");
                return urlId;
            }

            // 2️⃣ try localStorage (this is what standalone will use)
            const storedRaw = (localStorage.getItem("miniAppId") || "").trim();
            const storedId = Number(storedRaw);

            if (!Number.isNaN(storedId) && storedId > 0) {
                console.log("✅ miniAppId from localStorage:", storedId);
                return storedId;
            }

            // 3️⃣ fallback
            console.warn("⚠️ miniAppId fallback to 12 (no URL id, no stored id)");
            return 12;
        }

        function applyUIFontFromValue(fontRaw) {
            const f = String(fontRaw || "").trim().toLowerCase();
            const cssFont = f.includes("heebo")
                ? `"Heebo", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
                : `"Primaries", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

            document.documentElement.style.setProperty("--uiFont", cssFont);
        }



        function normalizeFontName(v) {
            return String(v || "")
                .trim()
                .toLowerCase()
                .replace(/[_\-]+/g, " ");
        }

        function hasRTLChars(s) {
            // Hebrew + Arabic ranges
            return /[\u0590-\u05FF\u0600-\u06FF]/.test(String(s || ""));
        }



        function getMiniServiceConfig() {
            // 1) Try full customization JSON first
            try {
                const raw =
                    localStorage.getItem("customization") ||
                    localStorage.getItem("miniCustomization") ||
                    "";
                const j = raw ? JSON.parse(raw) : null;

                const svc = j?.mini?.service;
                if (svc && typeof svc === "object") {
                    return {
                        sit: svc.sit === true,
                        ta: svc.ta === true,
                        delivery: svc.delivery === true
                    };
                }
            } catch { }

            // 2) Fallback: a dedicated localStorage key (miniService)
            try {
                const rawSvc = localStorage.getItem("miniService") || "";
                if (rawSvc) {
                    const svc = JSON.parse(rawSvc);
                    return {
                        sit: svc?.sit === true,
                        ta: svc?.ta === true,
                        delivery: svc?.delivery === true
                    };
                }
            } catch { }

            // 3) Missing -> default OFF (prevents false showing)
            return { sit: false, ta: false, delivery: false };
        }

        function applyServiceSegmentVisibility() {
            const svc = getMiniServiceConfig();
            const show = (svc.sit && svc.ta);

            const wrap = document.getElementById("serviceWrap"); // ✅ only service
            if (wrap) wrap.style.display = show ? "" : "none";
        }

        function applyDirection() {
            // ✅ direction is owned by MenuApiModel (theme.direction or default ltr)
            const dir = String(localStorage.getItem("direction") || "ltr").toLowerCase();
            document.documentElement.dir = (dir === "rtl") ? "rtl" : "ltr";
        }

        function readFontFromJSON() {
            // common places MenuApiModel / customization might store it
            return (
                localStorage.getItem("font") ||
                localStorage.getItem("fontName") ||
                localStorage.getItem("uiFont") ||
                localStorage.getItem("appFont") ||
                (() => {
                    try {
                        const raw =
                            localStorage.getItem("customization") ||
                            localStorage.getItem("miniCustomization");
                        if (!raw) return "";
                        const j = JSON.parse(raw);
                        return j?.font || j?.uiFont || j?.theme?.font || "";
                    } catch {
                        return "";
                    }
                })()
            );
        }

        function applyUIFontFromJSON() {
            const raw = (localStorage.getItem("fontName") || "").trim();
            const f = raw.toLowerCase();

            let cssFont =
                `"Primaries", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

            // defaults (Primaries)
            let catSize = "14px";
            let cardNameSize = "15px";
            let cardPriceSize = "14px";

            if (f.includes("heebo")) {
                cssFont =
                    `"Heebo", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

                // 👌 tuned for Heebo optical size
                catSize = "15.5px";
                cardNameSize = "16.5px";
                cardPriceSize = "14px";
            }

            document.documentElement.style.setProperty("--uiFont", cssFont);
            document.documentElement.style.setProperty("--catFontSize", catSize);
            document.documentElement.style.setProperty("--cardNameFontSize", cardNameSize);
            document.documentElement.style.setProperty("--cardPriceFontSize", cardPriceSize);
        }
        const MINI_APP_ID = getMiniAppId();

        try { sessionStorage.setItem("miniAppId.session", String(MINI_APP_ID)); } catch { }

        function setThemeForMini(id) {
            const root = document.documentElement;
            if (id === 3) {
                root.style.setProperty("--accent", "#d71201");
                root.style.setProperty("--btn", "#d71201");
            }
        }
        setThemeForMini(MINI_APP_ID);

        const shop = { title: "Beigel Bake · Brick Ln", subtitle: "Delivered in around 20 minutes" };

        let items = [];
        let categories = [];

        // ✅ IMPORTANT: guard
        if (!window.MenuApiModel) {
            alert("MenuApiModel missing (JS not loaded). Check path/case/cache.");
        } else {
            const api = new window.MenuApiModel({
                onItemsChanged: (newItems) => {
                    items = newItems
                        .filter(x => {
                            const status = Number(x.status ?? x.Status ?? 1);
                            const stock = x.stockQuantity ?? x.StockQuantity ?? x.stock ?? x.Stock ?? x.qty ?? x.Qty;
                            const isArchived = (x.isArchived ?? x.IsArchived) === true;
                            const soldOut = (x.soldOut ?? x.SoldOut ?? x.isSoldOut ?? x.IsSoldOut) === true;
                            const inStock = x.inStock ?? x.InStock;
                            const available = x.available ?? x.Available;

                            if (isArchived) return false;
                            if (status === 0) return false;
                            if (soldOut) return false;
                            if (inStock === false) return false;
                            if (available === false) return false;

                            if (stock != null && String(stock).trim() !== "" && Number(stock) <= 0) return false;

                            return true;
                        })
                        .map(x => ({
                            id: x.id ?? x.Id ?? x.ProductId,
                            name: x.name ?? x.Name,
                            price: Number(x.price ?? x.Price ?? 0),
                            category: x.category ?? x.Category ?? "",
                            image: x.imageURL || x.image || x.Image || "",
                            modifiers: x.modifiers || x.Modifiers || null,
                            tags: Array.isArray(x.tags) ? x.tags : (Array.isArray(x.Tags) ? x.Tags : [])
                        }));

                    categories = [...new Set(items.map(i => i.category))];
                   
                    renderCategoryBar();
                    renderMenu();
                    rebuildSectionCache();
                    syncPinnedBar();
                    requestAnimationFrame(() => {
                        hideBootLoader();
                    });
                    //onScrollSelectCategory();
                },
                onCustomizationApplied: () => {
                    applyDirection();       // ✅ just sets html dir from latest stored value
                    applyUIFontFromJSON();
                    applyThemeColorsFromJSON();
                    applyHebrewUI();
                    applyServiceSegmentVisibility();
                    console.log("✅ miniLocations now:", localStorage.getItem("miniLocations"));

                    renderLocationSegment();
                    applyLoyaltyUI();
                    applyStampHeaderIconFromLoyalty();

                },
                onError: (msg) => {
                    console.log("MenuApiModel:", msg);
                    hideBootLoader();
                }
            });

            api.load(String(MINI_APP_ID));
        }
        function applyThemeColorsFromJSON() {
            // Try multiple storage keys you already use elsewhere
            let j = null;
            try {
                const raw =
                    localStorage.getItem("customization") ||
                    localStorage.getItem("miniCustomization") ||
                    localStorage.getItem("theme") ||
                    "";
                j = raw ? JSON.parse(raw) : null;
            } catch { j = null; }

            // Accept a few possible shapes (theme, mini.theme, flat fields)
            const theme =
                j?.theme ||
                j?.mini?.theme ||
                j?.mini ||
                j ||
                {};

            // Try common names
            const brand =
                theme.brandColor || theme.brand || theme.primaryColor || theme.primary || "";

            const btn =
                theme.buttonColor || theme.btnColor || theme.button || "";

            const btnText =
                theme.buttonTextColor || theme.btnTextColor || theme.buttonText || "";

            const accent =
                theme.highlightColor || theme.accentColor || theme.accent || "";

            // Helper
            const setIfHex = (varName, val) => {
                const v = String(val || "").trim();
                if (!v) return;
                // allow "#RRGGBB" / "#RGB"
                if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return;
                document.documentElement.style.setProperty(varName, v);
            };

            // Apply (btn falls back to brand if missing)
            setIfHex("--brand", brand);
            setIfHex("--accent", accent || brand);
            setIfHex("--btn", btn || brand);
            setIfHex("--btnText", btnText);
        }

        const catIdMap = new Map();
        function catId(cat) {
            if (catIdMap.has(cat)) return catIdMap.get(cat);
            let base = String(cat || "")
                .toLowerCase()
                .normalize("NFKD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/(^-|-$)/g, "");

            if (!base) {
                const s = String(cat || "");
                let h = 0;
                for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
                base = "c-" + Math.abs(h).toString(36);
            }
            const id = "cat-" + base;
            catIdMap.set(cat, id);
            return id;
        }

        const COFFEE_STAMP_NAMES_RAW = [
            "אספרסו", "הפוך", "אמריקנו", "מקיאטו", "קורטדו", "קפה שחור",
            "espresso", "americano", "macchiato", "cortado", "black coffee"
        ];

        function isCashpointMode() {
            const p = new URLSearchParams(location.search);

            // URL wins
            const url = (p.get("cashpoint") || "").trim();
            if (url === "1" || url.toLowerCase() === "true") return true;

            // fallback: localStorage (if you used that before)
            const ls = String(localStorage.getItem("cashpoint") || localStorage.getItem("cashPointMode") || "").trim().toLowerCase();
            if (ls === "1" || ls === "true") return true;

            return false;
        }

        const basketTitle = document.getElementById("basketSheetTitle");
        if (basketTitle) {
            basketTitle.textContent = isRTL() ? "ההזמנה שלך" : "Your order";
        }

        const CASHPOINT = isCashpointMode();
        document.body.classList.toggle("cashpoint", CASHPOINT);

        function normStampName(s) {
            return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
        }
        const COFFEE_STAMP_KEYS = new Set(COFFEE_STAMP_NAMES_RAW.map(normStampName));

        function isCoffeeStampName(name) {
            const n = normStampName(name);
            if (COFFEE_STAMP_KEYS.has(n)) return true;
            if (n.includes("espresso")) return true;
            if (n.includes("אמריקנו")) return true;
            if (n.includes("קפה שחור")) return true;
            return false;
        }

        let basket = new Map();
        let nextLineId = 1;
        let currentItem = null;
        let currentSelection = null;

        let sectionCache = [];
        let scrollTicking = false;
        let freezeAutoSelectUntil = 0;

        let marketingOptIn = false;
        let birthdayVoucherApplied = false;

        let freeCoffee = { lineId: 0, units: 0 };

        function loadMemberProfile() {
            try {
                const raw = localStorage.getItem("memberProfileLocal");
                return raw ? JSON.parse(raw) : null;
            } catch {
                return null;
            }
        }

        function saveMemberProfile(profile) {
            try { localStorage.setItem("memberProfileLocal", JSON.stringify(profile)); } catch { }
        }

        function getStamps(profile) { return Number(profile?.wallet?.stamps ?? profile?.stamps ?? 0) || 0; }

        function setStamps(profile, stamps) {
            profile.wallet = profile.wallet || {};
            profile.wallet.stamps = stamps;
            profile.stamps = stamps;
        }

        function countCoffeeInBasket() {
            let count = 0;
            for (const line of basket.values()) {
                const name = line?.item?.name || "";
                if (isCoffeeStampName(name)) count += Number(line?.qty || 0);
            }
            return count;
        }

        function addCoffeeStampsFromBasket() {
            if (!isMember()) return;
            const add = countCoffeeInBasket();
            if (add <= 0) return;

            const profile = loadMemberProfile();
            if (!profile) return;

            const current = getStamps(profile);
            const next = Math.min(10, current + add);

            setStamps(profile, next);
            saveMemberProfile(profile);
            updateCoffeeHeaderIcon();

            if (!document.getElementById("memberModal")?.classList.contains("hidden")) renderMemberCard();
        }

        function updateCoffeeHeaderIcon() {
            const btn = document.querySelector(".headerIcon.left");
            const icon = btn?.querySelector("i");
            const profile = loadMemberProfile();
            const stamps = getStamps(profile);
            const isGold = stamps >= 10;

            btn?.classList.toggle("gold", isGold);
            icon?.classList.toggle("gold", isGold);
        }

        function showSheet(el) {
            if (!el) return;
            el.classList.add("open");
        }

        function hideSheet(el) {
            if (!el) return;
            el.classList.remove("open");
        }

        function centerCategoryPill(btn) {
            const bar = $("cats");
            if (!bar || !btn) return;
            requestAnimationFrame(() => {
                const barRect = bar.getBoundingClientRect();
                const pillRect = btn.getBoundingClientRect();
                const offset = (pillRect.left - barRect.left) - (barRect.width / 2) + (pillRect.width / 2);
                bar.scrollTo({ left: bar.scrollLeft + offset, behavior: "smooth" });
            });
        }

        function syncPinnedBar() {
            const sent = $("stickySentinel");
            const bar = $("stickyWrap");
            const spacer = $("catsSpacer");
            if (!sent || !bar || !spacer) return;

            const shouldPin = sent.getBoundingClientRect().top <= 0;
            if (shouldPin) {
                if (!bar.classList.contains("pinned")) {
                    spacer.style.height = bar.getBoundingClientRect().height + "px";
                    bar.classList.add("pinned");
                }
            } else if (bar.classList.contains("pinned")) {
                bar.classList.remove("pinned");
                requestAnimationFrame(() => { spacer.style.height = "0px"; });
            }
        }

        function setActiveCategory(cat, { center = true } = {}) {
            const buttons = document.querySelectorAll(".cat");
            let activeBtn = null;
            buttons.forEach((btn) => {
                const isActive = btn.dataset.cat === cat;
                btn.classList.toggle("active", isActive);
                if (isActive) activeBtn = btn;
            });
            if (center && activeBtn) centerCategoryPill(activeBtn);
        }

        function rebuildSectionCache() {
            sectionCache = categories
                .map((cat) => ({ cat, el: document.getElementById(catId(cat)) }))
                .filter((x) => x.el);
        }

        function isRTL() {
            return document.documentElement.dir === "rtl";
        }

        function formatMoney(value) {
            const n = Number(value || 0).toFixed(2);

            // RTL → no currency sign at all
            if (isRTL()) return n;

            // LTR → keep £
            return `£${n}`;
        }

        function onScrollSelectCategory() {
            if (Date.now() < freezeAutoSelectUntil) return;
            if (scrollTicking) return;

            scrollTicking = true;
            requestAnimationFrame(() => {
                scrollTicking = false;
                if (!sectionCache.length) return;

                const bar = $("stickyWrap");
                const barH = bar ? bar.getBoundingClientRect().height : 0;
                const threshold = barH + 8;

                let bestCat = null;
                let bestTop = -Infinity;

                for (const s of sectionCache) {
                    const r = s.el.getBoundingClientRect();
                    if (r.top <= threshold && r.top > bestTop) {
                        bestTop = r.top;
                        bestCat = s.cat;
                    }
                }

                if (!bestCat) {
                    if (window.scrollY < 40 && sectionCache.length) bestCat = sectionCache[0].cat;
                    else return;
                }

                const current = document.querySelector(".cat.active")?.dataset.cat || "";
                if (bestCat !== current) setActiveCategory(bestCat, { center: true });
            });
        }

        function scrollToCategory(cat) {
            freezeAutoSelectUntil = Date.now() + 1000;
            setActiveCategory(cat, { center: true });
            const el = document.getElementById(catId(cat));
            if (!el) return;

            const bar = $("stickyWrap");
            const barH = bar ? bar.getBoundingClientRect().height : 0;
            const y = el.getBoundingClientRect().top + window.scrollY - barH - 10;
            window.scrollTo({ top: y, behavior: "smooth" });
        }

        function renderCategoryBar() {
            const host = $("cats");
            if (!host) return;
            host.innerHTML = "";
            categories.forEach((cat, idx) => {
                const b = document.createElement("button");
                b.className = "cat" + (idx === 0 ? " active" : "");
                b.textContent = cat;
                b.dataset.cat = cat;
                b.onclick = () => scrollToCategory(cat);
                host.appendChild(b);
            });
        }

        function renderMenu() {
            const menu = $("menu");
            if (!menu) return;

            menu.innerHTML = "";
            categories.forEach((cat) => {
                const sec = document.createElement("section");
                sec.className = "section";
                sec.id = catId(cat);
                sec.dataset.cat = cat;
                sec.innerHTML = `<div class="sectionTitle">${cat}</div>`;

                const grid = document.createElement("div");
                grid.className = "grid";

                items.filter((i) => i.category === cat).forEach((item) => {
                    const qtyInBasket = [...basket.values()]
                        .filter((l) => l.item.id === item.id)
                        .reduce((s, l) => s + Number(l.qty || 0), 0);

                    const btn = document.createElement("button");
                    btn.className = "card";
                    btn.innerHTML = `
                                        <div class="cardImg">
                                          <img src="${item.image}">
                                          ${qtyInBasket ? `<div class="badge">${qtyInBasket}</div>` : ""}
                                        </div>
                                        <div class="cardName">${item.name}</div>
                                       <div class="cardPrice">${formatMoney(item.price)}</div>
                                      `;
                    btn.onclick = () => openProduct(item);
                    grid.appendChild(btn);
                });

                sec.appendChild(grid);
                menu.appendChild(sec);
            });

            rebuildSectionCache();
            onScrollSelectCategory();
        }

        function norm(s) {
            return String(s || "")
                .trim()
                .replace(/\u200F/g, "")
                .replace(/\u200E/g, "")
                .replace(/\u00A0/g, " ");
        }
        function DBG(...args) { try { console.log("🧪", ...args); } catch { } }
        function openProduct(item) {
            DBG("openProduct()", { CASHPOINT, id: item?.id, name: item?.name, modifiersLen: item?.modifiers?.length, modifiers: item?.modifiers });

            currentItem = item;

            // selection stores NAMES, keyed by normalized group TITLE
            currentSelection = {
                qty: 1,
                opts: {},                // { norm(group.title): norm(selectedItem.name) }
                adds: new Set(),         // Set<norm(item.name)>
            };

            const groups = item.modifiers || [];

            // ✅ OPTIONS: if missing -> pick first item
            for (const g of groups) {
                if (g.type !== "options") continue;
                const k = norm(g.title);
                const first = g.items?.[0]?.name;
                if (first) currentSelection.opts[k] = norm(first);
            }

            // ✅ ADDITIONS: default-first behavior (like SwiftUI)
            for (const g of groups) {
                if (g.type !== "additions") continue;
                const first = g.items?.[0]?.name;
                if (!first) continue;

                const groupNames = new Set((g.items || []).map(x => norm(x.name)));
                const defaultName = norm(first);

                const hasAnyInGroup = Array.from(currentSelection.adds).some(x => groupNames.has(x));
                if (!hasAnyInGroup) {
                    currentSelection.adds.add(defaultName);
                } else {
                    const hasNonDefault = Array.from(currentSelection.adds).some(x => groupNames.has(x) && x !== defaultName);
                    if (hasNonDefault) currentSelection.adds.delete(defaultName);
                }
            }

            renderProduct();
            showSheet($("productModal"));
        }

        function closeProduct() { hideSheet($("productModal")); }

        function changeQty(d) {
            if (!currentSelection) return;
            currentSelection.qty = Math.max(1, Number(currentSelection.qty || 1) + d);
            renderProduct();
        }

        function calcExtras(item, selection) {
            const groups = item?.modifiers || [];
            let total = 0;

            for (const g of groups) {
                if (g.type === "options") {
                    const k = norm(g.title);
                    const selName = norm(selection.opts?.[k]);
                    if (!selName) continue;

                    const opt = (g.items || []).find(x => norm(x.name) === selName);
                    total += Number(opt?.extraPrice || 0);
                }

                if (g.type === "additions") {
                    const selectedSet = new Set(Array.from(selection.adds || []).map(norm));
                    for (const it of (g.items || [])) {
                        if (selectedSet.has(norm(it.name))) {
                            total += Number(it.extraPrice || 0);
                        }
                    }
                }
            }

            return total;
        }

        const MY_ITEMS_KEY = "myItems.v2";

        function stableStringify(obj) {
            const keys = Object.keys(obj || {}).sort();
            const out = {};
            for (const k of keys) out[k] = obj[k];
            return JSON.stringify(out);
        }

        function selectionKey(productId, opts, adds) {
            const addsSorted = Array.from(adds || []).slice().sort();
            return `${productId}|${stableStringify(opts || {})}|${addsSorted.join(",")}`;
        }

        function loadMyItems() {
            try {
                const raw = localStorage.getItem(MY_ITEMS_KEY);
                const arr = raw ? JSON.parse(raw) : [];
                return Array.isArray(arr) ? arr : [];
            } catch {
                return [];
            }
        }

        function saveMyItems(arr) { try { localStorage.setItem(MY_ITEMS_KEY, JSON.stringify(arr)); } catch { } }

        function touchMyItem(entry) {
            const arr = loadMyItems();
            const key = selectionKey(entry.productId, entry.opts, entry.adds);
            const idx = arr.findIndex((x) => x.key === key);
            const payload = { ...entry, key, touchedAt: Date.now() };
            if (idx >= 0) arr[idx] = payload;
            else arr.unshift(payload);
            arr.sort((a, b) => (b.touchedAt || 0) - (a.touchedAt || 0));
            saveMyItems(arr.slice(0, 40));
        }

        function escapeHtml(s) {
            return String(s || "")
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#039;");
        }

        function renderMyItemsStrip() {
            const host = $("myItemsHost");
            if (!host) return;

            const all = loadMyItems();
            const seen = new Set();
            const arr = [];

            for (const it of all) {
                const pid = Number(it.productId);
                if (seen.has(pid)) continue;
                seen.add(pid);
                arr.push(it);
                if (arr.length >= 5) break;
            }

            if (!arr.length) {
                host.classList.add("hidden");
                host.innerHTML = "";
                return;
            }

            host.classList.remove("hidden");

            const chips = arr.map((it, idx) => `
                                    <button class="myChip" type="button" onclick="openMyItemIndex(${idx})">
                                      <img class="myChipImg" src="${it.image || ""}" alt="">
                                      <div class="myChipMeta">
                                        <div class="myChipName">${escapeHtml(it.name)}</div>
                                        <div class="myChipPrice">${formatMoney(it.lastPrice)}</div>
                                      </div>
                                    </button>
                                  `).join("");

            const rtl = document.documentElement.dir === "rtl";

            host.innerHTML = `
              <div class="myItemsTitle">
                ${rtl ? "הפריטים שלי" : "My items"}
              </div>
              <div class="myItemsRow">
                ${chips}
              </div>
`;
        }

        function openMyItemIndex(idx) {
            const arr = loadMyItems();
            const it = arr[idx];
            if (!it) return;

            const p = items.find((x) => Number(x.id) === Number(it.productId));
            if (!p) return;

            openProduct(p);

            if (p.modifiers && currentSelection) {
                currentSelection.qty = 1;
                currentSelection.opts = { ...(it.opts || {}) };
                currentSelection.adds = new Set(it.adds || []);
                renderProduct();
            }
        }

        function removeFromMyItems(productId) {
            const arr = loadMyItems();
            saveMyItems(arr.filter((it) => Number(it.productId) !== Number(productId)));
            renderMyItemsStrip();
            if (currentItem && Number(currentItem.id) === Number(productId)) renderProduct();
        }

        function renderProduct() {
            const i = currentItem;
            const s = currentSelection;
            if (!i || !s) return;

            const isInMyItems = (() => {
                try {
                    const arr = loadMyItems();
                    return Array.isArray(arr) && arr.some((x) => Number(x.productId) === Number(i.id));
                } catch {
                    return false;
                }
            })();

            $("productBody").innerHTML = `
                    <div class="hero"><img src="${i.image}"></div>
                    <div class="productContent">
                      <h2 style="margin:0;font-weight:900;font-size:20px;line-height:1.15;">${i.name}</h2>
                      <div class="productPrice" style="margin-top:15px;margin-bottom:${isInMyItems ? "6px" : "10px"};font-weight:500;font-size:16px;color:var(--brand);">
                        ${formatMoney(i.price)}
                      </div>
                     ${isInMyItems ? `
                  <button class="removeMyItemBtn" type="button"
                          onclick="removeFromMyItems(${Number(i.id)})">
                    ${isRTL() ? "הסר מהפריטים שלי" : "Remove from my items"}
                  </button>
` : ``}
                    </div>
                  `;

            const content = $("productBody")?.querySelector(".productContent");
            if (!content) return;

            // ✅ render modifiers using TITLE + NAME (NO ids)
            if (Array.isArray(i.modifiers) && i.modifiers.length) {
                const modsWrap = document.createElement("div");
                modsWrap.className = "productModifiers";

                i.modifiers.forEach((g) => {
                    const title = g.title ?? "בחירה";
                    const type = (g.type || "").toLowerCase(); // "options" | "additions"
                    const items = Array.isArray(g.items) ? g.items : [];

                    const h = document.createElement("h3");
                    h.textContent = title;
                    h.style.margin = "0 0 6px";
                    h.style.fontWeight = "900";

                    const pills = document.createElement("div");
                    pills.className = "pills";

                    const gKey = norm(title);

                    items.forEach((it) => {
                        const rawName = it?.name ?? it?.optionName ?? "";
                        const itName = norm(rawName);

                        const p = document.createElement("button");
                        p.className = "pill";

                        const active = (type === "options")
                            ? norm(s.opts?.[gKey]) === itName
                            : (s.adds instanceof Set ? s.adds.has(itName) : false);

                        if (active) p.classList.add("active");

                        const ex = Number(it?.extraPrice ?? it?.extra ?? 0);
                        p.textContent = ex > 0 ? `${rawName} +${formatMoney(ex)}` : rawName;

                        p.onclick = () => {
                            if (type === "options") {
                                // select by NAME keyed by group TITLE
                                s.opts[gKey] = itName;
                            } else {
                                // additions: default-first behavior using NAMES
                                const firstRaw = items[0]?.name ?? items[0]?.optionName ?? "";
                                const firstName = norm(firstRaw);

                                if (itName === firstName) {
                                    s.adds = new Set([itName]);
                                } else {
                                    if (firstName) s.adds.delete(firstName);
                                    s.adds.has(itName) ? s.adds.delete(itName) : s.adds.add(itName);
                                }
                            }

                            renderProduct(); // re-render to update active pills + total
                        };

                        pills.appendChild(p);
                    });

                    modsWrap.appendChild(h);
                    modsWrap.appendChild(pills);
                });

                content.appendChild(modsWrap);
            }

            const extra = calcExtras(i, s);
            const unit = Number(i.price) + Number(extra);
            const total = unit * Number(s.qty || 1);

            $("productBottom").innerHTML = `
                    <div class="qtyRow">
                      <button class="qtyBtn" onclick="changeQty(-1)">−</button>
                      <div style="min-width:22px;text-align:center;font-weight:900;font-size:18px;">${s.qty}</div>
                      <button class="qtyBtn" onclick="changeQty(1)">+</button>
                      <button class="btn full addBtnRow" onclick="addToBasket()">
                        <span class="addBtnLabel">${isRTL() ? "הוסף" : "Add"}</span>
                        <span class="addBtnTotal">${formatMoney(total)}</span>
                      </button>
                    </div>
                  `;
        }

        function addToBasket() {
            if (!currentItem || !currentSelection) return;

            const lineId = nextLineId++;

            // ✅ selection uses:
            // - opts keyed by norm(group.title) -> norm(selectedItem.name)
            // - adds is Set<norm(item.name)>
            let modsText = "";

            const groups = Array.isArray(currentItem.modifiers) ? currentItem.modifiers : [];
            if (groups.length) {
                const parts = [];

                groups.forEach((g) => {
                    const type = String(g?.type || "").toLowerCase();
                    const items = Array.isArray(g?.items) ? g.items : [];
                    if (!items.length) return;

                    const firstRaw = items[0]?.name ?? items[0]?.optionName ?? "";
                    const firstName = norm(firstRaw);

                    if (type === "options") {
                        const gKey = norm(g?.title || "");
                        const selName = norm(currentSelection?.opts?.[gKey] || "");

                        // selected item by NAME (fallback to first)
                        const selected =
                            items.find((x) => norm(x?.name ?? x?.optionName ?? "") === selName) || items[0];

                        const selectedName = norm(selected?.name ?? selected?.optionName ?? "");

                        // only show if not default (first)
                        if (selectedName && selectedName !== firstName) {
                            parts.push(String(selected?.name ?? selected?.optionName ?? "").trim());
                        }
                    }

                    if (type === "additions") {
                        const addsSet = currentSelection?.adds instanceof Set ? currentSelection.adds : new Set();
                        // add all selected additions, but skip "default first" if it's selected
                        for (const addName of addsSet) {
                            const addNorm = norm(addName);
                            if (!addNorm) continue;
                            if (addNorm === firstName) continue;

                            const it = items.find((x) => norm(x?.name ?? x?.optionName ?? "") === addNorm);
                            if (it) parts.push(String(it?.name ?? it?.optionName ?? "").trim());
                        }
                    }
                });

                modsText = [...new Set(parts.filter(Boolean))].join(" · ");
            }

            const extra = calcExtras(currentItem, currentSelection);
            const unitPrice = Number(currentItem.price || 0) + Number(extra);

            basket.set(lineId, {
                lineId,
                item: currentItem,
                qty: Number(currentSelection.qty || 1),
                price: unitPrice, // ✅ includes modifiers
                image: currentItem.image,
                modsText
            });

            // ✅ persist for "My items" using the new selection format (title->name, adds names)
            touchMyItem({
                productId: currentItem.id,
                name: currentItem.name,
                image: currentItem.image,
                lastPrice: unitPrice,
                modsText: modsText || "",
                opts: { ...(currentSelection.opts || {}) },
                adds: Array.from(currentSelection.adds || [])
            });

            updateBasket();
            renderMyItemsStrip();
            closeProduct();
        }

        const ACTIVE_DISCOUNT_KEY = "activeDiscount.v1";

        function getActiveDiscount() {
            try {
                const raw = localStorage.getItem(ACTIVE_DISCOUNT_KEY);
                if (!raw) return null;
                const d = JSON.parse(raw);
                if (!d || !Number(d.percent)) return null;
                if (d.expiresAt && Date.now() > Number(d.expiresAt)) return null;
                return d;
            } catch {
                return null;
            }
        }

        function discountPercentNow() {
            const d = getActiveDiscount();
            return d ? Math.max(0, Math.min(100, Number(d.percent))) : 0;
        }

        function money(n) { return `£${Number(n || 0).toFixed(2)}`; }

        function calcBasketSubtotal() {
            let subtotal = 0;
            for (const [id, line] of basket.entries()) {
                const qty = Number(line?.qty || 0);
                const price = Number(line?.price || 0);

                let chargeQty = qty;
                if (Number(id) === Number(freeCoffee.lineId)) {
                    chargeQty = Math.max(0, qty - Number(freeCoffee.units || 0));
                }
                subtotal += chargeQty * price;
            }
            return subtotal;
        }

        function calcDiscountAmount(subtotal) {
            const p = discountPercentNow();
            return p > 0 ? (subtotal * p / 100) : 0;
        }

        function calcTotalWithDiscounts() {
            const subtotal = calcBasketSubtotal();
            const studentDisc = calcDiscountAmount(subtotal);
            const happyHourDisc = (typeof calcHappyHourDiscount === "function") ? calcHappyHourDiscount() : 0;
            const birthdayDisc = birthdayVoucherApplied ? calcBirthdayDiscount(subtotal) : 0;

            const totalDiscount = studentDisc + happyHourDisc + birthdayDisc;
            const total = Math.max(0, subtotal - totalDiscount);

            return { subtotal, studentDisc, happyHourDisc, birthdayDisc, total };
        }
        function updateBasket() {
            clearFreeCoffeeIfNeeded();

            const qty = [...basket.values()].reduce((s, l) => s + Number(l.qty || 0), 0);
            const { total } = calcTotalWithDiscounts();

            $("basketQty").textContent = String(qty);

            const labelEl = $("basketLabel");
            if (labelEl) labelEl.textContent = isRTL() ? "צפה בהזמנה" : "View order";

            $("basketTotal").textContent = formatMoney(total);
            $("basketBar").classList.toggle("hidden", qty === 0);

            if (CASHPOINT) {
                cashRenderMenu();
                cashRenderBasketPanel();
            } else {
                renderMenu();
            }
        }

        function openBasket() {
            clearFreeCoffeeIfNeeded();

            const body = $("basketBody");
            body.innerHTML = "";

            for (const [key, line] of basket.entries()) {
                const lineId = Number(line.lineId ?? key);
                const qty = Number(line.qty || 0);
                const price = Number(line.price || 0);
                const mods = (line.modsText || "").trim();
                const subtitleHtml = mods ? `<div class="bSub">${mods}</div>` : "";

                let chargeQty = qty;
                if (lineId === Number(freeCoffee.lineId)) {
                    chargeQty = Math.max(0, qty - Number(freeCoffee.units || 0));
                }

                const lineTotal = chargeQty * price;
                const priceText = (lineTotal <= 0 && qty > 0) ? "Free" : `£${lineTotal.toFixed(2)}`;

                const row = document.createElement("div");
                row.className = "bRow";
                row.innerHTML = `
                                      <img class="bThumb" src="${line.image || line.item?.image || ""}" alt="">
                                      <div class="bMeta">
                                        <div class="bName">${qty}× ${line.item.name}</div>
                                        ${subtitleHtml}
                                        <div class="bPrice">${priceText}</div>
                                      </div>
                                      <div class="bStepper">
                                        <button class="bStepBtn" data-act="minus" data-line="${lineId}" type="button">−</button>
                                        <div class="bQty" id="bQty-${lineId}">${qty}</div>
                                        <button class="bStepBtn" data-act="plus" data-line="${lineId}" type="button">+</button>
                                      </div>
                                    `;
                body.appendChild(row);
            }

            const { subtotal, studentDisc, happyHourDisc, birthdayDisc, total } = calcTotalWithDiscounts();
            const studentP = discountPercentNow();
            const hasDiscounts = (studentDisc + happyHourDisc + birthdayDisc) > 0;

            const studentRow = studentP > 0 ? `
                                    <div class="basketSummaryRow">
                                      <div class="basketSummaryLabel">Student discount ${studentP}%</div>
                                      <div class="basketSummaryVal">-${money(studentDisc)}</div>
                                    </div>
                                  ` : "";

            const happyHourRow = happyHourDisc > 0 ? `
                                    <div class="basketSummaryRow">
                                      <div class="basketSummaryLabel">Happy Hour 30%</div>
                                      <div class="basketSummaryVal">-${money(happyHourDisc)}</div>
                                    </div>
                                  ` : "";

            const birthdayRow = (birthdayVoucherApplied && birthdayDisc > 0) ? `
                                    <div class="basketSummaryRow">
                                      <div class="basketSummaryLabel">שובר יום הולדת 50% (עד ₪200)</div>
                                      <div class="basketSummaryVal">-${money(birthdayDisc)}</div>
                                    </div>
                                  ` : "";

            const totalRow = hasDiscounts ? `
              <div class="basketSummaryRow total">
                <div class="basketSummaryLabel">
                  ${isRTL() ? "סה״כ" : "Total"}
                </div>
                <div class="basketSummaryVal">${money(total)}</div>
              </div>
` : "";

            const birthdayBtn = canApplyBirthdayVoucher(subtotal) ? `
                                   <button
              id="birthdayVoucherBtn"
              class="btnCheckout"
              style="margin-bottom:10px"
              onclick="applyBirthdayVoucher()">
              ממש שובר יום הולדת 🎁
</button>
                                  ` : "";

            const redeemBtn = canRedeemFreeCoffee() ? `
              <button class="btnCheckout redeemCoffeeBtn"
                      onclick="redeemFreeCoffee()">
                ${isRTL() ? "ממש קפה חינם ☕️" : "Redeem free coffee"}
              </button>
` : "";

            const isMini3 = (resolveMiniAppIdForSubmit() === 3);

            $("basketBottom").innerHTML = `
      <div class="basketSummary">
        ${studentRow}
        ${happyHourRow}
        ${birthdayRow}
        ${totalRow}
      </div>
      ${birthdayBtn}
      ${redeemBtn}

      ${isMini3
                    ? `
            <div id="gpayHost" style="margin-top:10px"></div>
          `
                    : `
            <button id="zcPayBtn" class="zcPayBtn" type="button" data-amt="${Number(total || 0).toFixed(2)}">
              <span class="zcPayWord">Pay</span>
              <span class="zcGText">G</span>
            </button>
          `
                }
`;

            if (isMini3) {
                mountStripeGPayButton(Number(total || 0));
            }
            // ✅ wire clicks reliably (no inline onclick)


            const zcBtn = document.getElementById("zcPayBtn");
            if (zcBtn) {
                zcBtn.onclick = () => {
                    const amt = Number(zcBtn.dataset.amt || "0");
                    beginCheckout(amt);
                };
            }

            body.querySelectorAll(".bStepBtn").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const act = btn.dataset.act;
                    const lineId = Number(btn.dataset.line);
                    if (!basket.has(lineId)) return;

                    const line = basket.get(lineId);
                    if (!line) return;

                    if (act === "plus") {
                        line.qty = Number(line.qty || 0) + 1;
                    } else {
                        line.qty = Number(line.qty || 0) - 1;
                        if (line.qty <= 0) {
                            basket.delete(lineId);
                            if (lineId === Number(freeCoffee.lineId)) freeCoffee = { lineId: 0, units: 0 };
                        }
                    }

                    if (lineId === Number(freeCoffee.lineId)) clearFreeCoffeeIfNeeded();

                    updateBasket();
                    if (basket.size === 0) { closeBasket(); return; }
                    openBasket();
                    if (isMini3) {
                        mountStripeGPayButton(Number(total || 0));
                    }
                });
            });

            showSheet($("basketModal"));
        }

        let _gpayMountedForTotal = null;

        async function mountStripeGPayButton(total) {


            const host = document.getElementById("gpayHost");
            if (!host) { alert("❌ gpayHost missing"); return; }

            const amt = Number(total || 0);
            if (!amt || isNaN(amt)) { alert("❌ invalid total"); return; }

            // avoid remount spam when openBasket reruns
            const key = amt.toFixed(2);
            if (_gpayMountedForTotal === key && host.dataset.mounted === "1") {
                alert("🟦 already mounted");
                return;
            }
            _gpayMountedForTotal = key;

            host.innerHTML = "";          // clear any old button
            host.dataset.mounted = "0";

            const s = ensureStripe();     // MUST be real pk_live_...


            // Create paymentRequest (no PaymentIntent yet — we do it only when user taps)
            const pr = s.paymentRequest({
                country: "GB",
                currency: "gbp",
                total: { label: "Total", amount: Math.round(amt * 100) },
                requestPayerName: true,
                requestPayerPhone: true
            });

            const can = await pr.canMakePayment();

            if (!can) {
                host.innerHTML = `<div style="font-weight:800;opacity:.7;padding:10px 0;">Google Pay not available</div>`;
                return;
            }

            // Mount the real wallet button
            const elements = s.elements();
            const prButton = elements.create("paymentRequestButton", { paymentRequest: pr });
            prButton.mount("#gpayHost");
            host.dataset.mounted = "1";

            // When user taps Google Pay and authorizes, create PI and confirm
            pr.on("paymentmethod", async (ev) => {
                try {
                    console.log("🟩 paymentmethod fired");

                    // 1️⃣ Create PaymentIntent
                    const res = await fetch(
                        `/stripe/create-payment-intent?miniAppId=3&amount=${encodeURIComponent(amt.toFixed(2))}&currency=gbp`,
                        { method: "GET", cache: "no-store" }
                    );

                    const data = await res.json().catch(() => null);

                    if (!res.ok || !data?.clientSecret) {
                        console.error("❌ PI create failed:", data);
                        ev.complete("fail");
                        hardUnlockCheckout("stripe-pi-fail");
                        return;
                    }

                    // 2️⃣ Confirm payment
                    const confirm = await s.confirmCardPayment(
                        data.clientSecret,
                        { payment_method: ev.paymentMethod.id },
                        { handleActions: true }
                    );

                    if (confirm.error) {
                        console.error("❌ confirmCardPayment error:", confirm.error);
                        ev.complete("fail");
                        hardUnlockCheckout("stripe-confirm-fail");
                        return;
                    }

                    const pi = confirm.paymentIntent;

                    if (!pi || pi.status !== "succeeded") {
                        console.error("❌ Payment not succeeded:", pi?.status);
                        ev.complete("fail");
                        hardUnlockCheckout("stripe-not-succeeded");
                        return;
                    }

                    ev.complete("success");
                    console.log("✅ Stripe payment succeeded:", pi.id);

                    // 3️⃣ Ensure pending snapshot exists
                    let pending = loadPendingCheckout();

                    if (!pending?.lines?.length || !pending?.totals) {
                        console.log("⚠️ Missing pending snapshot — rebuilding");

                        const basketSnapshot = [...basket.values()].map(l => {
                            const snap = {
                                productId: Number(l.item?.id || 0),
                                name: String(l.item?.name || ""),
                                qty: Number(l.qty || 0),
                                unitPrice: Number(l.price || 0),
                                modsText: String(l.modsText || ""),
                                image: l.image || l.item?.image || "",
                                item: {
                                    id: Number(l.item?.id || 0),
                                    tags: Array.isArray(l.item?.tags) ? l.item.tags : []
                                }
                            };

                            snap.earnsStamp = basketLineEarnsStampNow(snap);
                            return snap;
                        });

                        const subtotal = basketSnapshot.reduce((s, l) => s + (l.qty * l.unitPrice), 0);
                        const studentDisc = calcDiscountAmount(subtotal);
                        const happyHourDisc = (typeof calcHappyHourDiscount === "function") ? calcHappyHourDiscount() : 0;
                        const birthdayDisc = birthdayVoucherApplied ? calcBirthdayDiscount(subtotal) : 0;
                        const totalPay = Math.max(0, subtotal - (studentDisc + happyHourDisc + birthdayDisc));

                        const totalsObj = buildTotalsObject({
                            subtotal,
                            studentDisc,
                            happyHourDisc,
                            birthdayDisc,
                            total: totalPay,
                            miniAppId: 3
                        });

                        persistPendingCheckout({ lines: basketSnapshot, totals: totalsObj });
                        pending = loadPendingCheckout();
                    }

                    if (!pending?.lines?.length) {
                        console.error("❌ Still missing pending lines");
                        hardUnlockCheckout("stripe-missing-pending");
                        return;
                    }

                    // 4️⃣ Submit order
                    const { orderId } = await submitOrderPWA({
                        lines: pending.lines,
                        totals: pending.totals,
                        paymentMethod: "card",
                        zcreditMeta: null,
                        stripeMeta: { paymentIntentId: pi.id }
                    });

                    console.log("✅ Order saved:", orderId);

                    // 5️⃣ Cleanup UI
                    try { closeBasket?.(); } catch { }
                    try { basket.clear(); } catch { }
                    try { updateBasket(); } catch { }

                    const order = {
                        orderNumber: orderId,
                        lines: pending.lines,
                        total: Number(pending?.totals?.total || 0),
                        phase: "inProgress"
                    };

                    saveLastOrder(order);
                    renderOrderBanner?.();
                    openConfirmation(order);
                    clearPendingCheckout();

                    hardUnlockCheckout("stripe-success");

                } catch (e) {
                    console.error("❌ Stripe flow exception:", e);
                    try { ev.complete("fail"); } catch { }
                    hardUnlockCheckout("stripe-exception");
                }
            });
        }

        function basketLineEarnsStampNow(line) {
            const item = line?.item || {};
            const tags = Array.isArray(item.tags) ? item.tags : [];
            const tagsNorm = tags.map(t => String(t || "").trim().toLowerCase());

            const earnTag = String(getStampEarnTag() || "").trim().toLowerCase();

            return (
                (earnTag && tagsNorm.includes(earnTag)) ||
                tagsNorm.includes("stamp") ||
                isCoffeeStampName(item?.name || line?.name || "")
            );
        }
        function closeBasket() { hideSheet($("basketModal")); }

        function nextOrderNumber() {
            const key = "menu.localTicketNumber";
            const v = Number(localStorage.getItem(key) || "1000") + 1;
            localStorage.setItem(key, String(v));
            return v;
        }
        function getMiniLoyaltySafe() {
            try {
                const raw = localStorage.getItem("miniLoyalty") || "";
                const j = raw ? JSON.parse(raw) : null;
                return (j && typeof j === "object") ? j : null;
            } catch { return null; }
        }

        function buildLoyaltyBullets(lo, rtl) {
            if (!lo) return [];

            const bullets = [];

            // ☕ stamps
            if (lo.stamps?.label) {
                const label = String(lo.stamps.label).trim() || (rtl ? "קפה" : "coffee");
                bullets.push(
                    rtl
                        ? `☕️ כל 10 ${label} אחד עלינו`
                        : `☕️ Every 10 ${label} — the 11th is free`
                );
            }

            // 🥐 happy hour
            if (lo.happyHour?.percent && lo.happyHour?.start && lo.happyHour?.end) {
                const p = Number(lo.happyHour.percent) || 0;
                const start = String(lo.happyHour.start).trim();
                const end = String(lo.happyHour.end).trim();
                bullets.push(
                    rtl
                        ? `🥐 ${p}% הנחה בין ${start}–${end}`
                        : `🥐 ${p}% off between ${start}–${end}`
                );
            }

            // 🎁 birthday
            if (lo.birthday?.percent) {
                const p = Number(lo.birthday.percent) || 0;
                const cap = Number(lo.birthday.cap || 0) || 0;
                bullets.push(
                    rtl
                        ? `🎁 ${p}% שובר יום הולדת${cap ? ` (עד ${cap})` : ""}`
                        : `🎁 ${p}% birthday voucher${cap ? ` (up to ${cap})` : ""}`
                );
            }

            return bullets.filter(Boolean).slice(0, 3);
        }
        function renderDownloadIncentive() {
            const miniAppId = resolveMiniAppIdForSubmit();
            if (miniAppId === 3) {
                const card = document.getElementById("downloadIncentive");
                if (card) card.style.display = "none";
                return;
            }
            const rtl = document.documentElement.dir === "rtl";
            const card = document.getElementById("downloadIncentive");
            if (!card) return;

            const lo = getMiniLoyaltySafe();

            // ✅ If no loyalty configured -> hide the whole card
            if (!lo) {
                card.style.display = "none";
                return;
            }
            card.style.display = "";

            // Title
            const title = (String(lo.title || "").trim()) || (rtl ? "מועדון חברים" : "Members club");
            const titleEl = card.querySelector(".downloadTitle");
            if (titleEl) titleEl.textContent = title;

            // Bullets (0..3)
            const bullets = buildLoyaltyBullets(lo, rtl);
            const spans = card.querySelectorAll(".downloadBullets span");
            spans.forEach((el, i) => {
                el.textContent = bullets[i] || "";
                // hide the row if empty
                const row = el.closest(".bullet");
                if (row) row.style.display = bullets[i] ? "" : "none";
            });

            // Button label
            const btn = card.querySelector(".downloadBtn");
            if (btn) {
                btn.textContent = rtl ? "הורד את האפליקציה" : "Download the full app";
                btn.onclick = () => {
                    if (typeof startInstallFlow === "function") startInstallFlow();
                    else openA2HSHelpSheet?.();
                };
            }
        }

        function openConfirmation(order) {
            const rtl = document.documentElement.dir === "rtl";

            // helper: confirmation money (no £ in RTL)
            const confirmMoney = (n) => {
                const v = Number(n || 0);
                return rtl ? v.toFixed(2) : `£${v.toFixed(2)}`;
            };

            // texts (RTL)
            const titleEl = document.querySelector("#confirmView .confirmTitle");
            if (titleEl) titleEl.textContent = rtl ? "אישור הזמנה" : "Confirmation";

            const h1 = document.querySelector("#confirmView .confirmH1");
            if (h1) h1.textContent = rtl ? "תודה!" : "Thank you!";

            const h2 = document.querySelector("#confirmView .confirmH2");
            if (h2) h2.textContent = rtl ? "מספר הזמנה" : "Your order number";

            const h3 = document.querySelector("#confirmView .confirmH3");
            if (h3) h3.textContent = rtl ? "נשלח הודעה כשמוכן" : "We’ll notify you when it’s ready";

            const detailsTitle = document.querySelector("#confirmView .confirmSectionTitle");
            if (detailsTitle) detailsTitle.textContent = rtl ? "פרטי הזמנה" : "Order details";

            const totalLabel = document.querySelector("#confirmView .confirmTotalLabel");
            if (totalLabel) totalLabel.textContent = rtl ? 'סה"כ' : "Total";

            // order number
            $("confirmOrderId").textContent = String(order.orderNumber).slice(-4).padStart(4, "0");

            // items
            const itemsHost = $("confirmItems");
            itemsHost.innerHTML = "";

            (order.lines || []).forEach((l) => {
                const qty = Number(l.qty || 0);
                const unit = Number(l.unitPrice || 0);

                const line = document.createElement("div");
                line.className = "confirmLine";

                const mods = String(l.modsText || "").trim();
                const subHtml = mods ? `<div class="confirmLineSub">${mods}</div>` : "";

                line.innerHTML = `
                          <div>
                            <div class="confirmLineName">${qty}× ${l.name}</div>
                            ${subHtml}
                          </div>
                          <div class="confirmLinePrice">${confirmMoney(qty * unit)}</div>
                        `;

                itemsHost.appendChild(line);
            });



            renderDownloadIncentive();
            // total (no £ in RTL)
            $("confirmTotalVal").textContent = confirmMoney(order.total);

            // open
            $("confirmView").classList.add("open");
            $("confirmView").setAttribute("aria-hidden", "false");
        }

        function closeConfirmation() {
            $("confirmView").classList.remove("open");
            $("confirmView").setAttribute("aria-hidden", "true");
        }

        const LAST_ORDER_KEY = "menu.lastOrderBanner.v1";
        function saveLastOrder(order) { try { localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(order)); } catch { } }
        function loadLastOrder() { try { const raw = localStorage.getItem(LAST_ORDER_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } }

        // ------------------------------
        // submitOrder (PWA) helpers
        // ------------------------------
        function uuid32() {
            // 32 hex chars, similar to your Swift .replacingOccurrences("-", with: "")
            const s = (crypto?.randomUUID?.() || ("id-" + Date.now() + "-" + Math.random().toString(16).slice(2)));
            return String(s).replace(/[^a-f0-9]/gi, "").padEnd(32, "0").slice(0, 32);
        }

        function resolveMiniAppIdForSubmit() {
            return getMiniAppId(); // ✅ one source of truth
        }

        function ensureAnonUUID() {
            let u = "";
            try { u = (localStorage.getItem("anonUUID") || "").trim(); } catch { }
            if (!u) {
                u = (crypto?.randomUUID?.() || ("anon-" + Date.now() + "-" + Math.random().toString(16).slice(2)));
                try { localStorage.setItem("anonUUID", u); } catch { }
            }
            return u;
        }

        function resolveOrderSource() {
            // mirror Swift: lowercased, trimmed, and allow overrides
            return "mini";
        }


        function resolveDeliveryLocForMini3() {
            // Only for mini 3
            const miniAppId = resolveMiniAppIdForSubmit();
            if (miniAppId !== 3) return "";

            // Match Swift: read "deliveryLoc", trim, lower
            const clean = (s) => String(s || "").trim().toLowerCase();

            const saved = clean(localStorage.getItem("deliveryLoc"));
            if (saved) return saved;

            // Swift fallback
            const fallback = "mikkeller";

            // Persist fallback like Swift does
            try { localStorage.setItem("deliveryLoc", fallback); } catch { }

            return fallback;
        }


        function resolveDeliveryLocIfNeeded(miniAppId) {
            // mirror Swift fallback: miniAppId == 3 requires loc (default "mikkeller")
            if (miniAppId !== 3) return "";
            const loc = String(localStorage.getItem("deliveryLoc") || "").trim().toLowerCase();
            return loc || "mikkeller";
        }

        function basketPayloadForSubmit() {
            // replicate Swift basketPayload shape
            // NOTE: we already store line.price as "unitPrice including modifiers"
            return [...basket.entries()].map(([key, entry]) => {
                const lineId = Number(entry.lineId ?? key);
                const qty = Math.max(0, Number(entry.qty || 0));
                const unit = Number(entry.price || entry.item?.price || 0);

                return {
                    lineId,
                    productId: Number(entry.item?.id || 0),
                    name: String(entry.item?.name || ""),
                    quantity: qty,
                    unitPrice: unit,
                    lineTotal: unit * qty,
                    modifiers: String(entry.modsText || ""),
                    // you can hook othLineIds here later if you need:
                    isOth: false
                };
            });
        }

        function buildTotalsObject({ subtotal, studentDisc, happyHourDisc, birthdayDisc, total, miniAppId }) {
            // mirror your Swift "totals" idea + currency
            const currency = (miniAppId === 3) ? "GBP" : (localStorage.getItem("currency") || (isRTL() ? "ILS" : "GBP"));

            return {
                currency,
                subtotal: Math.round(Number(subtotal || 0) * 100) / 100,
                discount: Math.round(Number(studentDisc + happyHourDisc + birthdayDisc) * 100) / 100,
                total: Math.round(Number(total || 0) * 100) / 100,
                studentDisc: Math.round(Number(studentDisc || 0) * 100) / 100,
                happyHourDisc: Math.round(Number(happyHourDisc || 0) * 100) / 100,
                birthdayDisc: Math.round(Number(birthdayDisc || 0) * 100) / 100
            };
        }

        function getSelectedLocationIdRaw() {
            const KEY = "mini.location.selected.v1";
            return (localStorage.getItem(KEY) || "").trim();
        }

        // ✅ TEMP mapping for Mini 13
        function normalizePickupLocation(locId) {
            const v = String(locId || "").trim().toLowerCase();

            // your JSON ids -> backend enum values
            if (v === "humanities") return "cafeteria";
            if (v === "social") return "scienceBuilding";

            // already normalized / coming from elsewhere
            if (v === "cafeteria") return "cafeteria";
            if (v === "sciencebuilding") return "scienceBuilding";

            return "";
        }

        function getPickupLocation() {
            const miniAppId = Number(localStorage.getItem("miniAppId") || 0);

            // only Mini 13 for now
            if (miniAppId !== 13) return null;

            const raw = getSelectedLocationIdRaw();
            const norm = normalizePickupLocation(raw);

            // ✅ default for now (your request)
            const out = norm || "cafeteria";

            console.log("📍 pickupLocation:", { raw, norm, out });
            return out;
        }



        async function submitOrderPWA({
            lines,
            totals,
            paymentMethod = "cash",
            zcreditMeta = null,
            stripeMeta = null,
            pickupLocation = null
        }) {
            console.group("🛒 submitOrderPWA");

            const miniAppId = resolveMiniAppIdForSubmit();
            const uuid = ensureAnonUUID();

            const name = (getCookie("userName") || "Customer").trim() || "Customer";
            const phoneDigits = (getCookie("userPhone") || "").trim();
            const email = (getCookie("userEmail") || localStorage.getItem("userEmail") || "customer@example.com").trim()
                || "customer@example.com";

            // service / pickup
            const intent = getServiceIntent();
            const diningMode = (intent === "sit") ? "dineIn" : "takeAway";
            let service = (intent === "sit") ? "sit" : "ta";

            const source = resolveOrderSource();
            const idempotencyKey = uuid32();

            const basketPayload = (lines || []).map((l, idx) => {
                const qty = Math.max(0, Number(l.qty ?? l.quantity ?? 0));
                const unit = Number(l.unitPrice ?? l.price ?? 0);

                return {
                    lineId: Number(l.lineId ?? (idx + 1)),
                    productId: Number(l.productId ?? 0),
                    name: String(l.name ?? ""),
                    quantity: qty,
                    unitPrice: unit,
                    lineTotal: unit * qty,
                    modifiers: String(l.modsText ?? l.modifiers ?? ""),
                    isOth: false
                };
            });

            const due = Number(totals?.total || 0);

            const method = (paymentMethod || "cash").toLowerCase(); // "cash" | "card"
            const payment = {
                provider: "minis",
                method,
                cardAmount: method === "card" ? due : 0,
                cashAmount: method === "cash" ? due : 0
            };

            const payload = {
                uuid,
                email,
                name,
                miniAppId,
                total: due,
                basket: basketPayload,
                diningMode,
                service,
                device: { platform: "web", token: "" },
                totals,
                source,
                orderSource: source,
                idempotencyKey,
                payment
            };

            // ✅ MINI 3 delivery (match Swift: delivery.loc + force TA)
            if (miniAppId === 3) {
                const loc = resolveDeliveryLocForMini3();
                payload.delivery = { isDelivery: true, loc: loc || "mikkeller" };
                payload.service = "ta";
            }

            // ✅ attach Stripe meta (payment intent id etc.)
            if (stripeMeta && typeof stripeMeta === "object") {
                payload.stripe = stripeMeta;
                payload.stripeMeta = stripeMeta;
            }

            // ✅ attach ZCredit meta
            if (zcreditMeta && typeof zcreditMeta === "object") {
                payload.zcredit = zcreditMeta;
                payload.zcreditMeta = zcreditMeta;
            }

            // ✅ MINI 13 pickup location
            const pick = getPickupLocation?.();
            if (pick) payload.pickupLocation = pick;

            // ✅ WhatsApp phone (server can use it)
            if (phoneDigits) payload.notifications = { wa: { phone: phoneDigits, consent: 1 } };

            // DEBUG
            console.log("📦 FINAL PAYLOAD:", payload);
            console.log("📦 FINAL PAYLOAD JSON:\n", JSON.stringify(payload, null, 2));

            const url = "https://minis.studio/submitOrder";
            const headers = {
                "Content-Type": "application/json",
                "X-Order-Source": source,
                "Idempotency-Key": idempotencyKey,
                "X-Request-Id": idempotencyKey
            };

            console.log("🌐 FETCH URL:", url);
            console.log("🌐 FETCH HEADERS:", headers);
            console.log("🌐 FETCH BODY:", JSON.stringify(payload));

            const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
            const data = await res.json().catch(() => null);

            if (!res.ok) throw new Error(data?.error || data?.message || `Server error (${res.status})`);
            const orderId = Number(data?.orderId || 0);
            if (!orderId) throw new Error("Server did not return orderId");
            try {
                await notifyWhatsAppAfterOrder({
                    orderId,
                    miniAppId,
                    name,
                    phone: phoneDigits,
                    total: due
                });
            } catch (e) {
                console.warn("WhatsApp send failed (non-blocking):", e);
            }

            console.groupEnd();
            return { orderId, replay: !!data?.replay };
        }

        let __submittingOrder = false;

        const PENDING_KEY = "pwa.pendingCheckout.v1";
        function basketFingerprint() {
            const lines = [...basket.values()]
                .map(l => ({
                    productId: Number(l.item?.id || 0),
                    qty: Number(l.qty || 0),
                    unitPrice: Number(l.price || 0),
                    modsText: String(l.modsText || "")
                }))
                .sort((a, b) => {
                    if (a.productId !== b.productId) return a.productId - b.productId;
                    if (a.modsText !== b.modsText) return a.modsText.localeCompare(b.modsText);
                    return a.unitPrice - b.unitPrice;
                });

            return JSON.stringify({
                lines,
                service: getServiceIntent(),
                pickupLocation: getPickupLocation?.() || "",
                miniAppId: resolveMiniAppIdForSubmit()
            });
        }
        function persistPendingCheckout({ lines, totals }) {
            try {
                const miniAppId = resolveMiniAppIdForSubmit();
                const existing = loadPendingCheckout();
                const newFingerprint = basketFingerprint();

                const shouldReuseAttempt =
                    existing &&
                    existing.basketFingerprint === newFingerprint &&
                    existing.miniAppId === miniAppId;

                const checkoutAttemptId =
                    shouldReuseAttempt
                        ? existing.checkoutAttemptId
                        : (crypto?.randomUUID?.() || ("chk-" + Date.now() + "-" + Math.random().toString(16).slice(2)));

                const payload = {
                    at: Date.now(),
                    miniAppId,
                    serverOrderId: shouldReuseAttempt ? (existing?.serverOrderId || 0) : 0,
                    checkoutAttemptId,
                    basketFingerprint: newFingerprint,
                    pickupLocation: (Number(miniAppId) === 13) ? getPickupLocation() : null,
                    lines,
                    totals
                };

                localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
            } catch (e) {
                console.warn("failed to persist pending checkout", e);
            }
        }

        async function notifyWhatsAppAfterOrder({ orderId, miniAppId, name, phone, total }) {
            try {
                console.log("📲 Sending WhatsApp...");

                const cleanPhone = (phone || "").replace("+", "").replace(/\s+/g, "");

                const msg =
                    `#${orderId}\n` +
                    `${name}\n` +
                    `Phone: ${phone}\n` +
                    `Total: ${Number(total).toFixed(2)}\n` +
                    `https://bricklanebeigel.co.uk/admin?orderid=${orderId}`;

                const form = new URLSearchParams();
                form.append("token", "t8hpeqesth100p56");
                form.append("to", cleanPhone);
                form.append("body", msg);
                form.append("priority", "10");

                const res = await fetch(
                    "https://api.ultramsg.com/instance116704/messages/chat",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded"
                        },
                        body: form.toString()
                    }
                );

                const text = await res.text();
                console.log("📲 WhatsApp response:", text);

            } catch (err) {
                console.error("❌ WhatsApp send failed:", err);
            }
        }

        function loadPendingCheckout() {
            try {
                const raw = localStorage.getItem(PENDING_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch {
                return null;
            }
        }


        function clearPendingCheckout() {
            try { localStorage.removeItem(PENDING_KEY); } catch { }
        }

        function hardUnlockCheckout(reason = "") {
            unlockCheckout(reason);

            __submittingOrder = false;
            __submitStartedAt = 0;

            const btn = document.getElementById("zcPayBtn");
            if (btn) {
                btn.disabled = false;
                btn.style.opacity = "1";
                btn.style.pointerEvents = "auto";
            }
        }

        // Fires when coming back from external payment (BFCache), and also when app regains focus
        window.addEventListener("pageshow", () => hardUnlockCheckout("pageshow"));
        window.addEventListener("focus", () => hardUnlockCheckout("focus"));
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) hardUnlockCheckout("visibilitychange");
        });



        async function confirmOrder() {
            if (__submittingOrder) return;
            if (!basket || basket.size === 0) return;
            __submittingOrder = true;

            // ✅ Build a basket snapshot that includes tags (so stamp awarding is reliable)
            const basketSnapshot = [...basket.values()].map(l => ({
                productId: Number(l.item?.id || 0),
                name: String(l.item?.name || ""),
                qty: Number(l.qty || 0),
                unitPrice: Number(l.price || 0),
                modsText: String(l.modsText || ""),
                image: l.image || l.item?.image || "",
                item: {
                    id: Number(l.item?.id || 0),
                    tags: Array.isArray(l.item?.tags) ? l.item.tags : []
                }
            }));

            // ✅ Lines to send to server (keep your existing schema)
            const lines = basketSnapshot.map(l => ({
                productId: l.productId,
                name: l.name,
                qty: l.qty,
                unitPrice: l.unitPrice,
                modsText: l.modsText,
                image: l.image
            }));

            // Build totals (discounts etc)
            const subtotal = lines.reduce((s, l) => s + (l.qty * l.unitPrice), 0);
            const studentDisc = calcDiscountAmount(subtotal);
            const happyHourDisc = (typeof calcHappyHourDiscount === "function") ? calcHappyHourDiscount() : 0;
            const birthdayDisc = birthdayVoucherApplied ? calcBirthdayDiscount(subtotal) : 0;
            const total = Math.max(0, subtotal - (studentDisc + happyHourDisc + birthdayDisc));

            const miniAppId = resolveMiniAppIdForSubmit();
            const totals = buildTotalsObject({ subtotal, studentDisc, happyHourDisc, birthdayDisc, total, miniAppId });

            // ✅ Snapshot for return (we keep tags so we can award stamps in both debug + real flow)
            persistPendingCheckout({ lines: basketSnapshot, totals });

            if (DEBUG_MODE) {
                try {
                    const { orderId } = await submitOrderPWA({
                        lines,
                        totals,
                        paymentMethod: "cash",
                        zcreditMeta: null
                    });

                    // ✅ ADD THIS (awards stamps based on current order lines + item tags)
                    try {
                        DBG_STAMP("DEBUG_MODE: awarding stamps from lines", lines);
                        addStampsFromPendingLines(basketSnapshot);
                        DBG_STAMP("DEBUG_MODE: stamps after award =", memberStampsNow());
                    } catch (e) {
                        console.warn("🟣 STAMPS: award failed", e);
                    }

                    // clear basket AFTER successful save
                    try { closeBasket?.(); } catch { }
                    try { basket.clear(); } catch { }
                    try { updateBasket(); } catch { }

                    const order = {
                        orderNumber: orderId,
                        lines,
                        total: Number(totals?.total || 0),
                        phase: "inProgress"
                    };

                    saveLastOrder(order);
                    renderOrderBanner?.();
                    openConfirmation(order);

                    clearPendingCheckout();
                } catch (e) {
                    console.error("DEBUG submit failed:", e);
                    alert(isRTL() ? "שגיאה בשמירת ההזמנה" : "Order save failed");
                } finally {
                    __submittingOrder = false;
                }

                return;
            }

            try { closeBasket?.(); } catch { }

            // ✅ IMPORTANT: stop everything else and redirect NOW
            if (miniAppId === 3) {
                await startStripeHostedCheckout(total);
            } else {
                await startZCreditHostedCheckout(total);
            }
        }



        let stripe = null;
        let pr = null;
        let prButton = null;
        let __stripeClientSecret = "";
        let __stripePiId = "";

        function ensureStripe() {
            if (stripe) return stripe;
            // TODO: put your real publishable key here
            stripe = Stripe("pk_live_51H5URzFZIwZSNufssK4R7BjLhpqxHVcfmEZVH8Tg74MAHMA20RfkYhIfbwFjDWJ55KzHWkOhEcqVWhIO2VShjOcU00Tslmi1XT");
            return stripe;
        }

        async function beginStripeGooglePay(total) {


            const miniAppId = resolveMiniAppIdForSubmit();
            if (miniAppId !== 3) {
                alert("❌ not mini 3");
                return startZCreditHostedCheckout(total);
            }

            const name = (getCookie("userName") || "").trim();
            const phone = (getCookie("userPhone") || "").trim();

            if (!name || !phone) {
                alert("⚠️ missing details");
                __pendingCheckoutAfterDetails = false;
                __pendingGPayTotal = Number(total || 0);
                openDetailsSheet();
                return;
            }

            const amt = Number(total || 0);


            const res = await fetch(`/stripe/create-payment-intent?miniAppId=3&amount=${encodeURIComponent(amt.toFixed(2))}&currency=gbp`, {
                method: "GET",
                cache: "no-store"
            });



            const data = await res.json().catch(() => null);


            if (!res.ok || !data?.clientSecret) {
                alert("❌ PaymentIntent creation failed");
                return;
            }

            const s = ensureStripe();


            const pr = s.paymentRequest({
                country: "GB",
                currency: "gbp",
                total: { label: "Total", amount: Math.round(amt * 100) },
                requestPayerName: true,
                requestPayerPhone: true
            });

            const can = await pr.canMakePayment();

            if (!can) {
                alert("❌ Google Pay not available");
                return;
            }

            const host = document.getElementById("gpayHost");
            host.innerHTML = "";

            const elements = s.elements();
            const prButton = elements.create("paymentRequestButton", { paymentRequest: pr });
            prButton.mount("#gpayHost");



            pr.on("paymentmethod", async (ev) => {
                alert("8️⃣ paymentmethod event fired");

                const { error, paymentIntent } = await s.confirmCardPayment(data.clientSecret, {
                    payment_method: ev.paymentMethod.id
                });

                if (error) {
                    alert("❌ confirmCardPayment error: " + error.message);
                    ev.complete("fail");
                    return;
                }


                ev.complete("success");
            });
        }
        let _elements = null;
        function elementsOrCreate(s) {
            if (_elements) return _elements;
            _elements = s.elements();
            return _elements;
        }



        async function startStripeHostedCheckout(total) {
            // 1) persist snapshot (same as you do for ZCredit)
            let totalPay = 0;

            try {
                const basketSnapshot = [...basket.values()].map(l => ({
                    productId: Number(l.item?.id || 0),
                    name: String(l.item?.name || ""),
                    qty: Number(l.qty || 0),
                    unitPrice: Number(l.price || 0),
                    modsText: String(l.modsText || ""),
                    image: l.image || l.item?.image || "",
                    item: { id: Number(l.item?.id || 0), tags: Array.isArray(l.item?.tags) ? l.item.tags : [] }
                }));

                const subtotal = basketSnapshot.reduce((s, l) => s + (l.qty * l.unitPrice), 0);
                const studentDisc = calcDiscountAmount(subtotal);
                const happyHourDisc = (typeof calcHappyHourDiscount === "function") ? calcHappyHourDiscount() : 0;
                const birthdayDisc = birthdayVoucherApplied ? calcBirthdayDiscount(subtotal) : 0;

                totalPay = Math.max(0, subtotal - (studentDisc + happyHourDisc + birthdayDisc));

                const miniAppId = resolveMiniAppIdForSubmit();
                const totals = buildTotalsObject({ subtotal, studentDisc, happyHourDisc, birthdayDisc, total: totalPay, miniAppId });

                persistPendingCheckout({ lines: basketSnapshot, totals });
                total = totalPay;
            } catch (e) {
                console.warn("[STRIPE] snapshot failed", e);
                totalPay = Number(total || 0);
            }

            const amt = Number(total || 0);
            if (!amt || isNaN(amt)) {
                alert(isRTL() ? "אין סכום לתשלום" : "No total to pay");
                return;
            }

            const miniAppId = resolveMiniAppIdForSubmit();

            // success returns to same page, with id preserved
            const returnUrl = new URL(location.href);
            returnUrl.searchParams.set("id", String(miniAppId));

            const res = await fetch(
                `/stripe/create-checkout-session?miniAppId=${encodeURIComponent(miniAppId)}&amount=${encodeURIComponent(amt.toFixed(2))}&currency=GBP&returnUrl=${encodeURIComponent(returnUrl.toString())}`,
                { method: "GET", cache: "no-store" }
            );

            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok || !data?.url) {
                console.error("[STRIPE] create failed", res.status, data);
                alert(isRTL() ? "שגיאה בחיבור לתשלום" : "Payment error");
                return;
            }

            window.location.href = data.url;
        }

        async function handleStripeReturn() {
            const url = new URL(location.href);
            const result = (url.searchParams.get("stripe") || "").toLowerCase();
            const sessionId = url.searchParams.get("session_id") || "";
            if (!result) return;

            const guardKey = `stripe:${result}:${sessionId}`;
            if (!markReturnHandledOnce(guardKey)) {
                console.warn("[STRIPE] duplicate return ignored");
                return;
            }

            const cleanup = () => {
                ["stripe", "session_id"].forEach(k => url.searchParams.delete(k));
                history.replaceState({}, document.title, url.toString());
            };

            if (result !== "success" || !sessionId) {
                cleanup();
                return;
            }

            const pending = loadPendingCheckout();
            if (!pending?.lines?.length) {
                console.warn("[STRIPE] success but no pending snapshot");
                cleanup();
                return;
            }

            try {
                const vres = await fetch(`/stripe/session-status?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
                const v = await vres.json().catch(() => null);

                if (!vres.ok || !v?.ok || v?.status !== "complete") {
                    console.warn("[STRIPE] session not complete:", v);
                    alert(isRTL() ? "התשלום לא הושלם" : "Payment not completed");
                    cleanup();
                    return;
                }

                const { orderId } = await submitOrderPWA({
                    lines: pending.lines,
                    totals: pending.totals,
                    paymentMethod: "card",
                    zcreditMeta: null,
                    pickupLocation: pending.pickupLocation || null
                });

                try { addStampsFromPendingLines(pending.lines); } catch { }

                try { closeBasket?.(); } catch { }
                try { basket?.clear?.(); } catch { }
                try { updateBasket?.(); } catch { }

                const total = Number(pending?.totals?.total || 0);
                const order = { orderNumber: orderId, lines: pending.lines, total, phase: "inProgress" };

                saveLastOrder(order);
                renderOrderBanner?.();
                openConfirmation(order);

                clearPendingCheckout();
            } catch (e) {
                console.error("[STRIPE] submit after success failed:", e);
                alert(isRTL() ? "שגיאה בשמירת ההזמנה" : "Order save failed");
            } finally {
                cleanup();
            }
        }

        document.addEventListener("DOMContentLoaded", () => {
            handleStripeReturn();
            handleZCreditReturn();
        });

        function dbgAlert(label, data = null) {
            try {
                const text = data == null
                    ? String(label)
                    : `${label}\n${typeof data === "string" ? data : JSON.stringify(data, null, 2)}`;
                alert(text);
                console.log("🚨", label, data);
            } catch (e) {
                alert(String(label));
                console.log("🚨", label, data, e);
            }
        }

        function beginCheckout(total) {
            if (!lockCheckout()) {
                console.warn("[CHECKOUT] blocked duplicate tap");
                return;
            }

            const miniAppId = resolveMiniAppIdForSubmit();

            const name = (getCookie("userName") || "").trim();
            const phone = (getCookie("userPhone") || "").trim();

            const btn = document.getElementById("zcPayBtn");
            if (btn) {
                btn.disabled = true;
                btn.style.opacity = "0.6";
                btn.style.pointerEvents = "none";
            }

            if (!name || !phone) {
                hardUnlockCheckout("missing-details");
                __pendingCheckoutAfterDetails = false;
                __pendingGPayTotal = Number(total || 0);
                openDetailsSheet();
                return;
            }

            if (miniAppId === 3) {
                startStripeHostedCheckout(total).catch(err => {
                    console.error("[CHECKOUT] stripe start failed", err);
                    hardUnlockCheckout("stripe-start-failed");
                });
            } else {
                startZCreditHostedCheckout(total).catch(err => {
                    console.error("[CHECKOUT] zcredit start failed", err);
                    hardUnlockCheckout("zcredit-start-failed");
                });
            }
        }
        function skipPayNow() {
            try {
                return new URLSearchParams(location.search).get("skipPay") === "1";
            } catch { return true; }
        }

        function appendBasketAndTotalsToUrl(url, basketSnapshot, totals, miniAppId) {
            const u = new URL(url, location.origin);

            // service / dining mode
            const intent = getServiceIntent();
            const diningMode = intent === "sit" ? "dineIn" : "takeAway";
            const service = intent === "sit" ? "sit" : "ta";

            u.searchParams.set("service", service);
            u.searchParams.set("diningMode", diningMode);
            u.searchParams.set("devicePlatform", "web");

            // totals
            if (totals) {
                u.searchParams.set("totals.currency", String(totals.currency || ""));
                u.searchParams.set("totals.subtotal", String(Number(totals.subtotal || 0).toFixed(2)));
                u.searchParams.set("totals.discount", String(Number(totals.discount || 0).toFixed(2)));
                u.searchParams.set("totals.total", String(Number(totals.total || 0).toFixed(2)));
                u.searchParams.set("totals.studentDisc", String(Number(totals.studentDisc || 0).toFixed(2)));
                u.searchParams.set("totals.happyHourDisc", String(Number(totals.happyHourDisc || 0).toFixed(2)));
                u.searchParams.set("totals.birthdayDisc", String(Number(totals.birthdayDisc || 0).toFixed(2)));
            }

            // pickup location for mini 13
            const pick = getPickupLocation?.();
            if (pick) {
                u.searchParams.set("pickupLocation", pick);
            }

            // delivery for mini 3
            if (Number(miniAppId) === 3) {
                const loc = resolveDeliveryLocForMini3?.() || "";
                if (loc) u.searchParams.set("delivery.loc", loc);
                u.searchParams.set("delivery.isDelivery", "true");
            }

            // basket lines
            (basketSnapshot || []).forEach((line, i) => {
                u.searchParams.set(`basket[${i}][lineId]`, String(Number(line.lineId ?? (i + 1))));
                u.searchParams.set(`basket[${i}][productId]`, String(Number(line.productId || 0)));
                u.searchParams.set(`basket[${i}][name]`, String(line.name || ""));
                u.searchParams.set(`basket[${i}][qty]`, String(Number(line.qty || 0)));
                u.searchParams.set(`basket[${i}][unitPrice]`, String(Number(line.unitPrice || 0).toFixed(2)));
                u.searchParams.set(`basket[${i}][lineTotal]`, String((Number(line.qty || 0) * Number(line.unitPrice || 0)).toFixed(2)));
                u.searchParams.set(`basket[${i}][modsText]`, String(line.modsText || ""));
                u.searchParams.set(`basket[${i}][image]`, String(line.image || ""));
            });

            return u.toString();
        }



        function buildBasketSnapshotForHostedCheckout() {
            return [...basket.values()].map((l, idx) => ({
                lineId: Number(l.lineId ?? (idx + 1)),
                productId: Number(l.item?.id || 0),
                name: String(l.item?.name || ""),
                qty: Number(l.qty || 0),
                unitPrice: Number(l.price || 0),
                modsText: String(l.modsText || ""),
                image: l.image || l.item?.image || ""
            }));
        }

        async function startZCreditHostedCheckout(total) {
            let totalPay = 0;
            let basketSnapshot = [];
            let totals = null;

            try {
                basketSnapshot = buildBasketSnapshotForHostedCheckout();

                console.log("[ZCREDIT] basket live =", [...basket.values()]);
                console.log("[ZCREDIT] basketSnapshot =", basketSnapshot);

                if (!Array.isArray(basketSnapshot) || basketSnapshot.length === 0) {
                    console.error("[ZCREDIT] empty basket snapshot");
                    hardUnlockCheckout("empty-basket-snapshot");

                    return;
                }

                const badLine = basketSnapshot.find(x =>
                    !Number(x.productId) ||
                    !String(x.name || "").trim() ||
                    Number(x.qty || 0) <= 0
                );

                if (badLine) {
                    console.error("[ZCREDIT] invalid basket line", badLine);
                    hardUnlockCheckout("invalid-basket-line");
                    return;
                }

                const subtotal = basketSnapshot.reduce((s, l) => s + (l.qty * l.unitPrice), 0);
                const studentDisc = calcDiscountAmount(subtotal);
                const happyHourDisc = (typeof calcHappyHourDiscount === "function") ? calcHappyHourDiscount() : 0;
                const birthdayDisc = birthdayVoucherApplied ? calcBirthdayDiscount(subtotal) : 0;

                totalPay = Math.max(0, subtotal - (studentDisc + happyHourDisc + birthdayDisc));

                const miniAppId = resolveMiniAppIdForSubmit();
                totals = buildTotalsObject({
                    subtotal,
                    studentDisc,
                    happyHourDisc,
                    birthdayDisc,
                    total: totalPay,
                    miniAppId
                });

                persistPendingCheckout({ lines: basketSnapshot, totals });
                total = totalPay;
            } catch (e) {
                console.warn("[ZCREDIT] snapshot failed, falling back", e);
                totalPay = Number(total || 0);
            }

            const amt = Number(total || 0);
            if (!amt || isNaN(amt)) {
                alert(isRTL() ? "אין סכום לתשלום" : "No total to pay");
                return;
            }

            const miniAppId = resolveMiniAppIdForSubmit();

            const pendingBeforeCreate = loadPendingCheckout() || {};

            // ✅ stable attempt id across retries for the same pending checkout
            let checkoutAttemptId = String(pendingBeforeCreate.checkoutAttemptId || "").trim();
            if (!checkoutAttemptId) {
                checkoutAttemptId =
                    (crypto?.randomUUID?.() || ("chk-" + Date.now() + "-" + Math.random().toString(16).slice(2)));
            }

            const internalOrderId = `PWA-${miniAppId}-${checkoutAttemptId}`;

            const returnUrl = new URL(location.href);
            returnUrl.searchParams.set("id", String(miniAppId));

            const name = (getCookie("userName") || "Customer").trim() || "Customer";
            const email = (getCookie("userEmail") || localStorage.getItem("userEmail") || "customer@example.com").trim() || "customer@example.com";
            const phone = (getCookie("userPhone") || "").trim();
            const source = resolveOrderSource();

            // ✅ persist the stable attempt id before calling server
            try {
                const pendingToSave = {
                    ...pendingBeforeCreate,
                    at: pendingBeforeCreate.at || Date.now(),
                    miniAppId,
                    lines: (basketSnapshot && basketSnapshot.length) ? basketSnapshot : (pendingBeforeCreate.lines || []),
                    totals: totals || pendingBeforeCreate.totals || null,
                    pickupLocation:
                        pendingBeforeCreate.pickupLocation ??
                        ((Number(miniAppId) === 13) ? getPickupLocation() : null),
                    serverOrderId: Number(pendingBeforeCreate.serverOrderId || 0),
                    checkoutAttemptId
                };

                localStorage.setItem(PENDING_KEY, JSON.stringify(pendingToSave));
            } catch (e) {
                console.warn("[ZCREDIT] failed saving stable checkoutAttemptId", e);
            }

            let createUrl =
                `/test/zcredit/create` +
                `?miniAppId=${encodeURIComponent(miniAppId)}` +
                `&amount=${encodeURIComponent(amt.toFixed(2))}` +
                `&currency=ILS` +
                `&orderId=${encodeURIComponent(internalOrderId)}` +
                `&idempotencyKey=${encodeURIComponent(checkoutAttemptId)}` +
                `&returnUrl=${encodeURIComponent(returnUrl.toString())}` +
                `&name=${encodeURIComponent(name)}` +
                `&email=${encodeURIComponent(email)}` +
                `&phone=${encodeURIComponent(phone)}` +
                `&source=${encodeURIComponent(source)}`;

            // ✅ append real basket + totals + service + pickup/delivery
            createUrl = appendBasketAndTotalsToUrl(createUrl, basketSnapshot, totals, miniAppId);

            console.log("[ZCREDIT] createUrl length =", createUrl.length);

            if (createUrl.length > 6000) {
                console.error("[ZCREDIT] createUrl too long");
                hardUnlockCheckout("create-url-too-long");

                return;
            }

            console.log("[ZCREDIT] checkoutAttemptId =", checkoutAttemptId);
            console.log("[ZCREDIT] internalOrderId =", internalOrderId);
            console.log("[ZCREDIT] createUrl =", createUrl);

            try {
                const res = await fetch(createUrl, {
                    method: "GET",
                    cache: "no-store"
                });

                const data = await res.json().catch(() => null);

                console.log("[ZCREDIT] create status =", res.status);
                console.log("[ZCREDIT] create data =", data);

                if (!res.ok || !data?.ok || !data.checkoutUrl) {
                    hardUnlockCheckout("create-failed");

                    const msg =
                        data?.error ||
                        data?.returnMessage ||
                        data?.message ||
                        `HTTP ${res.status}`;

                    console.error("[ZCREDIT] create failed:", msg, data);
                   // alert((isRTL() ? "שגיאה בחיבור למסוף: " : "Payment terminal error: ") + msg);
                    return;
                }

                try {
                    const pending = loadPendingCheckout() || {};
                    pending.serverOrderId = Number(data.orderId || 0);
                    pending.checkoutAttemptId = checkoutAttemptId; // keep it stable on retries
                    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
                } catch { }

                console.log("[ZCREDIT] redirecting to checkoutUrl =", data.checkoutUrl);
                window.location.href = data.checkoutUrl;
            } catch (err) {
                console.error("[ZCREDIT] fetch failed:", err);
                hardUnlockCheckout("create-fetch-failed");
               // alert((isRTL() ? "שגיאה בחיבור למסוף: " : "Payment terminal error: ") + (err?.message || "network error"));
            }
        }

        async function handleZCreditReturn() {
            const url = new URL(location.href);

            // backend now returns status, not result
            const status = (url.searchParams.get("status") || url.searchParams.get("result") || "").toLowerCase();
            if (!status) return;

            const orderIdFromUrl = Number(url.searchParams.get("orderId") || "0");
            const guardKey = `zcredit:${status}:${orderIdFromUrl}:${url.search}`;

            if (!markReturnHandledOnce(guardKey)) {
                console.warn("[ZCREDIT] duplicate return ignored");
                return;
            }

            console.log("[ZCREDIT] return:", url.toString());

            const cleanup = () => {
                [
                    "status",
                    "result",
                    "orderId",
                    "referenceNumber",
                    "ref",
                    "transactionId",
                    "tx",
                    "reference",
                    "miniAppId",
                    "returnUrl"
                ].forEach(k => url.searchParams.delete(k));

                history.replaceState({}, document.title, url.toString());
            };

            if (status !== "success") {
                cleanup();
                return;
            }

            const pending = loadPendingCheckout();
            if (!pending?.lines?.length) {
                console.warn("[ZCREDIT] success but no pending snapshot");
                cleanup();
                return;
            }

            if (!orderIdFromUrl || orderIdFromUrl <= 0) {
                console.error("[ZCREDIT] missing orderId in return URL");
                alert(isRTL() ? "חסר מספר הזמנה" : "Missing order id");
                cleanup();
                return;
            }

            try {
                // ✅ backend already completed + saved the order
                try { addStampsFromPendingLines(pending.lines); } catch { }

                try { closeBasket?.(); } catch { }
                try { basket?.clear?.(); } catch { }
                try { updateBasket?.(); } catch { }

                const total = Number(pending?.totals?.total || 0);
                const order = {
                    orderNumber: orderIdFromUrl,
                    lines: pending.lines,
                    total,
                    phase: "inProgress"
                };

                saveLastOrder(order);
                renderOrderBanner?.();
                openConfirmation(order);

                clearPendingCheckout();
            } catch (e) {
                console.error("[ZCREDIT] return handling failed:", e);
                alert(isRTL() ? "שגיאה בשמירת ההזמנה" : "Order save failed");
            } finally {
                cleanup();
                unlockCheckout("zcredit-return-finished");
            }
        }

        function cleanupZCreditQuery(urlObj) {
            ["result", "referenceNumber", "ref", "transactionId", "tx"].forEach(k => urlObj.searchParams.delete(k));
            history.replaceState({}, document.title, urlObj.toString());
        }



        function addStampsFromPendingLines(lines) {
            DBG_STAMP("addStampsFromPendingLines called with lines =", lines);

            let add = 0;

            for (const l of (lines || [])) {
                const qty = Number(l.qty || l.quantity || 0);
                if (qty <= 0) continue;

                // ✅ safest path: use persisted decision from checkout time
                if (l.earnsStamp === true) {
                    add += qty;
                    DBG_STAMP("✅ earning from persisted earnsStamp", qty, "stamp(s)", l.name);
                    continue;
                }

                // fallback for old snapshots
                const pid = Number(l.productId || l.id || 0);
                const item = l.item || (items || []).find(x => Number(x.id) === pid);
                if (!item) continue;

                const tags = Array.isArray(item?.tags) ? item.tags : [];
                const tagsNorm = tags.map(t => String(t || "").trim().toLowerCase());
                const earnTag = String(getStampEarnTag() || "").trim().toLowerCase();

                const earns =
                    (earnTag && tagsNorm.includes(earnTag)) ||
                    tagsNorm.includes("stamp") ||
                    isCoffeeStampName(item?.name || l?.name || "");

                if (earns) {
                    add += qty;
                    DBG_STAMP("✅ earning fallback", qty, "stamp(s)", item?.name || l?.name);
                }
            }

            DBG_STAMP("total stamps to add =", add);

            if (add <= 0) return;

            let profile = loadMemberProfile();

            if (!profile) {
                profile = {
                    miniAppId: Number(localStorage.getItem("miniAppId") || 12) || 12,
                    campaignId: "auto_stamp",
                    name: "",
                    email: "",
                    anonId: ensureAnonUUID(),
                    createdAt: Date.now() / 1000,
                    wallet: {
                        stamps: 0,
                        redeems: 0,
                        birthdayVoucherRedeemedYear: 0
                    },
                    stamps: 0,
                    marketingOptIn: false
                };

                setCookie("isMember", "1");
            }

            const current = getStamps(profile);
            const next = Math.min(10, current + add);

            DBG_STAMP("updating stamps", { current, add, next });

            setStamps(profile, next);
            saveMemberProfile(profile);

            updateCoffeeHeaderIcon();
            renderMemberCard();
        }

        function getStampEarnTag() {
            const lo = getMiniLoyalty();
            const t = String(lo?.stamps?.earnTag || "").trim();
            return t || ""; // e.g. "stamp_beigel"
        }
        function itemHasEarnTag(item, earnTag) {
            const tags = Array.isArray(item?.tags) ? item.tags : [];
            const hit = tags.some(t => String(t || "").toLowerCase() === earnTag.toLowerCase());

            DBG_STAMP(
                "check item",
                { id: item?.id, name: item?.name, tags },
                "against earnTag =", earnTag,
                "=>", hit
            );

            return hit;
        }

        function getMiniLoyalty() {
            try {
                const raw = localStorage.getItem("miniLoyalty") || "";
                const j = raw ? JSON.parse(raw) : null;
                return (j && typeof j === "object") ? j : null;
            } catch {
                return null;
            }
        }

        function esc(s) {
            return String(s || "")
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#039;");
        }

        // Build the benefits lines dynamically from loyalty
        function loyaltyBenefitsHTML(lo, rtl) {
            if (!lo) return "";

            const rows = [];

            // stamps (implicit: every 10 -> 11th free)
            if (lo.stamps?.label) {
                const label = esc(lo.stamps.label);
                rows.push(rtl
                    ? `☕️ על כל 10 ${label} – אחד עלינו`
                    : `☕️ Buy 10 ${label}, one on us`
                );
            }

            // happy hour
            if (lo.happyHour?.percent && lo.happyHour?.start && lo.happyHour?.end) {
                const p = Number(lo.happyHour.percent) || 0;
                const start = esc(lo.happyHour.start);
                const end = esc(lo.happyHour.end);
                rows.push(rtl
                    ? `🥐 ${p}% הנחה בין ${start}–${end}`
                    : `🥐 ${p}% off ${start}–${end}`
                );
            }

            // birthday
            if (lo.birthday?.percent && lo.birthday?.cap) {
                const p = Number(lo.birthday.percent) || 0;
                const cap = Number(lo.birthday.cap) || 0;
                rows.push(rtl
                    ? `🎁 ${p}% שובר יום הולדת`
                    : `🎁 ${p}% birthday voucher`
                );
            }

            return rows.map(t => `<div class="benefit">${t}</div>`).join("");
        }

        function renderMembersBody() {
            const host = document.getElementById("membersBody");
            if (!host) return;

            const rtl = (document.documentElement.dir === "rtl");
            const lo = getMiniLoyalty();

            // If no loyalty, show a small fallback (or you can hide the button)
            if (!lo) {
                host.innerHTML = `
              <div class="studentTitle">${rtl ? "מועדון חברים" : "Members club"}</div>
              <div class="membersBenefits">
                <div class="benefit">${rtl ? "אין הטבות זמינות כרגע" : "No benefits available right now"}</div>
              </div>
            `;
                return;
            }

            const title = esc(lo.title || (rtl ? "מועדון חברים" : "Members club"));
            const benefits = loyaltyBenefitsHTML(lo, rtl) || "";

            const showBirthday = !!(lo.birthday?.percent && lo.birthday?.cap);

            host.innerHTML = `
            <div class="studentTitle">${title}</div>

            ${benefits ? `
              <div class="membersBenefits">${benefits}</div>
            ` : ``}

            <div class="membersForm" dir="${rtl ? "rtl" : "ltr"}">
              <div class="uField">
                <input id="mName" class="uInput" type="text" autocomplete="name"
                       placeholder="${rtl ? "שם מלא" : "Full name"}">
                <div class="uLine"></div>
              </div>

              <div class="uField">
                <input id="mEmail" class="uInput" type="email" autocomplete="email" inputmode="email"
                       placeholder="${rtl ? "אימייל" : "Email"}">
                <div class="uLine"></div>
              </div>

              ${showBirthday ? `
                <div class="membersLabel">${rtl ? "יום הולדת" : "Birthday"}</div>

                <div class="membersRow">
                  <div class="uField" style="flex:1;">
                    <select id="mMonth" class="uSelect"></select>
                    <div class="uLine"></div>
                  </div>
                  <div class="uField" style="width:120px;">
                    <select id="mDay" class="uSelect"></select>
                    <div class="uLine"></div>
                  </div>
                </div>
              ` : ``}

              <button class="membersOpt" id="marketingOptInBtn" type="button" onclick="toggleMarketingOptIn()">
                <i id="mOptIcon" class="fa-regular fa-square"></i>
                <span>${rtl
                    ? "מאשר/ת לקבל עדכונים והטבות במייל"
                    : "I agree to receive updates and benefits by email"
                }</span>
              </button>

              <div id="membersErr" class="membersErr hidden"></div>
            </div>
          `;
        }
        function openMemberCard() {
            const loyalty = getMiniLoyalty();
            const hdr = document.querySelector("#memberModal .sheetTitle");
            if (hdr && loyalty?.title) hdr.textContent = loyalty.title;
            renderMemberCard();
            showSheet($("memberModal"));
        }
        function closeMemberCard() { hideSheet($("memberModal")); }

        function renderMemberCard() {
            // ✅ FORCE static title
            const titleEl = document.querySelector("#memberModal .sheetTitle");
            if (titleEl) titleEl.textContent = "כרטיסיה";

            const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
            const filled = dark ? "#ffffff" : "#111111";
            const empty = dark ? "rgba(255,255,255,0.45)" : "rgba(17,17,17,0.28)";

            const profile = loadMemberProfile();
            const stamps = Math.max(0, Math.min(10, Number(profile?.wallet?.stamps ?? profile?.stamps ?? 0) || 0));

            // ✅ Read stamp icon URLs from loyalty if present
            const lo = (typeof getMiniLoyalty === "function") ? getMiniLoyalty() : null;
            const iconLight = (lo?.stamps?.icon?.light || "").trim();
            const iconDark = (lo?.stamps?.icon?.dark || "").trim();
            const iconUrl = dark ? (iconDark || iconLight) : (iconLight || iconDark);

            // ✅ render one stamp cell (image if we have one, else FA coffee)
            function stampCell(color) {
                if (iconUrl) {
                    // color comes from the cell background; image is already black/white so no tint needed
                    const op = (color === filled) ? "1" : "0.35"; // filled vs empty
                    return `
                <div class="stampCell">
                  <img src="${iconUrl}" alt="" style="width:26px;height:26px;opacity:${op};">
                </div>`;
                }

                // fallback: coffee icon
                return `
              <div class="stampCell">
                <i class="fa-solid fa-mug-saucer stampIcon" style="color:${color} !important;"></i>
              </div>`;
            }

            let cells = "";
            for (let i = 0; i < 10; i++) {
                const isEarned = i < stamps;
                const color = isEarned ? filled : empty;
                cells += stampCell(color);
            }

            const ready = stamps >= 10;
            const btnText = isRTL() ? "ממש קפה חינם" : "Redeem free coffee";

            $("memberBody").innerHTML = `
            <div class="stampGrid">${cells}</div>
            <div class="memberCount">${stamps}/10</div>

          `;
        }

        function applyStampHeaderIconFromLoyalty() {
            const btn = document.querySelector(".headerIcon.left");
            if (!btn) return;

            const iEl = btn.querySelector("i");
            const rtl = document.documentElement.dir === "rtl";
            const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

            // read loyalty
            let lo = null;
            try {
                const raw = localStorage.getItem("miniLoyalty") || "";
                lo = raw ? JSON.parse(raw) : null;
            } catch { lo = null; }

            const iconLight = (lo?.stamps?.icon?.light || "").trim();
            const iconDark = (lo?.stamps?.icon?.dark || "").trim();
            const iconUrl = dark ? (iconDark || iconLight) : (iconLight || iconDark);

            // ✅ If no custom icon -> ensure FA coffee is shown
            if (!iconUrl) {
                // remove any previous img
                btn.querySelector("img.stampHeaderImg")?.remove();

                // ensure FA element exists
                if (!iEl) {
                    const ni = document.createElement("i");
                    ni.className = "fa-solid fa-mug-saucer";
                    ni.style.fontSize = "20px";
                    btn.appendChild(ni);
                } else {
                    iEl.className = "fa-solid fa-mug-saucer";
                    iEl.style.fontSize = "20px";
                    iEl.style.display = "";
                }
                return;
            }

            // ✅ If we have a custom icon -> show <img> and hide FA <i>
            if (iEl) iEl.style.display = "none";

            let img = btn.querySelector("img.stampHeaderImg");
            if (!img) {
                img = document.createElement("img");
                img.className = "stampHeaderImg";
                img.alt = "";
                img.style.width = "22px";
                img.style.height = "22px";
                img.style.display = "block";
                btn.appendChild(img);
            }

            img.src = iconUrl;
        }

        function DBG_STAMP(...args) {
            console.log("🟣 STAMPS:", ...args);
        }

        function memberStampsNow() {
            const p = loadMemberProfile();
            const stamps = Number(p?.wallet?.stamps ?? p?.stamps ?? 0) || 0;
            DBG_STAMP("memberStampsNow =", stamps, "profile =", p);
            return stamps;
        }

        function coffeeLineIdsInBasket() {
            const ids = [];
            for (const [id, line] of basket.entries()) {
                const name = line?.item?.name || "";
                if (isCoffeeStampName(name)) ids.push(Number(id));
            }
            return ids;
        }

        function clearFreeCoffeeIfNeeded() {
            if (!freeCoffee.lineId) return;
            if (!basket.has(freeCoffee.lineId)) { freeCoffee = { lineId: 0, units: 0 }; return; }

            const line = basket.get(freeCoffee.lineId);
            const qty = Number(line?.qty || 0);
            if (qty <= 0) { freeCoffee = { lineId: 0, units: 0 }; return; }

            freeCoffee.units = Math.min(Number(freeCoffee.units || 0), qty);
            if (freeCoffee.units <= 0) freeCoffee = { lineId: 0, units: 0 };
        }

        function canRedeemFreeCoffee() {
            if (!isMember()) return false;
            if (memberStampsNow() < 9) return false;
            if (freeCoffee.lineId) return false;
            return coffeeLineIdsInBasket().length > 0;
        }

        function redeemFreeCoffee() {
            if (!canRedeemFreeCoffee()) return;

            const ids = coffeeLineIdsInBasket();
            const id = ids[0];
            const line = basket.get(id);
            const qty = Number(line?.qty || 0);
            if (!qty) return;

            freeCoffee = { lineId: id, units: 1 };

            const profile = loadMemberProfile();
            if (profile) {
                profile.wallet = profile.wallet || {};
                profile.wallet.stamps = 0;
                profile.stamps = 0;
                saveMemberProfile(profile);
            }

            updateCoffeeHeaderIcon();
            renderMemberCard();

            try { navigator.vibrate?.(20); } catch { }

            updateBasket();
            openBasket();
        }

        function getShareUrl() { return location.href; }

        function isInFinder(r, c, n) {
            return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
        }

        function drawHybridQR(text, canvas, { dotScale = 0.78, logoKnockoutFraction = 0.22, overlayLabel = "MINI" } = {}) {
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            if (!ctx || typeof qrcode !== "function") return;

            const cssSize = Math.min(canvas.clientWidth || 260, canvas.clientHeight || 260);
            const dpr = window.devicePixelRatio || 1;

            canvas.width = Math.round(cssSize * dpr);
            canvas.height = Math.round(cssSize * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const qr = qrcode(0, "H");
            qr.addData(text);
            qr.make();

            const count = qr.getModuleCount();
            const quiet = 4;
            const total = count + quiet * 2;
            const cell = cssSize / total;

            const knockout = cssSize * logoKnockoutFraction;
            const kx = (cssSize - knockout) / 2;
            const ky = (cssSize - knockout) / 2;

            const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
            const bgColor = dark ? "#000" : "#fff";
            const inkColor = dark ? "#fff" : "#000";

            ctx.clearRect(0, 0, cssSize, cssSize);
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, cssSize, cssSize);
            ctx.fillStyle = inkColor;

            for (let r = 0; r < count; r++) {
                for (let c = 0; c < count; c++) {
                    if (!qr.isDark(r, c)) continue;

                    const x = (c + quiet) * cell;
                    const y = (r + quiet) * cell;
                    const cx = x + cell / 2;
                    const cy = y + cell / 2;

                    if (cx > kx && cx < kx + knockout && cy > ky && cy < ky + knockout) continue;

                    if (isInFinder(r, c, count)) {
                        ctx.fillRect(x, y, cell, cell);
                    } else {
                        ctx.beginPath();
                        ctx.arc(cx, cy, (cell * dotScale) / 2, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }

            if (overlayLabel) {
                ctx.fillStyle = inkColor;
                ctx.font = `${cssSize * 0.10}px system-ui`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(overlayLabel, cssSize / 2, cssSize / 2);
            }
        }

        function openShareSheet() {
            const url = getShareUrl();
            $("shareTitle").textContent = "Share Mini";
            const overlay = (Number(localStorage.getItem("miniAppId") || 12) === 3) ? "BB" : "MINI";
            drawHybridQR(url, $("qrCanvas"), { dotScale: 0.78, logoKnockoutFraction: 0.22, overlayLabel: overlay });
            $("shareToast").classList.add("hidden");
            showSheet($("shareModal"));
        }

        function closeShareSheet() { hideSheet($("shareModal")); }

        async function shareLink() {
            const title = $("shopTitle")?.textContent?.trim() || "Menu";
            const text = $("shopSubtitle")?.textContent?.trim() || "";
            const url = getShareUrl();

            if (navigator.share) {
                try { await navigator.share({ title, text, url }); } catch { }
                return;
            }

            const body = encodeURIComponent(`${title}\n${url}`);
            window.location.href = `sms:&body=${body}`;
        }

        async function copyLink() {
            const url = getShareUrl();
            try {
                await navigator.clipboard.writeText(url);
            } catch {
                const ta = document.createElement("textarea");
                ta.value = url;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                ta.remove();
            }

            $("shareToast").classList.remove("hidden");
            clearTimeout(window.__shareToastTimer);
            window.__shareToastTimer = setTimeout(() => $("shareToast").classList.add("hidden"), 1200);
        }

        function renderBirthdayBanner() {
            const host = document.getElementById("birthdayBannerHost");
            if (!host) return;

            if (!canApplyBirthdayVoucher(calcBasketSubtotal())) {
                host.innerHTML = "";
                return;
            }

            host.innerHTML = `
                                    <button class="orderBannerBtn" type="button" onclick="openBasketAndHighlightBirthdayVoucher()">
                                      <i class="fa-solid fa-gift orderBannerIcon" style="color:#d97706;"></i>
                                      <div class="orderBannerText">
                                        <div class="orderBannerTitle">🎉 שובר יום הולדת זמין</div>
                                        <div class="orderBannerSub">50% עד ₪200 — לחץ למימוש בסל</div>
                                      </div>
                                      <i class="fa-solid fa-chevron-right orderBannerChevron"></i>
                                    </button>
                                  `;
        }

        function openBasketAndHighlightBirthdayVoucher() {
            openBasket();
            setTimeout(() => {
                const btn = document.getElementById("birthdayVoucherBtn");
                if (!btn) return;
                btn.scrollIntoView({ behavior: "smooth", block: "center" });
                btn.style.transform = "scale(1.02)";
                btn.style.transition = "transform .18s ease";
                setTimeout(() => { btn.style.transform = ""; }, 350);
            }, 120);
        }

        function renderOrderBanner() {
            const host = $("orderBannerHost");
            if (!host) return;

            const order = loadLastOrder();
            if (!order?.orderNumber) {
                host.innerHTML = "";
                return;
            }

            const rtl = document.documentElement.dir === "rtl";
            const isReady = (order.phase || "inProgress") === "ready";

            const title = rtl
                ? "ההזמנה שלך על האש"
                : (isReady ? "Your order is ready" : "Your order is being prepared");

            const sub = rtl
                ? `הזמנה #${order.orderNumber}`
                : `Order #${order.orderNumber}`;

            const icon = isReady ? "fa-circle-check" : "fa-fire";
            const iconColor = isReady ? "color:#16a34a;" : "color:#f59e0b;";

            host.innerHTML = `
                        <button class="orderBannerBtn" type="button" onclick="openLastOrder()">
                            <i class="fa-solid ${icon} orderBannerIcon" style="${iconColor}"></i>
                            <div class="orderBannerText">
                                <div class="orderBannerTitle">${title}</div>
                                <div class="orderBannerSub">${sub}</div>
                            </div>
                            <i class="fa-solid fa-chevron-right orderBannerChevron"></i>
                        </button>
                    `;
        }

        function openLastOrder() {
            const order = loadLastOrder();
            if (order) openConfirmation(order);
        }

        function getServiceIntent() {
            const v = (localStorage.getItem("checkout.intent") || "ta").toLowerCase();
            return v === "sit" ? "sit" : "ta";
        }

        function setServiceIntent(val) {
            const intent = (val === "sit") ? "sit" : "ta";
            localStorage.setItem("checkout.intent", intent);
            localStorage.setItem("serviceModeLabel", intent === "sit" ? "לשבת" : "לקחת");
            renderServiceSegment();
        }

        function renderServiceSegment() {
            const ind = $("serviceIndicator");
            const sit = $("segSit");
            const ta = $("segTa");
            if (!ind || !sit || !ta) return;

            const intent = getServiceIntent(); // "sit" | "ta"
            const rtl = document.documentElement.dir === "rtl";

            sit.textContent = rtl ? "לשבת" : "Dine-in";
            ta.textContent = rtl ? "לקחת" : "Takeaway";

            // active classes
            sit.classList.toggle("active", intent === "sit");
            ta.classList.toggle("active", intent === "ta");

            // ✅ Indicator position:
            // LTR: sit=left, ta=right
            // RTL: sit=right, ta=left
            const leftPos = rtl
                ? (intent === "sit" ? "calc(50% + 3px)" : "3px")
                : (intent === "sit" ? "3px" : "calc(50% + 3px)");

            ind.style.left = leftPos;
        }

        // small helper (you already have isRTL)
        function rtl() { return document.documentElement.dir === "rtl"; }

        (function wireServiceSegment() {
            const sit = $("segSit");
            const ta = $("segTa");
            const seg = $("serviceSeg");
            if (!sit || !ta || !seg) return;

            sit.addEventListener("click", () => setServiceIntent("sit"));
            ta.addEventListener("click", () => setServiceIntent("ta"));

            renderServiceSegment();
        })();

        function setCookie(name, value, days = 180) {
            const expires = new Date(Date.now() + days * 864e5).toUTCString();
            const secure = location.protocol === "https:" ? "; Secure" : "";
            document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Expires=${expires}; Path=/; SameSite=Lax${secure}`;
        }

        function getCookie(name) {
            const key = encodeURIComponent(name) + "=";
            return document.cookie.split("; ").reduce((out, part) => {
                if (part.startsWith(key)) out = decodeURIComponent(part.slice(key.length));
                return out;
            }, "");
        }

        function digitsOnly(s) { return String(s || "").replace(/\D+/g, ""); }
        function isValidUkMobile(raw) { const d = digitsOnly(raw); return d.startsWith("07") && d.length === 11; }
        function normalizedUkPhone(raw) { if (!isValidUkMobile(raw)) return ""; const d = digitsOnly(raw); return "+44" + d.slice(1); }

        const DETAILS_NAME_KEY = "userName";
        const DETAILS_PHONE_KEY = "userPhone";

        let __pendingCheckoutAfterDetails = false;

        function openDetailsSheet() {
            const modal = $("detailsModal");
            if (!modal) return;

            const nameEl = $("detailsName");
            const phoneEl = $("detailsPhone");

            const savedName = getCookie(DETAILS_NAME_KEY) || "";
            const savedPhone = getCookie(DETAILS_PHONE_KEY) || "";

            if (nameEl) nameEl.value = savedName;
            if (phoneEl) phoneEl.value = savedPhone;

            updateDetailsContinueState();
            showSheet(modal);
            setTimeout(() => { nameEl?.focus?.(); }, 180);
        }

        function closeDetailsSheet() {
            hideSheet($("detailsModal"));
            __pendingCheckoutAfterDetails = false;
        }
        function digitsOnly(s) {
            return String(s || "").replace(/\D+/g, "");
        }

        function isValidPhone(raw) {
            const d = digitsOnly(raw);
            const rtl = document.documentElement.dir === "rtl";

            if (rtl) {
                // 🇮🇱 Israel: minimum 10 digits
                return d.length >= 10;
            }

            // 🇬🇧 UK (LTR): exactly 11 digits, starts with 07
            return d.length === 11 && d.startsWith("07");
        }

        function normalizedPhone(raw) {
            return digitsOnly(raw); // store digits only
        }

        function updateDetailsContinueState() {
            const btn = $("detailsContinueBtn");
            const nameEl = $("detailsName");
            const phoneEl = $("detailsPhone");

            const name = (nameEl?.value || "").trim();
            const phoneRaw = (phoneEl?.value || "").trim();

            const ok = name.length > 0 && isValidPhone(phoneRaw);
            btn?.classList.toggle("disabled", !ok);
        }

        function saveDetailsAndContinue() {
            const nameEl = $("detailsName");
            const phoneEl = $("detailsPhone");

            const name = (nameEl?.value || "").trim();
            if (!name) return;

            const phone = normalizedPhone(phoneEl?.value || "");
            if (!isValidPhone(phone)) return;

            setCookie("userName", name);
            setCookie("userPhone", phone); // digits only

            closeDetailsSheet();

            if (__pendingGPayTotal > 0) {
                const t = __pendingGPayTotal;
                __pendingGPayTotal = 0;

                const miniAppId = resolveMiniAppIdForSubmit();
                if (miniAppId === 3) beginStripeGooglePay(t);
                else startZCreditHostedCheckout(t);

                return;
            }

            if (__pendingCheckoutAfterDetails) {
                __pendingCheckoutAfterDetails = false;
                confirmOrder();
            }
        }

        document.addEventListener("input", (e) => {
            const id = e.target?.id || "";
            if (id === "detailsName" || id === "detailsPhone") updateDetailsContinueState();
            if (id === "mName" || id === "mEmail") updateMembersContinueState();
        });

        let __pendingGPayTotal = 0;

        function beginGPayCheckout(total) {
            const name = (getCookie("userName") || "").trim();
            const phone = (getCookie("userPhone") || "").trim();

            if (!name || !phone) {
                __pendingCheckoutAfterDetails = false; // avoid confirmOrder path
                __pendingGPayTotal = Number(total || 0);
                openDetailsSheet();
                return;
            }

            startZCreditHostedCheckout(total);
        }

        function isMember() {
            try {
                const raw = localStorage.getItem("memberProfileLocal") || "";
                if (!raw) return false;

                const p = JSON.parse(raw);

                return (
                    String(p?.email || "").trim().length > 3 &&
                    String(p?.name || "").trim().length > 1
                );
            } catch {
                return false;
            }
        }

        function openMembersGate() {
            if (isMember()) openMemberCard();
            else openMembersClub();
        }

        function nameClean() { return (document.getElementById("mName")?.value || "").trim(); }
        function emailClean() { return (document.getElementById("mEmail")?.value || "").trim().toLowerCase(); }

        function toggleMarketingOptIn() {
            marketingOptIn = !marketingOptIn;
            const icon = document.getElementById("mOptIcon");
            if (icon) icon.className = marketingOptIn ? "fa-solid fa-square-check" : "fa-regular fa-square";
            try { navigator.vibrate?.(10); } catch { }
            updateMembersContinueState();
        }

        function updateMembersContinueState() {
            const btn = document.getElementById("membersJoinBtn");
            if (!btn) return;

            const okCore = membersCanContinue();          // ✅ now includes birthday
            const can = marketingOptIn && okCore;

            btn.disabled = !can;
            btn.style.opacity = can ? "1" : "0.45";
        }

        document.addEventListener("change", (e) => {
            const id = e.target?.id || "";
            if (id === "mMonth" || id === "mDay") updateMembersContinueState();
        });
        function openMembersClub() {
            renderMembersBody();
            const icon = document.getElementById("mOptIcon");
            if (icon) icon.className = "fa-regular fa-square";

            const name = (getCookie("userName") || "").trim();
            const email = (getCookie("userEmail") || "").trim();

            const mName = document.getElementById("mName");
            const mEmail = document.getElementById("mEmail");
            if (mName) mName.value = name;
            if (mEmail) mEmail.value = email;

            marketingOptIn = false;
            updateMembersContinueState();

            buildMembersBirthdayPickers();
            setMembersError("");
            showSheet(document.getElementById("membersModal"));
            setTimeout(() => { try { mName?.focus?.(); } catch { } }, 180);
        }

        function closeMembersClub() { hideSheet(document.getElementById("membersModal")); }

        function buildMembersBirthdayPickers() {
            const mMonth = document.getElementById("mMonth");
            const mDay = document.getElementById("mDay");
            if (!mMonth || !mDay) return;

            const rtl = document.documentElement.dir === "rtl";

            const heMonths = [
                "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
                "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
            ];

            // Month
            mMonth.innerHTML = "";
            const monthPlaceholder = document.createElement("option");
            monthPlaceholder.value = "";
            monthPlaceholder.textContent = rtl ? "חודש" : "Month";
            monthPlaceholder.disabled = true;
            monthPlaceholder.selected = true;
            mMonth.appendChild(monthPlaceholder);

            for (let i = 1; i <= 12; i++) {
                const opt = document.createElement("option");
                opt.value = String(i);
                opt.textContent = rtl ? heMonths[i - 1] : heMonths[i - 1];
                mMonth.appendChild(opt);
            }

            // Day
            mDay.innerHTML = "";
            const dayPlaceholder = document.createElement("option");
            dayPlaceholder.value = "";
            dayPlaceholder.textContent = rtl ? "יום" : "Day";
            dayPlaceholder.disabled = true;
            dayPlaceholder.selected = true;
            mDay.appendChild(dayPlaceholder);

            for (let d = 1; d <= 31; d++) {
                const opt = document.createElement("option");
                opt.value = String(d);
                opt.textContent = String(d);
                mDay.appendChild(opt);
            }

            // ✅ ensure button state is correct on open
            updateMembersContinueState();
        }

        function setMembersError(msg) {
            const el = document.getElementById("membersErr");
            if (!el) return;
            if (!msg) { el.classList.add("hidden"); el.textContent = ""; }
            else { el.classList.remove("hidden"); el.textContent = msg; }
        }

        function membersCanContinue() {
            const name = (document.getElementById("mName")?.value || "").trim();
            const email = (document.getElementById("mEmail")?.value || "").trim().toLowerCase();

            const mMonth = document.getElementById("mMonth");
            const mDay = document.getElementById("mDay");

            // יום הולדת נדרש רק אם השדות קיימים וגם מוצגים בפועל
            const birthdayRequired =
                !!mMonth && !!mDay &&
                mMonth.offsetParent !== null && mDay.offsetParent !== null;

            let birthdayOK = true;
            if (birthdayRequired) {
                const birthMonth = Number(mMonth.value || 0);
                const birthDay = Number(mDay.value || 0);
                birthdayOK = birthMonth >= 1 && birthMonth <= 12 && birthDay >= 1 && birthDay <= 31;
            }

            const emailOK = email.includes("@") && email.includes(".");
            const nameOK = name.length >= 2;

            return nameOK && emailOK && birthdayOK;
        }

        function ensureAnonUUID() {
            let anon = "";
            try { anon = (localStorage.getItem("anonUUID") || "").trim(); } catch { }
            if (!anon) {
                anon = (crypto?.randomUUID?.() || ("anon-" + Date.now() + "-" + Math.random().toString(16).slice(2)));
                try { localStorage.setItem("anonUUID", anon); } catch { }
            }
            return anon;
        }

        function persistMemberJoinLocal({ miniAppId, campaignId, stampEarnedNow, name, email, birthMonth, birthDay, marketingOptIn }) {
            const mm = String(birthMonth).padStart(2, "0");
            const dd = String(birthDay).padStart(2, "0");
            const birthdayMMDD = `${mm}-${dd}`;

            const anonId = ensureAnonUUID();
            const stamps = Math.max(1, Math.min(10, Number(stampEarnedNow || 1)));

            const profile = {
                miniAppId: Number(miniAppId || 0),
                campaignId: String(campaignId || "student"),
                name: String(name || ""),
                email: String(email || ""),
                birthdayMMDD,
                birthMonth: Number(birthMonth || 1),
                birthDay: Number(birthDay || 1),
                anonId,
                createdAt: Date.now() / 1000,
                wallet: { stamps, redeems: 0, birthdayVoucherRedeemedYear: 0 },
                stamps,
                marketingOptIn: !!marketingOptIn,
                ...(marketingOptIn ? { marketingConsentAt: Math.floor(Date.now() / 1000), marketingConsentSource: "members_join_web" } : {})
            };

            try { localStorage.setItem("memberProfileLocal", JSON.stringify(profile)); } catch { }
            try { localStorage.setItem("pendingMemberJoin", JSON.stringify(profile)); } catch { }

            setCookie("isMember", "1");
            setCookie("userName", String(name || ""));
            setCookie("userEmail", String(email || ""));
            setCookie("userBirthMonth", String(birthMonth));
            setCookie("userBirthDay", String(birthDay));

            try { localStorage.setItem("members.updatedAt", String(Date.now())); } catch { }
        }

        function isHappyHourNow() {
            const h = new Date().getHours();
            return h >= 16 && h < 17;
        }

        function normName(s) {
            return String(s || "").trim().toLowerCase().replace(/\s+/g, "");
        }

        function happyHourEligibleLineIds() {
            if (!isMember()) return new Set();
            if (!isHappyHourNow()) return new Set();

            const eligible = new Set();
            for (const [lineId, line] of basket.entries()) {
                const cat = normName(line.item?.category);
                const name = normName(line.item?.name);

                const inCat =
                    cat.includes("beigels") ||
                    cat.includes("כריכים") ||
                    cat.includes("bakery") ||
                    cat.includes("sandwich");

                if (!inCat) continue;
                if (name.includes("טוסט") || name.includes("toast")) continue;

                eligible.add(Number(lineId));
            }
            return eligible;
        }

        function calcHappyHourDiscount() {
            const eligibleIds = happyHourEligibleLineIds();
            if (!eligibleIds.size) return 0;

            let discount = 0;
            for (const id of eligibleIds) {
                const line = basket.get(id);
                if (!line) continue;
                discount += (Number(line.qty || 0) * Number(line.price || 0)) * 0.30;
            }
            return discount;
        }

        function identifyMemberByEmailFireAndForget(payload) {
            try {
                fetch("https://minis.studio/api/identity/members/join", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                }).catch(() => { });
            } catch { }
        }

        function submitMembersClub() {
            const btn = document.getElementById("membersJoinBtn");
            if (btn && btn.dataset.busy === "1") return;

            const name = (document.getElementById("mName")?.value || "").trim();
            const email = (document.getElementById("mEmail")?.value || "").trim().toLowerCase();
            const birthMonth = Number(document.getElementById("mMonth")?.value || 1);
            const birthDay = Number(document.getElementById("mDay")?.value || 1);

            if (!marketingOptIn) { setMembersError("יש לאשר קבלת עדכונים במייל כדי להמשיך"); return; }
            if (!membersCanContinue()) { setMembersError("נא להזין שם ואימייל תקינים"); return; }

            setMembersError("");

            if (btn) { btn.dataset.busy = "1"; btn.style.opacity = "0.75"; }

            const miniId = Number(localStorage.getItem("miniAppId") || 12) || 12;
            const campaignId = "members";
            const stampEarnedNow = 1;
            const anonId = ensureAnonUUID();

            persistMemberJoinLocal({
                miniAppId: miniId,
                campaignId,
                stampEarnedNow,
                name,
                email,
                birthMonth,
                birthDay,
                marketingOptIn
            });

            closeMembersClub();

            identifyMemberByEmailFireAndForget({
                miniAppId: miniId,
                campaign: campaignId,
                stampEarnedNow,
                anonId,
                platform: "web",
                appVariant: "pwa",
                email,
                name,
                birthdayMMDD: String(birthMonth).padStart(2, "0") + "-" + String(birthDay).padStart(2, "0"),
                birthMonth,
                birthDay,
                marketingOptIn,
                ...(marketingOptIn ? { marketingConsentAt: Math.floor(Date.now() / 1000), marketingConsentSource: "members_join_web" } : {})
            });

            if (btn) {
                setTimeout(() => { btn.dataset.busy = "0"; btn.style.opacity = ""; }, 400);
            }
        }

        function nowLocalYear() { return new Date().getFullYear(); }

        function getMemberBirthdayMonth(profile) {
            const bm = Number(profile?.birthMonth || 0);
            if (bm >= 1 && bm <= 12) return bm;
            const mmdd = String(profile?.birthdayMMDD || "").trim();
            const mm = Number(mmdd.split("-")[0] || 0);
            return (mm >= 1 && mm <= 12) ? mm : 0;
        }

        function isBirthdayMonthNow() {
            if (!isMember()) return false;
            const profile = loadMemberProfile();
            if (!profile) return false;
            const m = getMemberBirthdayMonth(profile);
            if (!m) return false;
            return (new Date().getMonth() + 1) === m;
        }

        function birthdayVoucherRedeemedThisYear() {
            const profile = loadMemberProfile();
            if (!profile) return false;
            return Number(profile?.wallet?.birthdayVoucherRedeemedYear || 0) === nowLocalYear();
        }

        function calcBirthdayDiscount(subtotalVal) {
            const eligibleBase = Math.min(Math.max(Number(subtotalVal || 0), 0), 200);
            return eligibleBase * 0.5;
        }

        function canApplyBirthdayVoucher(subtotalOverride) {
            const subtotal = (typeof subtotalOverride === "number") ? subtotalOverride : calcBasketSubtotal();
            if (!isMember()) return false;
            if (!isBirthdayMonthNow()) return false;
            if (birthdayVoucherApplied) return false;
            if (birthdayVoucherRedeemedThisYear()) return false;
            return subtotal > 0.01;
        }

        function applyBirthdayVoucher() {
            if (!canApplyBirthdayVoucher()) return;

            birthdayVoucherApplied = true;

            const profile = loadMemberProfile();
            if (profile) {
                profile.wallet = profile.wallet || {};
                profile.wallet.birthdayVoucherRedeemedYear = nowLocalYear();
                try { localStorage.setItem("memberProfileLocal", JSON.stringify(profile)); } catch { }
            }

            updateBasket();
            openBasket();
            renderBirthdayBanner();
        }

        function isInFinderGuard() {
            document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
            document.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false });
            document.addEventListener("gestureend", (e) => e.preventDefault(), { passive: false });
            window.addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

            let __lastTouchEnd = 0;
            document.addEventListener("touchend", (e) => {
                const now = Date.now();
                if (now - __lastTouchEnd <= 300) e.preventDefault();
                __lastTouchEnd = now;
            }, { passive: false });

            document.addEventListener("touchstart", (e) => {
                if (e.touches && e.touches.length > 1) e.preventDefault();
            }, { passive: false });
        }
        isInFinderGuard();


        // SwiftUI raw values: cafeteria / scienceBuilding


        function applyHebrewUI() {
            const rtl = ((localStorage.getItem("direction") || "ltr").toLowerCase() === "rtl");
            const miniId = Number(localStorage.getItem("miniAppId") || 0);

            // ===== Header =====
            const t = document.getElementById("shopTitle");
            const s = document.getElementById("shopSubtitle");

            // ✅ mini 13 override
            if (miniId === 13) {
                if (t) t.textContent = "Vitamin";
                if (s) s.textContent = "Simply good";
            } else {
                if (t) t.textContent = rtl ? "תפריט בוקר" : (localStorage.getItem("miniTitle") || t.textContent || "");
                if (s) s.textContent = rtl ? "הזמן בטלפון ונודיע כשמוכן" : (localStorage.getItem("miniSubtitle") || s.textContent || "");
            }

            // ===== Service buttons =====
            // ✅ IMPORTANT: DO NOT override the segment labels for mini 13
            if (miniId !== 13) {
                const sit = document.getElementById("segSit");
                const ta = document.getElementById("segTa");
                if (sit) sit.textContent = rtl ? "לשבת" : "Dine-in";
                if (ta) ta.textContent = rtl ? "לקחת" : "Takeaway";
            }

            // Stop here if not RTL
            if (!rtl) {
                // still enforce correct segment state
                if (typeof renderServiceSegment === "function") renderServiceSegment();
                return;
            }

            /* =========================
               Confirmation view (RTL)
               ========================= */
            const confirmTitle = document.querySelector("#confirmView .confirmTitle");
            if (confirmTitle) confirmTitle.textContent = "אישור הזמנה";

            const h1 = document.querySelector("#confirmView .confirmH1");
            if (h1) h1.textContent = "תודה!";

            const h2 = document.querySelector("#confirmView .confirmH2");
            if (h2) h2.textContent = "מספר הזמנה";

            const h3 = document.querySelector("#confirmView .confirmH3");
            if (h3) h3.textContent = "איסוף שתיה ומוצרי ויטרינה - קריאה לפי שם";

            const detailsTitle = document.querySelector("#confirmView .confirmSectionTitle");
            if (detailsTitle) detailsTitle.textContent = "פרטי הזמנה";

            const totalLabel = document.querySelector("#confirmView .confirmTotalLabel");
            if (totalLabel) totalLabel.textContent = "סה״כ";

            // Remove £ in confirmation (RTL only)
            document
                .querySelectorAll("#confirmView .confirmLinePrice, #confirmView .confirmTotalVal")
                .forEach(el => { el.textContent = el.textContent.replace(/£/g, "").trim(); });

            /* =========================
               Details sheet (RTL)
               ========================= */
            const detailsSheetTitle = document.querySelector("#detailsModal .sheetTitle");
            if (detailsSheetTitle) detailsSheetTitle.textContent = "פרטי הזמנה";

            document.querySelectorAll("#detailsModal .detailsLabel").forEach(label => {
                const txt = (label.textContent || "").trim().toLowerCase();
                if (txt.includes("full")) label.textContent = "שם מלא";
                else if (txt.includes("phone")) label.textContent = "טלפון";
            });

            const nameInput = document.getElementById("detailsName");
            if (nameInput) nameInput.placeholder = "שם מלא";

            const phoneInput = document.getElementById("detailsPhone");
            if (phoneInput) phoneInput.placeholder = "מספר טלפון";

            const continueBtn = document.getElementById("detailsContinueBtn");
            if (continueBtn) continueBtn.textContent = "המשך";

            // ✅ enforce correct segment state LAST (prevents flicker)
            if (typeof renderServiceSegment === "function") renderServiceSegment();
        }

        renderCategoryBar();
        renderMyItemsStrip();
        renderMenu();
        rebuildSectionCache();
        syncPinnedBar();
        onScrollSelectCategory();
        renderOrderBanner();
        renderServiceSegment();

        if (!localStorage.getItem("didShowWelcome")) $("welcome")?.classList.remove("hidden");

        window.addEventListener("scroll", syncPinnedBar, { passive: true });
        window.addEventListener("scroll", onScrollSelectCategory, { passive: true });
        window.addEventListener("resize", () => { syncPinnedBar(); rebuildSectionCache(); onScrollSelectCategory(); });

        function enableSwipeToClose(modalId, onClose) {
            const modal = document.getElementById(modalId);
            if (!modal) return;

            const card = modal.querySelector(".cardModal");
            const body = modal.querySelector(".modalBody");
            if (!card || !body) return;

            let startY = 0, lastY = 0, startTime = 0;
            let dragging = false;

            function reset() {
                card.style.transition = "";
                card.style.transform = "";
                dragging = false;
            }

            function closeNow() { reset(); onClose(); }

            body.addEventListener("touchstart", (e) => {
                if (!modal.classList.contains("open")) return;
                if (!e.touches || e.touches.length !== 1) return;
                if (body.scrollTop > 0) return;

                startY = e.touches[0].clientY;
                lastY = startY;
                startTime = performance.now();
                dragging = true;
                card.style.transition = "none";
            }, { passive: true });

            body.addEventListener("touchmove", (e) => {
                if (!dragging) return;
                if (!e.touches || e.touches.length !== 1) return;

                lastY = e.touches[0].clientY;
                const dy = lastY - startY;
                if (dy <= 0) return;

                e.preventDefault();
                card.style.transform = `translateY(${dy}px)`;

                const backdrop = modal.querySelector(".backdrop");
                if (backdrop) backdrop.style.opacity = String(Math.max(0, 0.45 * (1 - dy / 260)));
            }, { passive: false });

            body.addEventListener("touchend", () => {
                if (!dragging) return;

                const dy = lastY - startY;
                const dt = Math.max(1, performance.now() - startTime);
                const velocity = dy / dt;
                const shouldClose = (dy > 140) || (velocity > 0.9);

                card.style.transition = "transform .28s cubic-bezier(.22,.9,.35,1)";

                if (shouldClose) {
                    card.style.transform = "translateY(110%)";
                    setTimeout(() => closeNow(), 220);
                } else {
                    reset();
                    const backdrop = modal.querySelector(".backdrop");
                    if (backdrop) backdrop.style.opacity = "";
                }
            }, { passive: true });

            body.addEventListener("touchcancel", () => {
                if (!dragging) return;
                reset();
                const backdrop = modal.querySelector(".backdrop");
                if (backdrop) backdrop.style.opacity = "";
            }, { passive: true });
        }

        enableSwipeToClose("productModal", closeProduct);
        enableSwipeToClose("basketModal", closeBasket);
        enableSwipeToClose("memberModal", closeMemberCard);
        enableSwipeToClose("membersModal", closeMembersClub);
        enableSwipeToClose("shareModal", closeShareSheet);
        enableSwipeToClose("detailsModal", closeDetailsSheet);

        function maybeShowStudentSheet() {
            const path = (location.pathname || "").toLowerCase();
            const params = new URLSearchParams(location.search);
            const isStudent = path.startsWith("/student") || params.get("student") === "1";
            if (!isStudent) return;

            const campaignId = params.get("camp") || "student";
            const discountPercent = Number(params.get("off") || 10) || 10;
            const durationMonths = Number(params.get("months") || 6) || 6;

            openStudentSheet({ campaignId, discountPercent, durationMonths });
        }

        function activateStudentDiscountNow({ campaignId, discountPercent, durationMonths }) {
            const now = Date.now();
            const monthsMs = 30 * 24 * 60 * 60 * 1000;
            const expiresAt = now + (Math.max(1, Number(durationMonths || 1)) * monthsMs);
            const disc = {
                campaignId: (campaignId && String(campaignId).trim()) ? String(campaignId).trim() : "student",
                percent: Number(discountPercent || 0) || 0,
                expiresAt
            };
            try { localStorage.setItem(ACTIVE_DISCOUNT_KEY, JSON.stringify(disc)); } catch { }
        }

        function openStudentSheet({ campaignId = "student", discountPercent = 10, durationMonths = 6 } = {}) {
            const sub = $("studentSubtitle");
            if (sub) sub.textContent = `הנחה של ${discountPercent}% להזמנות באפליקציה`;
            const modal = $("studentModal");
            if (modal) showSheet(modal);
            activateStudentDiscountNow({ campaignId, discountPercent, durationMonths });
        }

        function closeStudentSheet() {
            const modal = $("studentModal");
            if (modal) hideSheet(modal);
            try {
                const url = new URL(location.href);
                if ((url.pathname || "").toLowerCase().startsWith("/student")) url.pathname = "/";
                ["student", "miniAppId", "camp", "off", "months"].forEach((k) => url.searchParams.delete(k));
                history.replaceState({}, document.title, url.toString());
            } catch { }
        }

        updateCoffeeHeaderIcon();
        maybeShowStudentSheet();

        function enableInteractiveSwipeRightCloseConfirmation() {
            const view = document.getElementById("confirmView");
            if (!view) return;

            const EDGE_PX = 22;
            const REQUIRE_EDGE = true;

            const MIN_DX_CLOSE = 120;
            const MAX_DY = 70;
            const VELOCITY_CLOSE = 0.85;

            let startX = 0, startY = 0, lastX = 0, lastY = 0, startT = 0;
            let tracking = false, dragging = false;

            const isOpen = () => view.classList.contains("open");
            const isRTL = () => document.documentElement.dir === "rtl";

            function setDraggingUI(on) {
                if (on) {
                    view.style.transition = "none";
                    view.style.willChange = "transform";
                } else {
                    view.style.willChange = "";
                }
            }

            function setTranslate(dx) {
                const w = view.getBoundingClientRect().width || window.innerWidth || 390;

                // LTR: allow 0..+w (drag right)
                // RTL: allow -w..0 (drag left)
                const clamped = isRTL()
                    ? Math.min(0, Math.max(dx, -w))
                    : Math.max(0, Math.min(dx, w));

                view.style.transform = `translateX(${clamped}px)`;
            }

            function resetToOpen() {
                view.style.transition = "transform .28s cubic-bezier(.22,.9,.35,1)";
                view.style.transform = "translateX(0px)";
                setTimeout(() => { view.style.transition = ""; view.style.transform = ""; }, 300);
            }

            function animateCloseAndDismiss() {
                const w = view.getBoundingClientRect().width || window.innerWidth || 390;
                view.style.transition = "transform .22s cubic-bezier(.22,.9,.35,1)";
                view.style.transform = isRTL() ? `translateX(-${w}px)` : `translateX(${w}px)`;
                setTimeout(() => {
                    view.style.transition = "";
                    view.style.transform = "";
                    closeConfirmation();
                }, 220);
            }

            function edgeOK(x) {
                if (!REQUIRE_EDGE) return true;
                const w = view.getBoundingClientRect().width || window.innerWidth || 390;
                // LTR -> left edge. RTL -> right edge.
                return isRTL() ? (x >= (w - EDGE_PX)) : (x <= EDGE_PX);
            }

            function onStart(x, y) {
                if (!isOpen()) return;
                if (!edgeOK(x)) return;

                startX = lastX = x;
                startY = lastY = y;
                startT = performance.now();
                tracking = true;
                dragging = false;
            }

            function onMove(x, y, e) {
                if (!tracking || !isOpen()) return;

                lastX = x;
                lastY = y;

                const dx = lastX - startX;
                const dy = lastY - startY;

                // direction gating
                const movingCorrectDir = isRTL() ? (dx < 0) : (dx > 0);

                if (!dragging) {
                    if (!movingCorrectDir) return;
                    if (Math.abs(dx) < 8) return;
                    if (Math.abs(dy) > MAX_DY) { tracking = false; return; }
                    if (Math.abs(dx) < Math.abs(dy) * 1.2) return;

                    dragging = true;
                    setDraggingUI(true);
                }

                e?.preventDefault?.();
                setTranslate(dx);
            }

            function onEnd() {
                if (!tracking || !isOpen()) return;

                const dx = lastX - startX;
                const dy = lastY - startY;
                const dt = Math.max(1, performance.now() - startT);
                const vx = dx / dt;

                tracking = false;
                if (!dragging) return;

                dragging = false;
                setDraggingUI(false);

                const rtl = isRTL();

                const shouldClose = rtl
                    ? (dx < -MIN_DX_CLOSE || (vx < -VELOCITY_CLOSE && dx < -50))
                    : (dx > MIN_DX_CLOSE || (vx > VELOCITY_CLOSE && dx > 50));

                // IMPORTANT: remove dx>0 gate — it breaks RTL
                if (shouldClose && Math.abs(dy) < MAX_DY) animateCloseAndDismiss();
                else resetToOpen();
            }

            // Touch
            view.addEventListener("touchstart", (e) => {
                if (!e.touches || e.touches.length !== 1) return;
                const t = e.touches[0];
                onStart(t.clientX, t.clientY);
            }, { passive: true });

            view.addEventListener("touchmove", (e) => {
                if (!e.touches || e.touches.length !== 1) return;
                const t = e.touches[0];
                onMove(t.clientX, t.clientY, e);
            }, { passive: false });

            view.addEventListener("touchend", onEnd, { passive: true });
            view.addEventListener("touchcancel", onEnd, { passive: true });

            // Pointer (desktop / iPad trackpad)
            view.addEventListener("pointerdown", (e) => {
                if (e.pointerType === "mouse" && e.button !== 0) return;
                onStart(e.clientX, e.clientY);
            });

            view.addEventListener("pointermove", (e) => onMove(e.clientX, e.clientY, e), { passive: false });
            view.addEventListener("pointerup", onEnd);
            view.addEventListener("pointercancel", onEnd);
        }
        enableInteractiveSwipeRightCloseConfirmation();

        window.addEventListener("beforeinstallprompt", (e) => {
            e.preventDefault();
            window._installPrompt = e;
        });

        async function installPWA() {
            if (!window._installPrompt) return;
            window._installPrompt.prompt();
            await window._installPrompt.userChoice;
            window._installPrompt = null;
        }

        function cashRenderCategoryRail() {
            const host = document.getElementById("cashCats");
            if (!host) return;
            host.innerHTML = "";

            categories.forEach((cat, idx) => {
                const b = document.createElement("button");
                b.className = "cashCatBtn" + (idx === 0 ? " active" : "");
                b.textContent = cat;
                b.dataset.cat = cat;

                b.onclick = () => {
                    document.querySelectorAll(".cashCatBtn").forEach((x) => x.classList.toggle("active", x === b));
                    const el = document.getElementById(catId(cat));
                    el?.scrollIntoView({ behavior: "smooth", block: "start" });
                };

                host.appendChild(b);
            });
        }

        function t(en, he) {
            return document.documentElement.dir === "rtl" ? he : en;
        }

        function hasRealModifiers(item) {
            const groups = item?.modifiers;
            if (!Array.isArray(groups) || groups.length === 0) return false;

            // true only if there is at least one selectable pill
            return groups.some(g => Array.isArray(g?.items) && g.items.length > 0);
        }

        function cashpointAddItemInstant(item) {
            DBG("cashpointAddItemInstant()", { CASHPOINT, id: item?.id, name: item?.name, modifiersLen: item?.modifiers?.length });

            if (hasRealModifiers(item)) {
                openProduct(item);
                return;
            }

            const lineId = nextLineId++;
            basket.set(lineId, {
                lineId,
                item,
                qty: 1,
                price: Number(item.price || 0),
                image: item.image || "",
                modsText: ""
            });

            updateBasket();
        }

        function cashRenderMenu() {
            const menu = document.getElementById("cashMenu");
            if (!menu) return;

            menu.innerHTML = "";
            categories.forEach((cat) => {
                const sec = document.createElement("section");
                sec.className = "section";
                sec.id = catId(cat);
                sec.innerHTML = `<div class="sectionTitle">${cat}</div>`;

                const grid = document.createElement("div");
                grid.className = "grid";

                items.filter((i) => i.category === cat).forEach((item) => {
                    const qtyInBasket = [...basket.values()]
                        .filter((l) => l.item.id === item.id)
                        .reduce((s, l) => s + Number(l.qty || 0), 0);

                    const btn = document.createElement("button");
                    btn.className = "card";
                    btn.innerHTML = `
                                        <div class="cardImg">
                                          <img src="${item.image}">
                                          ${qtyInBasket ? `<div class="badge">${qtyInBasket}</div>` : ""}
                                        </div>
                                        <div class="cardName">${item.name}</div>
                                       <div class="cardPrice">${formatMoney(item.price)}</div>
                                      `;
                    btn.onclick = () => cashpointAddItemInstant(item);
                    grid.appendChild(btn);
                });

                sec.appendChild(grid);
                menu.appendChild(sec);
            });
        }

        function beginCheckoutCashpoint() {
            const subtotal = calcBasketSubtotal();
            OF.open({
                total: subtotal,
                cashpoint: 1,
                requiresPhone: 0,
                rtl: 1,
                currency: "₪"
            });
        }

        function cashRenderBasketPanel() {
            const body = document.getElementById("cashBasketBody");
            const bottom = document.getElementById("cashBasketBottom");
            if (!body || !bottom) return;

            body.innerHTML = "";

            for (const [key, line] of basket.entries()) {
                const lineId = Number(line.lineId ?? key);
                const qty = Number(line.qty || 0);
                const price = Number(line.price || 0);

                const mods = (line.modsText || "").trim();
                const subtitleHtml = mods ? `<div class="bSub">${mods}</div>` : "";

                const row = document.createElement("div");
                row.className = "bRow";
                row.innerHTML = `
                                      <img class="bThumb" src="${line.image || line.item?.image || ""}" alt="">
                                      <div class="bMeta">
                                        <div class="bName">${qty}× ${line.item.name}</div>
                                        ${subtitleHtml}
                                       <div class="bPrice">${(qty * price).toFixed(2)}</div>
                                      </div>
                                      <div class="bStepper">
                                        <button class="bStepBtn" data-act="minus" data-line="${lineId}" type="button">−</button>
                                        <div class="bQty">${qty}</div>
                                        <button class="bStepBtn" data-act="plus" data-line="${lineId}" type="button">+</button>
                                      </div>
                                    `;
                body.appendChild(row);
            }

            const subtotal = calcBasketSubtotal();
            const totalEl = document.getElementById("cashBasketTotal");
            if (totalEl) totalEl.textContent = money(subtotal);

            bottom.innerHTML = `
              <button class="btnCheckout" type="button" onclick="beginCheckoutCashpoint()">
                <div class="continueBtnRow">
                  <span class="continueBtnLabel">המשך לתשלום</span>
                  <span class="continueBtnTotal">${Number(subtotal || 0).toFixed(2)}</span>
                </div>
              </button>
`;

            body.querySelectorAll(".bStepBtn").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const act = btn.dataset.act;
                    const id = Number(btn.dataset.line);
                    const line = basket.get(id);
                    if (!line) return;

                    if (act === "plus") line.qty = Number(line.qty || 0) + 1;
                    else {
                        line.qty = Number(line.qty || 0) - 1;
                        if (line.qty <= 0) basket.delete(id);
                    }

                    updateBasket();
                    cashRenderBasketPanel();
                });
            });
        }

        const OF = (() => {
            const host = document.getElementById("ofHost");
            const frame = document.getElementById("ofFrame");

            function open({ total = 120, cashpoint = 1, requiresPhone = 1, rtl = 1, currency = "₪" } = {}) {
                const url = new URL("orderFlow.html", location.href);
                url.searchParams.set("total", String(total));
                url.searchParams.set("cashpoint", String(cashpoint));
                url.searchParams.set("requiresPhone", String(requiresPhone));
                url.searchParams.set("rtl", String(rtl));
                url.searchParams.set("currency", String(currency));

                if (frame) frame.src = url.toString();

                host?.classList.remove("hidden", "closing");
                host?.setAttribute("aria-hidden", "false");
                requestAnimationFrame(() => host?.classList.add("open"));
            }

            function close() {
                host?.classList.add("closing");
                host?.classList.remove("open");
                setTimeout(() => {
                    host?.classList.add("hidden");
                    host?.classList.remove("closing");
                    host?.setAttribute("aria-hidden", "true");
                }, 340);
            }

            function clearBasketAndUI() {
                try {
                    basket.clear();
                    nextLineId = 1; // optional: reset ids for next order
                    freeCoffee = { lineId: 0, units: 0 };
                    birthdayVoucherApplied = false;
                } catch { }

                // refresh UI
                updateBasket();

                if (CASHPOINT) {
                    cashRenderMenu();
                    cashRenderBasketPanel();
                }
            }

            // OF host listener
            window.addEventListener("message", (e) => {
                if (e.origin !== location.origin) return;

                if (e.data?.type === "ORDERFLOW_CLOSE") {
                    // ✅ clear basket when orderflow dismisses
                    clearBasketAndUI();

                    // ✅ then close iframe sheet host
                    close();
                }
            });

            return { open, close };
        })();

        if (CASHPOINT) {
            document.getElementById("cashpointShell")?.classList.remove("hidden");
            cashRenderCategoryRail();
            cashRenderMenu();
            cashRenderBasketPanel();
        }

        function getCurrencySymbol() { return (window.CURRENCY || "£"); }

        // ===== Install / Add-to-Home-Screen flow =====
        let _deferredInstallPrompt = null;

        window.addEventListener("beforeinstallprompt", (e) => {
            // Android/Chrome only
            e.preventDefault();
            _deferredInstallPrompt = e;
        });

        function isIOS() {
            return /iphone|ipad|ipod/i.test(navigator.userAgent);
        }

        function isInStandalone() {
            // iOS + some others
            return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
                || (window.navigator.standalone === true);
        }

        function canNativeInstallPrompt() {
            return !!_deferredInstallPrompt;
        }
        window.addEventListener("appinstalled", () => {
            console.log("✅ PWA installed");

            // Mark installed
            try { localStorage.setItem("pwa.installed.v1", "1"); } catch { }

            // ✅ Android: try to open the standalone app
            setTimeout(() => {
                // reload → Chrome often switches context to standalone
                location.reload();
            }, 300);
        });
        // Call this from your "Download" button
        async function startInstallFlow() {
            // already installed
            if (isStandalone()) {
                alert(isRTL() ? "האפליקציה כבר מותקנת" : "App is already installed");
                return;
            }

            // Android / Chrome
            if (_deferredInstallPrompt) {
                try {
                    _deferredInstallPrompt.prompt();
                    await _deferredInstallPrompt.userChoice;
                    _deferredInstallPrompt = null;
                    return;
                } catch { }
            }

            // iOS fallback
            openA2HSHelpSheet();

            // 👇 after user comes back from iOS A2HS
            setTimeout(() => {
                if (isStandalone()) {
                    // user already opened via icon → nothing to do
                    return;
                }

                // show friendly “tap icon” message
                showInstalledHint();
            }, 1200);
        }


        function showInstalledHint() {
            alert(
                isRTL()
                    ? "האפליקציה נוספה למסך הבית 🎉\nלחץ על האייקון החדש כדי להמשיך"
                    : "App added to Home Screen 🎉\nTap the new icon to continue"
            );
        }

        window.addEventListener("appinstalled", () => {
            try { localStorage.setItem("pwa.installed.v1", "1"); } catch { }
            updateDownloadIncentiveVisibility();
        });
        function openA2HSHelpSheet() {
            const title = document.getElementById("a2hsTitle");
            const body = document.getElementById("a2hsBody");

            if (title) title.textContent = isRTL() ? "הוספה למסך הבית" : "Add to Home Screen";

            const shareIcon = '<i class="fa-solid fa-share-from-square"></i>';

            if (body) {
                body.innerHTML = `
                      <div style="display:flex;flex-direction:column;gap:14px;line-height:1.35;">
                        <div style="font-weight:900;font-size:16px;">
                          ${isRTL() ? "כדי להתקין את האפליקציה:" : "To install the app:"}
                        </div>

                        <div style="font-weight:800;opacity:.85;">
                          1) ${isRTL() ? "לחץ על כפתור השיתוף" : "Tap the Share button"} ${shareIcon}
                        </div>

                        <div style="font-weight:800;opacity:.85;">
                          2) ${isRTL() ? "בחר ״הוסף למסך הבית״" : 'Choose “Add to Home Screen”'}
                        </div>

                        <div style="font-weight:800;opacity:.85;">
                          3) ${isRTL() ? "אשר" : "Confirm"}
                        </div>

                        <div style="font-weight:700;opacity:.7;font-size:13px;">
                          ${isRTL()
                        ? "הערה: באייפון אין חלון התקנה אוטומטי — זה התהליך של אפל."
                        : "Note: iPhone doesn’t show an automatic install prompt — this is Apple’s flow."}
                        </div>

                        <button class="btn full" type="button" onclick="closeA2HSHelpSheet()">
                          ${isRTL() ? "הבנתי" : "Got it"}
                        </button>
                      </div>
                    `;
            }

            showSheet(document.getElementById("a2hsModal"));
        }

        function closeA2HSHelpSheet() {
            hideSheet(document.getElementById("a2hsModal"));
        }

        function isIOS() {
            return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS
        }

        function isAndroid() {
            return /Android/i.test(navigator.userAgent);
        }

        // store the deferred prompt when Chrome/Android fires it
        let _installPrompt = null;

        window.addEventListener("beforeinstallprompt", (e) => {
            e.preventDefault();
            _installPrompt = e;
        });

        async function downloadApp() {
            // iOS -> App Store
            if (isIOS()) {
                const appId = "6737725110";
                const deepLink = `itms-apps://apps.apple.com/app/id${appId}`;
                const webLink = `https://apps.apple.com/app/id${appId}`;
                window.location.href = deepLink;
                setTimeout(() => { window.location.href = webLink; }, 500);
                return;
            }

            // Android -> PWA install prompt (if available)
            if (isAndroid()) {
                if (_installPrompt) {
                    _installPrompt.prompt();
                    try { await _installPrompt.userChoice; } catch { }
                    _installPrompt = null;
                } else {
                    // fallback if prompt isn't available
                    alert("To install: open the browser menu → Install app / Add to Home screen");
                }
                return;
            }

            // Other platforms -> do nothing (or you can add desktop PWA later)
            alert("Install is available on iOS (App Store) or Android (Install app).");
        }

        function isStandaloneApp() {
            return (
                window.matchMedia("(display-mode: standalone)").matches ||
                window.navigator.standalone === true   // iOS Safari
            );
        }

        function updateDownloadIncentiveVisibility() {
            const card = document.getElementById("downloadIncentive");
            if (!card) return;

            if (isStandaloneApp()) {
                card.style.display = "none";
            } else {
                card.style.display = "";
            }
        }

        document.addEventListener("DOMContentLoaded", updateDownloadIncentiveVisibility);
        function isStandalone() {
            // iOS Safari PWA
            const iosStandalone = window.navigator.standalone === true;
            // Android / modern browsers
            const mqlStandalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
            return iosStandalone || mqlStandalone;
        }

        function getStoredMiniId() {
            const a = Number((localStorage.getItem("miniAppId") || "").trim());
            if (!Number.isNaN(a) && a > 0) return a;

            // extra fallback (cookies survive too)
            const c = Number((getCookie?.("miniAppId") || "").trim());
            if (!Number.isNaN(c) && c > 0) return c;

            return 0;
        }
        function getItemStock(x) {
            return Number(
                x.stockQuantity ??
                x.StockQuantity ??
                x.stock ??
                x.Stock ??
                x.qty ??
                x.Qty ??
                0
            );
        }

        (function miniBoot() {
            const params = new URLSearchParams(location.search);
            const urlId = Number(params.get("id") || 0);
            const stored = getStoredMiniId();

            console.group("🧭 miniBoot");
            console.log("href:", location.href);
            console.log("standalone:", isStandalone());
            console.log("url id:", urlId);
            console.log("stored id:", stored);
            console.groupEnd();

            // ✅ If URL has id → persist it (localStorage + cookie)
            if (urlId > 0) {
                try { localStorage.setItem("miniAppId", String(urlId)); } catch { }
                try { setCookie?.("miniAppId", String(urlId)); } catch { }
                return;
            }

            // ✅ If standalone launched without id but we DO have stored id → force it into URL and reload once
            if (isStandalone() && stored > 0) {
                const u = new URL(location.href);
                u.searchParams.set("id", String(stored));
                // replaceState keeps it clean; reload ensures all early code sees id
                history.replaceState({}, document.title, u.toString());
                location.reload();
            }
        })();

        function showStandaloneWelcomeOnce() {
            if (!isStandalone()) return;

            const key = "pwa.standaloneWelcomeShown.v1";
            if (localStorage.getItem(key) === "1") return;

            // ✅ show your welcome / intro UI
            // Example: show a modal, toast, banner, etc.
            // If you already have an element:
            // document.getElementById("welcomeStandalone")?.classList.remove("hidden");

            // Mark as shown
            localStorage.setItem(key, "1");
        }

        // call on load (after DOM ready is safest)
        document.addEventListener("DOMContentLoaded", () => {
            showStandaloneWelcomeOnce();
        });

        const LOCATION_KEY = "mini.location.selected.v1";

        function getLocations() {
            try {
                const raw = localStorage.getItem("miniLocations") || "";
                const arr = raw ? JSON.parse(raw) : [];
                return Array.isArray(arr) ? arr : [];
            } catch {
                return [];
            }
        }

        function getSelectedLocationId(locations) {
            const saved = (localStorage.getItem(LOCATION_KEY) || "").trim();
            if (saved && locations.some(x => String(x.id) === saved)) return saved;
            // default to first
            return locations[0] ? String(locations[0].id) : "";
        }

        function setSelectedLocationId(id) {
            localStorage.setItem(LOCATION_KEY, String(id));
        }
        function getStampEarnTag() {
            const lo = getMiniLoyalty();
            const tag = String(lo?.stamps?.earnTag || "").trim();
            DBG_STAMP("earnTag from loyalty =", tag, "loyalty =", lo);
            return tag;
        }

        function lineEarnsStamp(entry) {
            const earnTag = getStampEarnTag();
            if (!earnTag) return false;

            const tags = Array.isArray(entry?.item?.tags) ? entry.item.tags : [];
            const tagsNorm = tags.map(t => String(t || "").trim().toLowerCase());

            // allow either exact earnTag or generic "stamp"
            return tagsNorm.includes(earnTag.toLowerCase()) || tagsNorm.includes("stamp");
        }

        function awardStampsFromBasketSnapshot(basketSnapshot) {
            if (!isMember()) return;

            let add = 0;
            for (const l of (basketSnapshot || [])) {
                if (lineEarnsStamp(l)) add += Number(l.qty || 0);
            }

            if (add <= 0) return;

            const profile = loadMemberProfile();
            if (!profile) return;

            const current = getStamps(profile);
            const next = Math.min(10, current + add);

            setStamps(profile, next);
            saveMemberProfile(profile);

            updateCoffeeHeaderIcon();
            try { renderMemberCard?.(); } catch { }
        }

        function renderLocationSegment() {
            const wrap = document.getElementById("locationWrap");
            const seg = document.getElementById("locationSeg");
            const ind = document.getElementById("locationIndicator");
            if (!wrap || !seg || !ind) return;

            // Read + sanitize
            let locations = [];
            try {
                const raw = localStorage.getItem("miniLocations") || "";
                locations = raw ? JSON.parse(raw) : [];
            } catch { locations = []; }

            locations = (Array.isArray(locations) ? locations : [])
                .map(x => ({
                    id: String(x?.id ?? "").trim(),
                    title: String(x?.title ?? "").trim(),
                }))
                .filter(x => x.id && x.title)
                .slice(0, 4);

            console.log("📍 miniLocations cleaned =", locations);

            // Hide if 0/1
            if (locations.length <= 1) {
                wrap.style.display = "none";
                return;
            }
            wrap.style.display = "";

            // Columns
            seg.style.gridTemplateColumns = `repeat(${locations.length}, 1fr)`;

            // Selected id
            const KEY = "mini.location.selected.v1";
            const saved = (localStorage.getItem(KEY) || "").trim();
            const selectedId = (saved && locations.some(x => x.id === saved)) ? saved : locations[0].id;
            const idx = Math.max(0, locations.findIndex(x => x.id === selectedId));

            // Buttons
            const btnIds = ["locBtn1", "locBtn2", "locBtn3", "locBtn4"];
            btnIds.forEach((id, i) => {
                const b = document.getElementById(id);
                if (!b) return;

                if (i < locations.length) {
                    const loc = locations[i];
                    b.style.display = "";
                    b.textContent = loc.title;

                    // ✅ stable identity
                    b.dataset.locId = loc.id;
                    b.dataset.locIndex = String(i);

                    b.classList.toggle("active", i === idx);
                } else {
                    b.style.display = "none";
                    b.dataset.locId = "";
                    b.dataset.locIndex = "";
                    b.classList.remove("active");
                }
            });

            // ✅ event delegation (single handler, no stale closures)
            seg.onclick = (e) => {
                const btn = e.target?.closest?.(".segBtn");
                const locId = btn?.dataset?.locId || "";
                if (!locId) return;

                localStorage.setItem(KEY, locId);
                renderLocationSegment(); // rerender
            };

            // Indicator (RTL-aware)
            const colCount = locations.length;
            const rtl = document.documentElement.dir === "rtl";
            const step = 100 / colCount;
            const pos = rtl ? (step * (colCount - 1 - idx)) : (step * idx);

            ind.style.width = `calc(${step}% - 6px)`;
            ind.style.left = `calc(${pos}% + 3px)`;
        }

        const ZC = (() => {
            const host = document.getElementById("zcHost");
            const backdrop = document.getElementById("zcBackdrop");
            const closeBtn = document.getElementById("zcClose");
            const frame = document.getElementById("zcFrame");

            function openWithUrl(checkoutUrl) {
                if (!host || !frame) return;

                host.classList.remove("hidden");
                host.setAttribute("aria-hidden", "false");
                requestAnimationFrame(() => host.classList.add("open"));

                frame.src = checkoutUrl;
            }

            function close() {
                if (!host || !frame) return;
                host.classList.remove("open");
                setTimeout(() => {
                    host.classList.add("hidden");
                    host.setAttribute("aria-hidden", "true");
                    frame.src = "about:blank";
                }, 220);
            }

            closeBtn?.addEventListener("click", close);
            backdrop?.addEventListener("click", close);

            async function start({ total }) {
                const amt = Number(total || 0);
                if (!amt || isNaN(amt)) return;

                const miniAppId = resolveMiniAppIdForSubmit();
                const internalOrderId = `PWA-${miniAppId}-${Date.now()}`;

                const returnUrl = new URL(location.href);
                returnUrl.searchParams.set("id", String(miniAppId));

                const name = (getCookie("userName") || "Customer").trim();
                const email = (getCookie("userEmail") || localStorage.getItem("userEmail") || "customer@example.com").trim();
                const phone = (getCookie("userPhone") || "").trim();

                const createUrl =
                    `/test/zcredit/create` +
                    `?miniAppId=${encodeURIComponent(miniAppId)}` +
                    `&amount=${encodeURIComponent(amt.toFixed(2))}` +
                    `&currency=ILS` +
                    `&orderId=${encodeURIComponent(internalOrderId)}` +
                    `&returnUrl=${encodeURIComponent(returnUrl.toString())}` +
                    `&name=${encodeURIComponent(name)}` +
                    `&email=${encodeURIComponent(email)}` +
                    `&phone=${encodeURIComponent(phone)}` +
                    `&source=${encodeURIComponent("mini")}`;

                const res = await fetch(createUrl, { method: "GET", cache: "no-store" });
                const data = await res.json().catch(() => null);

                if (!res.ok || !data?.ok || !data.checkoutUrl) {
                    console.error("[ZC] create failed:", res.status, data);
                    alert(isRTL() ? "שגיאה בחיבור למסוף" : "Payment terminal error");
                    return;
                }

                openWithUrl(data.checkoutUrl);
            }

            return { start, close };
        })();

        async function handleQuick2StampGrant() {
            const url = new URL(location.href);
            const token = (url.searchParams.get("grant2stamps") || "").trim();
            if (!token) return;

            const usedKey = `stampGrantUsed:${token}`;
            if (localStorage.getItem(usedKey) === "1") {
                alert(isRTL() ? "הקישור כבר מומש" : "This link was already used");
                cleanupQuick2StampQuery(url);
                return;
            }

            let profile = loadMemberProfile();

            // ✅ אם אין כרטיס חבר – צור אחד זמני אוטומטית
            if (!profile) {
                profile = {
                    miniAppId: Number(localStorage.getItem("miniAppId") || 12) || 12,
                    campaignId: "quick_grant",
                    name: "",
                    email: "",
                    anonId: ensureAnonUUID(),
                    createdAt: Date.now() / 1000,
                    wallet: {
                        stamps: 0,
                        redeems: 0,
                        birthdayVoucherRedeemedYear: 0
                    },
                    stamps: 0,
                    marketingOptIn: false
                };
            }

            const current = getStamps(profile);
            const next = Math.min(10, current + 2);

            setStamps(profile, next);
            saveMemberProfile(profile);

            // ✅ נסמן גם כחבר כדי שהאייקון/כרטיסייה יעבדו
            setCookie("isMember", "1");

            localStorage.setItem(usedKey, "1");

            updateCoffeeHeaderIcon();
            try { renderMemberCard(); } catch { }

            alert(isRTL() ? "נוספו 2 חותמות ☕️" : "2 stamps added ☕️");

            cleanupQuick2StampQuery(url);
        }

        function cleanupQuick2StampQuery(urlObj) {
            urlObj.searchParams.delete("grant2stamps");
            history.replaceState({}, document.title, urlObj.toString());
        }