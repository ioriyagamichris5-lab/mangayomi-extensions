const mangayomiSources = [{
    "name": "9Anime NZ",
    "lang": "en",
    "baseUrl": "https://9anime.nz",
    "apiUrl": "",
    "iconUrl": "https://9anime.nz/assets/uploads/logo.png",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.1",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "anime/src/en/nineanimenz.js"
}];

// ---------------------------------------------------------------------------
// Things that could NOT be verified from rendered pages. Change here if needed.
// ---------------------------------------------------------------------------
// Query-string key the site's search box uses (check the URL after you search).
const SEARCH_PARAM = "q";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    getHeaders(url) {
        return { "Referer": this.source.baseUrl + "/", "User-Agent": UA };
    }

    // ------------------------------------------------------------------ lists
    async getPopular(page) {
        return await this.parseAnimeList(`${this.source.baseUrl}/search?page=${page}`, false);
    }

    async getLatestUpdates(page) {
        const url = page <= 1
            ? `${this.source.baseUrl}/home`
            : `${this.source.baseUrl}/page/${page}`;
        // Home also carries sidebars (Top/Upcoming/Recently Added) that link to
        // /anime/..., while the "Latest Release" grid links to /watch/...
        return await this.parseAnimeList(url, true);
    }

    async search(query, page, filters) {
        const q = encodeURIComponent(query.trim()).replace(/%20/g, "+");
        return await this.parseAnimeList(
            `${this.source.baseUrl}/search?${SEARCH_PARAM}=${q}&page=${page}`, false);
    }

    async parseAnimeList(url, watchOnly) {
        const base = this.source.baseUrl;
        const res = await this.client.get(url, this.getHeaders(url));
        const html = res.body || "";
        const doc = new Document(html);

        const bySlug = {};
        const order = [];

        for (const a of doc.select("a[href]")) {
            const path = toPath(a.attr("href") || "", base);
            const m = path.match(/^\/(watch|anime)\/([^\/?#]+)/);
            if (!m) continue;
            if (watchOnly && m[1] !== "watch") continue;
            const slug = m[1] === "watch" ? m[2].replace(/-episode-[\d.]+$/, "") : m[2];

            if (!bySlug[slug]) {
                bySlug[slug] = { name: "", imageUrl: "" };
                order.push(slug);
            }
            const entry = bySlug[slug];
            if (!entry.name) entry.name = cardTitle(a);
            if (!entry.imageUrl) entry.imageUrl = cardImage(a, base);
        }

        const list = order.map(slug => ({
            name: bySlug[slug].name || slug,
            imageUrl: bySlug[slug].imageUrl,
            link: `/anime/${slug}`
        }));

        // Fallback: posters not reachable through the anchors (e.g. CSS background
        // on a sibling element). Pair by document order when the counts line up.
        if (list.length && list.every(i => !i.imageUrl)) {
            const imgs = uniq(
                (html.match(/(?:https?:\/\/[^"'()\s<>]*)?\/assets\/uploads\/[^"'()\s<>]+?\.(?:jpe?g|png|webp)/gi) || [])
                    .filter(u => !/logo|discussion/i.test(u))
                    .map(u => absUrl(u, base))
            );
            if (imgs.length === list.length) {
                list.forEach((item, i) => { item.imageUrl = imgs[i]; });
            }
        }

        const hasNextPage = !!doc.selectFirst('a[title="Next"]');
        return { "list": list, "hasNextPage": hasNextPage };
    }

    // ----------------------------------------------------------------- detail
    async getDetail(url) {
        const base = this.source.baseUrl;
        let path = toPath(url, base);
        const wm = path.match(/^\/watch\/([^\/?#]+?)(?:-episode-[\d.]+)?$/);
        if (wm) path = `/anime/${wm[1]}`;
        const slug = (path.match(/^\/anime\/([^\/?#]+)/) || [])[1] || "";

        const res = await this.client.get(base + path, this.getHeaders(base + path));
        const html = res.body || "";
        const doc = new Document(html);
        const detail = {};

        detail.name = decodeEntities((doc.selectFirst("h1")?.text || slug).trim());

        // poster: the <img> whose alt is the title, else the first upload image
        let poster = "";
        for (const img of doc.select("img")) {
            const src = img.attr("data-src") || img.attr("src") || "";
            if (!/\/assets\/uploads\//.test(src) || /logo|discussion/i.test(src)) continue;
            if (!poster) poster = src;
            if ((img.attr("alt") || "").trim() === detail.name) { poster = src; break; }
        }
        detail.imageUrl = absUrl(poster, base);

        detail.description = decodeEntities(
            (doc.selectFirst('meta[name="description"]')?.attr("content") || "").trim());

        // Flatten tags so label/value pairs parse regardless of the wrapper markup
        const flat = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ");

        const status = (flat.match(/Status:\s*([A-Za-z]+)/) || [])[1] || "";
        detail.status = { "ongoing": 0, "completed": 1 }[status.toLowerCase()] ?? 5;

        const studio = (flat.match(/Studios:\s*(.+?)\s*(?:Director:|Producers:|Characters|$)/) || [])[1];
        if (studio) detail.author = studio.trim();

        // Genres: only anchors between the "Genres:" and "Studios:" labels
        const gi = html.indexOf("Genres");
        const si = gi >= 0 ? html.indexOf("Studios", gi) : -1;
        if (gi >= 0 && si > gi) {
            const slice = html.slice(gi, si);
            detail.genre = [...slice.matchAll(/<a[^>]*genre=[^>]*>\s*([^<]+?)\s*<\/a>/gi)]
                .map(m => decodeEntities(m[1]));
        }

        // Episodes: every /watch/<slug>-episode-N link on the page
        const eps = {};
        for (const a of doc.select("a[href]")) {
            const p = toPath(a.attr("href") || "", base);
            const m = p.match(/^\/watch\/([^\/?#]+?)-episode-(\d+(?:\.\d+)?)$/);
            if (!m) continue;
            if (slug && m[1] !== slug) continue;
            eps[m[2]] = p;
        }
        detail.episodes = Object.keys(eps)
            .sort((x, y) => parseFloat(y) - parseFloat(x))
            .map(n => ({ name: `Episode ${n}`, url: eps[n] }));
        return detail;
    }

    // ------------------------------------------------------------------ video
    async getVideoList(url) {
        const base = this.source.baseUrl;
        const pageUrl = /^https?:/.test(url) ? url : base + url;
        const res = await this.client.get(pageUrl, this.getHeaders(pageUrl));
        const html = (res.body || "").replace(/&amp;/g, "&").replace(/\\\//g, "/");

        // Players referenced anywhere in the page (iframe src, data-* attrs, inline JS)
        let players = uniq(html.match(/https?:\/\/[^"'\s<>\\]*newplayer\.php[^"'\s<>\\]*/gi) || []);
        if (!players.length) {
            const doc = new Document(res.body || "");
            players = uniq(doc.select("iframe")
                .map(i => i.attr("src") || i.attr("data-src") || "")
                .filter(s => s)
                .map(s => absUrl(s, base)));
        }
        if (!players.length) {
            throw new Error(`9Anime NZ: no player found on ${pageUrl}`);
        }

        // Sibling servers: same id/ep, different type/category (HD-1, HD-2 sub; DUB-1 dub).
        // Unverified guess; each variant is skipped silently if it yields nothing.
        const first = players[0];
        if (/[?&]type=/.test(first) && /[?&]category=/.test(first)) {
            for (const [t, c] of [["hd-1", "sub"], ["hd-2", "sub"], ["dub-1", "dub"]]) {
                const v = first.replace(/([?&]type=)[^&]*/, `$1${t}`).replace(/([?&]category=)[^&]*/, `$1${c}`);
                players.push(v);
            }
            players = uniq(players);
        }

        const videos = [];
        const errors = [];
        for (const p of players) {
            try {
                const label = serverLabel(p);
                videos.push(...await this.extractFromPlayer(p, label, 0));
            } catch (e) {
                errors.push(`${p} -> ${e}`);
            }
        }

        if (!videos.length) {
            throw new Error("9Anime NZ: players returned no m3u8/mp4. " + errors.join(" | ") +
                " | tried: " + players.join(" , "));
        }
        videos.sort((a, b) => qualityNum(b.quality) - qualityNum(a.quality));
        return videos;
    }

    async extractFromPlayer(playerUrl, label, depth) {
        const headers = { "Referer": this.source.baseUrl + "/", "User-Agent": UA };
        const res = await this.client.get(playerUrl, headers);
        const body = (res.body || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
        const origin = (playerUrl.match(/^https?:\/\/[^\/]+/) || [""])[0];

        const urls = [];
        for (const m of body.matchAll(/https?:\/\/[^"'\s<>\\]+?\.(?:m3u8|mp4)(?:\?[^"'\s<>\\]*)?/gi)) urls.push(m[0]);
        for (const m of body.matchAll(/["'](\/[^"'\s<>\\]+?\.(?:m3u8|mp4)(?:\?[^"'\s<>\\]*)?)["']/gi)) urls.push(origin + m[1]);

        const subtitles = uniq(
            [...body.matchAll(/https?:\/\/[^"'\s<>\\]+?\.(?:vtt|srt)(?:\?[^"'\s<>\\]*)?/gi)].map(m => m[0])
        ).map((f, i) => ({ file: f, label: `Subtitle ${i + 1}` }));

        const playerHeaders = { "Referer": origin + "/", "User-Agent": UA };
        const out = [];
        for (const u of uniq(urls)) {
            if (/\.m3u8/i.test(u)) {
                out.push(...await expandHls(this.client, u, label, playerHeaders, subtitles));
            } else {
                out.push({ url: u, originalUrl: u, quality: `${label} - Default`, headers: playerHeaders, subtitles });
            }
        }

        if (!out.length && depth === 0) {
            const nested = (body.match(/<iframe[^>]+src=["']([^"']+)["']/i) || [])[1];
            if (nested) {
                return await this.extractFromPlayer(absUrl(nested, origin), label, 1);
            }
        }
        if (!out.length) {
            throw new Error(`no sources (HTTP ${res.statusCode}, ${body.length} bytes: ${body.slice(0, 160).replace(/\s+/g, " ")})`);
        }
        return out;
    }

    getFilterList() {
        return [];
    }

    getSourcePreferences() {
        return [];
    }
}

// ============================================================================
// helpers
// ============================================================================
function uniq(arr) {
    return [...new Set(arr)];
}

function decodeEntities(s) {
    // the site double-encodes (e.g. "Paw &amp;amp; Palaces")
    return (s || "").replace(/&amp;/g, "&").replace(/&amp;/g, "&")
        .replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function toPath(href, base) {
    if (!href) return "";
    if (href.startsWith(base)) href = href.slice(base.length);
    else if (/^https?:\/\//.test(href)) {
        // other host: keep as-is so it never matches /watch|anime patterns by accident
        return href;
    }
    if (!href.startsWith("/")) href = "/" + href;
    return href;
}

function absUrl(u, base) {
    if (!u) return "";
    if (/^https?:\/\//.test(u)) return u;
    if (u.startsWith("//")) return "https:" + u;
    return base + (u.startsWith("/") ? "" : "/") + u;
}

function cardTitle(a) {
    let t = "";
    const text = a.text || "";
    // card anchors render as "Title TYPE CC12 12 ▶ Title"; the part after ▶ is clean
    if (text.indexOf("▶") >= 0) t = text.split("▶").pop().trim();
    if (!t) t = (a.attr("title") || "").trim();
    if (!t) t = (a.selectFirst("img")?.attr("alt") || "").trim();
    if (!t) t = (a.selectFirst("[class*=title], [class*=name], h2, h3, h4")?.text || "").trim();
    if (!t) t = text.trim();
    return decodeEntities(t);
}

function cardImage(a, base) {
    const img = a.selectFirst("img");
    if (img) {
        const src = img.attr("data-src") || img.attr("data-original") ||
            img.attr("data-lazy-src") || img.attr("src") || "";
        if (src && !src.startsWith("data:")) return absUrl(src, base);
    }
    for (const el of a.select("[style], [data-bg], [data-background]")) {
        const bg = el.attr("data-bg") || el.attr("data-background") || "";
        if (bg) return absUrl(bg, base);
        const m = (el.attr("style") || "").match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
        if (m) return absUrl(m[1], base);
    }
    return "";
}

function serverLabel(playerUrl) {
    const t = (playerUrl.match(/[?&]type=([^&]+)/) || [])[1];
    const c = (playerUrl.match(/[?&]category=([^&]+)/) || [])[1];
    if (!t && !c) return "Server";
    const cat = c ? c.charAt(0).toUpperCase() + c.slice(1) : "";
    return `${(t || "").toUpperCase()}${t && cat ? " " : ""}${cat}`.trim();
}

function qualityNum(q) {
    const m = (q || "").match(/(\d+)p/);
    return m ? parseInt(m[1]) : 0;
}

function resolveUrl(uri, masterUrl) {
    if (/^https?:\/\//.test(uri)) return uri;
    if (uri.startsWith("/")) return (masterUrl.match(/^https?:\/\/[^\/]+/) || [""])[0] + uri;
    return masterUrl.slice(0, masterUrl.lastIndexOf("/") + 1) + uri;
}

async function expandHls(client, masterUrl, label, headers, subtitles) {
    const r = await client.get(masterUrl, headers);
    const txt = r.body || "";
    const out = [];
    if (txt.indexOf("#EXT-X-STREAM-INF") >= 0) {
        const lines = txt.split("\n").map(l => l.trim());
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
            const h = (lines[i].match(/RESOLUTION=\d+x(\d+)/) || [])[1];
            const uri = lines[i + 1];
            if (!uri || uri.startsWith("#")) continue;
            const full = resolveUrl(uri, masterUrl);
            out.push({
                url: full, originalUrl: full,
                quality: `${label} - ${h ? h + "p" : "Auto"}`,
                headers, subtitles
            });
        }
    }
    if (!out.length) {
        out.push({ url: masterUrl, originalUrl: masterUrl, quality: `${label} - Auto`, headers, subtitles });
    }
    return out;
}
