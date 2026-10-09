import { copyWithFeedback, setStatus } from './ui.js';

/**
 * 公共后缀表（常用部分，非完整 Public Suffix List）。
 *
 * 用途：剥掉域名后缀后，剩下的最后一段就是分组依据
 * （ads.example.com -> example.com，a.example.co.uk -> example.co.uk）。
 *
 * 注意：这是一份"常用后缀"表而不是完整 PSL。表里没有的后缀会被当成域名主体，
 * 于是该后缀下的所有域名会被归到同一组（例如 .dev 曾经不在表里，
 * foo.dev 和 bar.dev 就会被合并到 #[dev]）。加新后缀时加到这里即可。
 *
 * 用 Set 而不是数组：原来用 Array.includes 每解析一层标签就要线性扫 250 项。
 */
const TOP_DOMAINS = new Set([
    // 通用顶级域
    'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'arpa',
    'biz', 'info', 'name', 'pro', 'mobi', 'aero', 'coop', 'jobs', 'cat', 'tel', 'xxx',
    'travel', 'museum', 'post', 'asia', 'xxx',
    // 常见新顶级域
    'app', 'dev', 'cloud', 'site', 'online', 'shop', 'store', 'tech', 'space', 'website',
    'blog', 'wiki', 'xyz', 'top', 'club', 'icu', 'live', 'life', 'world', 'today', 'news',
    'media', 'agency', 'digital', 'studio', 'design', 'art', 'fun', 'link', 'click', 'one',
    'page', 'run', 'vip', 'win', 'red', 'pink', 'blue', 'green', 'black', 'gold', 'silver',
    'host', 'press', 'review', 'rocks', 'social', 'software', 'solutions', 'support',
    'systems', 'team', 'tools', 'works', 'zone', 'academy', 'center', 'city', 'company',
    'email', 'group', 'guru', 'house', 'land', 'market', 'network', 'partner', 'plus',
    'pub', 'tips', 'ventures', 'watch', 'work', 'finance', 'money', 'law', 'health',
    // 国家/地区代码
    'ac', 'ad', 'ae', 'af', 'ag', 'ai', 'al', 'am', 'ao', 'aq', 'ar', 'as', 'at', 'au',
    'aw', 'ax', 'az', 'ba', 'bb', 'bd', 'be', 'bf', 'bg', 'bh', 'bi', 'bj', 'bl', 'bm',
    'bn', 'bo', 'bq', 'br', 'bs', 'bt', 'bv', 'bw', 'by', 'bz', 'ca', 'cc', 'cd', 'cf',
    'cg', 'ch', 'ci', 'ck', 'cl', 'cm', 'cn', 'co', 'cr', 'cu', 'cv', 'cw', 'cx', 'cy',
    'cz', 'de', 'dj', 'dk', 'dm', 'do', 'dz', 'ec', 'ee', 'eg', 'eh', 'er', 'es', 'et',
    'eu', 'fi', 'fj', 'fk', 'fm', 'fo', 'fr', 'ga', 'gb', 'gd', 'ge', 'gf', 'gg', 'gh',
    'gi', 'gl', 'gm', 'gn', 'gp', 'gq', 'gr', 'gs', 'gt', 'gu', 'gw', 'gy', 'hk', 'hm',
    'hn', 'hr', 'ht', 'hu', 'id', 'ie', 'il', 'im', 'in', 'io', 'iq', 'ir', 'is', 'it',
    'je', 'jm', 'jo', 'jp', 'ke', 'kg', 'kh', 'ki', 'km', 'kn', 'kp', 'kr', 'kw', 'ky',
    'kz', 'la', 'lb', 'lc', 'li', 'lk', 'lr', 'ls', 'lt', 'lu', 'lv', 'ly', 'ma', 'mc',
    'md', 'me', 'mf', 'mg', 'mh', 'mk', 'ml', 'mm', 'mn', 'mo', 'mp', 'mq', 'mr', 'ms',
    'mt', 'mu', 'mv', 'mw', 'mx', 'my', 'mz', 'na', 'nc', 'ne', 'nf', 'ng', 'ni', 'nl',
    'no', 'np', 'nr', 'nu', 'nz', 'om', 'pa', 'pe', 'pf', 'pg', 'ph', 'pk', 'pl', 'pm',
    'pn', 'pr', 'ps', 'pt', 'pw', 'py', 'qa', 're', 'ro', 'rs', 'ru', 'rw', 'sa', 'sb',
    'sc', 'sd', 'se', 'sg', 'sh', 'si', 'sj', 'sk', 'sl', 'sm', 'sn', 'so', 'sr', 'ss',
    'st', 'su', 'sv', 'sx', 'sy', 'sz', 'tc', 'td', 'tf', 'tg', 'th', 'tj', 'tk', 'tl',
    'tm', 'tn', 'to', 'tr', 'tt', 'tv', 'tw', 'tz', 'ua', 'ug', 'uk', 'um', 'us', 'uy',
    'uz', 'va', 'vc', 've', 'vg', 'vi', 'vn', 'vu', 'wf', 'ws', 'ye', 'yt', 'za', 'zm', 'zw',
]);

let hosts = {
    iconClass: "back",
    title: "AdBlock Hosts Sort",
};

/**
 * 取分组键：从右往左吃掉公共后缀，剩下的部分作为分组名。
 * ads.example.com -> example.com；a.example.co.uk -> example.co.uk
 * 先剥掉 adblock 语法装饰（||、*.、^），但输出时仍保留原样。
 */
