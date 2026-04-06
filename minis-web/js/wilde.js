const wildeDestinations = [
    {
        id: "breakfast",
        title: "Breakfast",
        subtitle: "Morning room service",
        imageUrl: "https://picsum.photos/seed/wilde-breakfast/800/800"
    },
    {
        id: "minibar",
        title: "Minibar",
        subtitle: "Snacks and essentials",
        imageUrl: "https://picsum.photos/seed/wilde-minibar/800/800"
    },
    {
        id: "italian",
        title: "Italian",
        subtitle: "Pasta and late supper",
        imageUrl: "https://picsum.photos/seed/wilde-italian/800/800"
    },
    {
        id: "grill",
        title: "Grill",
        subtitle: "Steaks and burgers",
        imageUrl: "https://picsum.photos/seed/wilde-grill/800/800"
    },
    {
        id: "asian",
        title: "Asian",
        subtitle: "Noodles and bao",
        imageUrl: "https://picsum.photos/seed/wilde-asian/800/800"
    },
    {
        id: "bakery",
        title: "Bakery",
        subtitle: "Pastries and coffee",
        imageUrl: "https://picsum.photos/seed/wilde-bakery/800/800"
    },
    {
        id: "salads",
        title: "Salads",
        subtitle: "Fresh bowls",
        imageUrl: "https://picsum.photos/seed/wilde-salads/800/800"
    },
    {
        id: "desserts",
        title: "Desserts",
        subtitle: "Cakes and sweets",
        imageUrl: "https://picsum.photos/seed/wilde-desserts/800/800"
    },
    {
        id: "cocktails",
        title: "Cocktails",
        subtitle: "Bar menu",
        imageUrl: "https://picsum.photos/seed/wilde-cocktails/800/800"
    }
];

const grid = document.getElementById("wildeGrid");
const toast = document.getElementById("wildeToast");
const homeView = document.getElementById("wildeHomeView");
const shopView = document.getElementById("wildeShopView");
const shopTitle = document.getElementById("wildeShopTitle");
const shopSubtitle = document.getElementById("wildeShopSubtitle");
const shopKicker = document.getElementById("wildeShopKicker");
const shopHero = document.getElementById("wildeShopHero");
const categoryBar = document.getElementById("wildeCategoryBar");
const menuStack = document.getElementById("wildeMenuStack");
const backButton = document.getElementById("wildeBackButton");
let toastTimer;

const demoCategories = ["Featured", "Classics", "Light Bites", "Drinks"];
const demoProducts = Array.from({ length: 6 }, (_, index) => ({
    name: `Product ${index + 1}`,
    description: "A sample item for the demo menu.",
    price: `£${(index + 1) * 4 + 8}.00`
}));

function buildTile(destination) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wilde-tile";
    button.setAttribute("aria-label", destination.title);

    const media = document.createElement("div");
    media.className = "wilde-media";

    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.src = destination.imageUrl;
    image.addEventListener("error", () => {
        image.remove();
    });

    const fallback = document.createElement("div");
    fallback.className = "wilde-media-fallback";
    fallback.textContent = "W";

    media.append(image, fallback);

    const copy = document.createElement("div");
    copy.className = "wilde-copy";
    copy.innerHTML = `
        <h2>${destination.title}</h2>
        <p>${destination.subtitle}</p>
    `;

    button.append(media, copy);
    button.addEventListener("click", () => {
        openShop(destination);
    });

    return button;
}

function buildHero(destination) {
    shopHero.innerHTML = "";

    const image = document.createElement("img");
    image.alt = "";
    image.src = destination.imageUrl;
    image.loading = "eager";
    image.addEventListener("error", () => {
        image.remove();
    });

    const copy = document.createElement("div");
    copy.className = "wilde-shop-hero-copy";
    copy.innerHTML = `
        <strong>${destination.title}</strong>
        <span>Demo menu presentation for today’s Wilde hotels showcase.</span>
    `;

    shopHero.append(image, copy);
}

function buildCategories() {
    categoryBar.innerHTML = "";

    demoCategories.forEach((category, index) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `wilde-category-chip${index === 0 ? " is-active" : ""}`;
        chip.textContent = category;
        chip.addEventListener("click", () => {
            categoryBar.querySelectorAll(".wilde-category-chip").forEach((item) => {
                item.classList.remove("is-active");
            });
            chip.classList.add("is-active");
            showToast(`${category} category`);
        });
        categoryBar.appendChild(chip);
    });
}

function buildProducts() {
    menuStack.innerHTML = "";

    demoCategories.forEach((category, categoryIndex) => {
        const section = document.createElement("section");
        const title = document.createElement("h2");
        title.className = "wilde-menu-section-title";
        title.textContent = category;

        const productGrid = document.createElement("div");
        productGrid.className = "wilde-product-grid";

        demoProducts.slice(0, 4).forEach((product, productIndex) => {
            const card = document.createElement("article");
            card.className = "wilde-product-card";
            card.innerHTML = `
                <div class="wilde-product-media">
                    <div class="wilde-product-badge">Demo</div>
                </div>
                <div class="wilde-product-copy">
                    <h3>${product.name}</h3>
                    <p>${product.description}</p>
                    <div class="wilde-product-footer">
                        <span class="wilde-product-price">${demoProducts[(categoryIndex + productIndex) % demoProducts.length].price}</span>
                        <button class="wilde-product-action" type="button">Add</button>
                    </div>
                </div>
            `;

            const action = card.querySelector(".wilde-product-action");
            action.addEventListener("click", () => {
                showToast(`${product.name} added`);
            });

            productGrid.appendChild(card);
        });

        section.append(title, productGrid);
        menuStack.appendChild(section);
    });
}

function openShop(destination) {
    shopKicker.textContent = "Room service";
    shopTitle.textContent = destination.title;
    shopSubtitle.textContent = destination.subtitle;
    buildHero(destination);
    buildCategories();
    buildProducts();
    homeView.classList.add("wilde-view-hidden");
    shopView.classList.remove("wilde-view-hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function showHome() {
    shopView.classList.add("wilde-view-hidden");
    homeView.classList.remove("wilde-view-hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
        toast.classList.remove("is-visible");
    }, 1800);
}

wildeDestinations.forEach((destination) => {
    grid.appendChild(buildTile(destination));
});

backButton.addEventListener("click", showHome);
