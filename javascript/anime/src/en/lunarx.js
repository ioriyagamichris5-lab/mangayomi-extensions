const mangayomiSources = [{
    "name": "Lunar",
    "lang": "en",
    "baseUrl": "https://lunarx.to",
    "apiUrl": "https://api.lunarx.to",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=lunarx.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.1",
    "pkgPath": "anime/src/en/lunarx.js"
}];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    // ---------- helpers ----------
    get api() {
        return (mangayomiSources[0].apiUrl || "https://api.lunarx.to").replace(/\/$/, "");
    }

    get nsfw() {
        try {
            const v = new SharedPreferences().get("nsfw");
            return v === true || v === "true";
        } catch (e) { return false; }
    }

    get headers() {
        return {
            "Referer": "https://lunarx.to/",
            "Origin": "https://lunarx.to",
            "Accept": "application/json, text/plain, */*"
        };
    }

    async getJson(path) {
        const res = await this.client.get(this.api + path, this.headers);
        return JSON.parse(res.body);
    }

    cover(c) {
        if (!c) return "";
        if (typeof c === "string") return c;
        return c.extraLarge || c.large || c.medium || "";
    }

    title(i) {
        return i.titleEnglish || i.titleRomaji || i.title || i.name || "Unknown";
    }

    isAdult(i) {
        if (i.isAdult === true) return true;
        const g = i.genres || [];
        return g.some(x => String(x).toLowerCase() === "hentai");
    }

    toList(json) {
        const items = (json && (json.items || json.data || json.results)) || [];
        const list = [];
        for (const i of items) {
            const id = i.anilistId || i.id;
            if (!id) continue;
            if (!this.nsfw && this.isAdult(i)) continue;
            list.push({ name: this.title(i), imageUrl: this.cover(i.coverImage || i.coverImages), link: String(id) });
        }
        return list;
    }

    pageOf(json, page) {
        const total = json && json.totalPages;
        return total ? page < total : (json && (json.items || []).length >= 20);
    }

    async catalog(page, sort, extra) {
        let q = `/api/anidb/catalog?page=${page}&perPage=20&sort=${sort}`;
        if (this.nsfw) q += "&includeAdult=true";
        if (extra) q += extra;
        const json = await this.getJson(q);
        return { list: this.toList(json), hasNextPage: this.pageOf(json, page) };
    }

    // ---------- browse ----------
    async getPopular(page) {
        return await this.catalog(page, "POPULARITY_DESC");
    }

    async getLatestUpdates(page) {
        try {
            return await this.catalog(page, "UPDATED_AT_DESC");
        } catch (e) {
            return await this.catalog(page, "TRENDING_DESC");
        }
    }

    async search(query, page, filters) {
        let extra = "";
        try {
            for (const f of filters || []) {
                if (f.type_name === "SelectFilter" && f.state > 0) {
                    const v = f.values[f.state].value;
                    if (f.name === "Format") extra += "&format=" + v;
                    if (f.name === "Status") extra += "&status=" + v;
                }
            }
        } catch (e) {}
        if (!query) return await this.catalog(page, "POPULARITY_DESC", extra);
        const json = await this.getJson(`/api/anidb/search?q=${encodeURIComponent(query)}&page=${page}`);
        return { list: this.toList(json), hasNextPage: this.pageOf(json, page) };
    }

    // ---------- detail ----------
    async getDetail(url) {
        const id = String(url).split("/").pop();
        const info = await this.getJson(`/api/anidb/info?anilistId=${id}`);
        const d = info.data && !info.titleRomaji ? info.data : info;

        const desc = (d.description || d.synopsis || "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#039;|&#39;/g, "'")
            .trim();

        const st = String(d.status || "").toUpperCase();
        const status = st === "FINISHED" ? 1 : st === "RELEASING" ? 0 : 5;

        let eps = [];
        try {
            const r = await this.getJson(`/api/animes/v2/vermillion/episodes/lite?id=${id}`);
            const arr = r.data || r.episodes || [];
            for (const e of arr) {
                const n = e.number;
                if (n == null) continue;
                const t = e.titles ? (e.titles.en || e.titles["x-jat"] || e.titles.ja) : e.title;
                eps.push({ name: `Episode ${n}` + (t ? ` - ${t}` : ""), url: `${id}|${n}`, _n: Number(n) });
            }
        } catch (e) {}

        if (eps.length === 0) {
            const count = d.episodeCount || d.totalEpisodes || 0;
            for (let n = 1; n <= count; n++) eps.push({ name: `Episode ${n}`, url: `${id}|${n}`, _n: n });
        }
        eps.sort((a, b) => b._n - a._n);
        eps = eps.map(e => ({ name: e.name, url: e.url }));

        return {
            name: this.title(d),
            imageUrl: this.cover(d.coverImage),
            description: desc,
            genre: d.genres || [],
            author: (d.studios || []).join(", "),
            status: status,
            link: `${this.getBaseUrl()}/anime/${id}`,
            chapters: eps
        };
    }

    getBaseUrl() { return "https://lunarx.to"; }

    // ---------- video ----------
    async getVideoList(url) {
        const [id, ep] = String(url).split("|");
        const videos = [];
        const types = ["sub", "dub"];
        for (const type of types) {
            try {
                const a = type === "dub" ? 1 : 0;
                const j = await this.getJson(`/api/3rdprovider?anilist=${id}&episode=${ep}&m3u8=true&a=${a}&audio=${type}`);
                const s = j.stream_data || j.data || {};
                if (!s.m3u8_url) continue;
                const subs = (s.subtitles || []).map(x => ({
                    file: x.url,
                    label: x.language_name || x.title || x.language || "Sub"
                }));
                videos.push({
                    url: s.m3u8_url,
                    originalUrl: s.m3u8_url,
                    quality: `Lunar ${type.toUpperCase()}`,
                    headers: { "Referer": "https://lunarx.to/", "Origin": "https://lunarx.to" },
                    subtitles: subs
                });
                if (type === "sub" && s.has_dub === false) break;
            } catch (e) {}
        }

        if (videos.length === 0) {
            const hosts = ["beep", "kami", "mizu", "zone", "doki", "yuki", "nuri", "neko", "ozzy", "sora"];
            for (const host of hosts) {
                for (const type of ["sub", "dub"]) {
                    try {
                        const j = await this.getJson(`/api/animes/vermillion/sources?id=${id}&host=${host}&epNum=${ep}&type=${type}`);
                        const d = j.data || j;
                        const src = (d.sources || [])[0];
                        if (!src || !src.url) continue;
                        const subs = (d.subtitles || []).map(x => ({ file: x.url || x.file, label: x.label || x.lang || "Sub" }));
                        videos.push({
                            url: src.url,
                            originalUrl: src.url,
                            quality: `${host} ${type.toUpperCase()}`,
                            headers: d.headers || { "Referer": "https://lunarx.to/" },
                            subtitles: subs
                        });
                    } catch (e) {}
                }
                if (videos.length) break;
            }
        }
        return videos;
    }

    // ---------- filters / prefs ----------
    getFilterList() {
        const opt = (n, v) => ({ type_name: "SelectOption", name: n, value: v });
        return [
            { type_name: "SelectFilter", name: "Format", state: 0,
              values: [opt("Any", ""), opt("TV", "TV"), opt("Movie", "MOVIE"), opt("OVA", "OVA"), opt("ONA", "ONA"), opt("Special", "SPECIAL")] },
            { type_name: "SelectFilter", name: "Status", state: 0,
              values: [opt("Any", ""), opt("Releasing", "RELEASING"), opt("Finished", "FINISHED"), opt("Not yet released", "NOT_YET_RELEASED")] }
        ];
    }

    getSourcePreferences() {
        return [{
            key: "nsfw",
            switchPreferenceCompat: {
                title: "Show NSFW / Hentai",
                summary: "Include adult titles in browse and search",
                value: false
            }
        }];
    }
}