hosts.groupKey = function (token) {
    const domain = token
        .replace(/^\|\|/, '')
        .replace(/^\*\./, '')
        .replace(/^\.+/, '')
        .replace(/\.+$/, '');
    const labels = domain.split('.').filter(Boolean);
    if (!labels.length) return token;
    let i = labels.length - 1;
    while (i > 0 && TOP_DOMAINS.has(labels[i])) i--;
    return labels.slice(i).join('.') || token;
};

/**
 * 解析一行，返回 { host, commented } 或 null（空行 / 纯注释 / 无主机名，跳过）。
 *
 * 原来的实现在这里有个数据丢失 bug：
 * '#0.0.0.0 ads.example.com' 这种"被注释掉的规则"会被加上 '#' 前缀变成
 * '#ads.example.com'，紧接着 .split('#')[0] 又把 '#' 之后的内容整段切掉，
 * 于是变成空串 —— 规则消失，还额外产出一条空规则和一个空分组名 #[]。
 */
hosts.parseLine = function (raw) {
    const rawLine = String(raw).trim();
    if (!rawLine) return null;
    // 只有重定向地址、没有主机名：会产生空规则，直接丢弃
    if (/^#?\s*(?:0\.0\.0\.0|127\.0\.0\.1|::1?)\s*$/.test(rawLine)) return null;

    let line = rawLine;
    let commented = false;
    if (line.startsWith('#')) {
        commented = true;
        line = line.slice(1).trim();
    }

    // 去掉行内注释
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash).trim();

    // 去掉重定向地址
    const m = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+(.+)$/);
    if (m) line = m[1].trim();

    // 只取第一个字段，去掉端口 / 路径 / 行尾装饰
    line = line.split(/\s+/)[0].replace(/[\^$]+$/, '');
    if (!line || !/[a-z0-9]/i.test(line)) return null;

    return { host: line.toLowerCase(), commented };
};

hosts.sort = function () {
    const lines = String(hosts.ui.input.value).split('\n');
    const groups = new Map();
    let total = 0, skipped = 0, duplicates = 0;

    for (const raw of lines) {
        const parsed = hosts.parseLine(raw);
        if (!parsed) {
            if (raw.trim()) skipped++;
            continue;
        }
        total++;
        const key = hosts.groupKey(parsed.host);
        if (!groups.has(key)) groups.set(key, new Map());
        const bucket = groups.get(key);
        if (bucket.has(parsed.host)) {
            duplicates++;
            // 同一主机既出现"启用"又出现"注释"时，保留启用状态
            if (!parsed.commented) bucket.set(parsed.host, parsed);
            continue;
        }
        bucket.set(parsed.host, parsed);
    }

    let out = '';
    for (const key of [...groups.keys()].sort()) {
        out += `#[${key}]\n`;
        for (const { host, commented } of groups.get(key).values()) {
            out += (commented ? '#0.0.0.0 ' : '0.0.0.0 ') + host + '\n';
        }
        out += '\n';
    }

    hosts.ui.output.value = out;

    const parts = [`已整理 ${total} 条`, `分成 ${groups.size} 组`];
    if (duplicates) parts.push(`合并重复 ${duplicates} 条`);
    if (skipped) parts.push(`跳过 ${skipped} 行（空行/纯注释/无法识别）`);
    setStatus(hosts.ui.status, parts.join(' · '), total ? 'ok' : 'error');
};

hosts.clear = function () {
    hosts.ui.input.value = "";
    hosts.ui.output.value = "";
    setStatus(hosts.ui.status, "", 'info');
};

hosts.copy = function () {
    copyWithFeedback(hosts.ui.output.value, '已复制整理结果');
};

hosts.init = function (app) {
    const html = `
    <div class="card">
        <textarea class="hosts input" aria-label="粘贴 hosts 规则"></textarea>
    </div>
    <div class="row text-center">
        <button type="button" class="button" id="sort">sort</button>
        <button type="button" class="button" id="clear">clear</button>
        <button type="button" class="button" id="copy">copy</button>
    </div>
    <p class="hint" id="hostsStatus" role="status" aria-live="polite"></p>
    <div class="card">
        <textarea class="hosts output" aria-label="整理结果"></textarea>
    </div>
    `;
    if (app.main instanceof Element) {
        app.main.innerHTML = html;
        app.main.classList.add("hosts");
        hosts.ui = {
            sort: document.getElementById('sort'),
            clear: document.getElementById('clear'),
            copy: document.getElementById('copy'),
            status: document.getElementById('hostsStatus'),
            output: document.querySelector("textarea.hosts.output"),
            input: document.querySelector("textarea.hosts.input"),
        };
        hosts.ui.sort.addEventListener("click", hosts.sort);
        hosts.ui.clear.addEventListener("click", hosts.clear);
        hosts.ui.copy.addEventListener("click", hosts.copy);
    }
};

hosts.exit = function (app) {
    const ui = hosts.ui;
    if (ui) {
        ui.sort.removeEventListener("click", hosts.sort);
        ui.clear.removeEventListener("click", hosts.clear);
        ui.copy.removeEventListener("click", hosts.copy);
    }
    hosts.ui = null;
    app.main.classList.remove("hosts");
};

export { hosts as tool };
