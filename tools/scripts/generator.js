import { copyWithFeedback, toast } from './ui.js';

let generator = {
    iconClass: "back",
    title: "Password Generator",
};

const data = {
    digital: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
    lower: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"],
    upper: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"],
    special: ["~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+"],
};

const LS_KEY = "records";
const LEN_MIN = 4;
const LEN_MAX = 128;

/* ---------------------------------------------------------- 安全随机 */

const hasSecureRandom = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
let warnedInsecure = false;

/** 返回 [0, maxExclusive) 的随机整数。用拒绝采样避免取模偏置。 */
function randomInt(maxExclusive) {
    if (maxExclusive <= 1) return 0;
    if (!hasSecureRandom) {
        // 密码生成器不该用可预测的随机源，这里只作为兜底并明确告警
        if (!warnedInsecure) {
            warnedInsecure = true;
            toast('当前环境不支持安全随机数，已退化为弱随机', 'error');
        }
        return Math.floor(Math.random() * maxExclusive);
    }
    const range = 0x100000000;
    const limit = range - (range % maxExclusive);
    const buf = new Uint32Array(1);
    let v;
    do {
        crypto.getRandomValues(buf);
        v = buf[0];
    } while (v >= limit);
    return v % maxExclusive;
}

const pick = (arr) => arr[randomInt(arr.length)];

/** Fisher-Yates 洗牌（原地） */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/* ---------------------------------------------------------- 生成 */

generator.readOptions = function () {
    const ui = generator.ui;
    const sets = [];
    for (const key of ['upper', 'lower', 'digital', 'special']) {
        if (ui[key] && ui[key].checked) sets.push({ key, chars: data[key] });
    }

    let min = parseInt(ui.min.value, 10);
    let max = parseInt(ui.max.value, 10);
    if (!Number.isFinite(min)) min = 12;
    if (!Number.isFinite(max)) max = Math.max(min, 20);
    if (min > max) [min, max] = [max, min];          // 原来的实现没管 min > max
    min = Math.min(Math.max(min, LEN_MIN), LEN_MAX);
    max = Math.min(Math.max(max, LEN_MIN), LEN_MAX);

    return { sets, min, max };
};

generator.gen = function () {
    const { sets, min, max } = generator.readOptions();

    if (!sets.length) {
        // 原来这里会静默返回空密码，还把它存进历史记录
        toast('请至少勾选一种字符类型', 'error');
        generator.ui.currentPassword.textContent = '请至少勾选一种字符类型';
        return null;
    }

    // 长度要在 [min, max] 内随机，但不能短于"每种字符各取一个"的个数
    const len = Math.max(sets.length, min + randomInt(max - min + 1));

    // 每种勾选的字符类型至少出现一次
    const arr = sets.map((s) => pick(s.chars));
    // 其余位置从合并后的字符池里取（原来是写死的 i = 4，
    // 只勾 1~3 种类型时长度会偏短）
    const pool = sets.flatMap((s) => s.chars);
    while (arr.length < len) arr.push(pick(pool));

    const record = shuffle(arr).join("");
    generator.ui.currentPassword.textContent = record;
    generator.addRecord(record);
    return record;
};

/* ---------------------------------------------------------- 历史记录 */

/** 读取历史记录，兼容旧格式（纯字符串数组） */
function loadRecords() {
    let raw;
    try {
        raw = JSON.parse(localStorage.getItem(LS_KEY));
    } catch {
        raw = null;
    }
    if (!Array.isArray(raw)) return [];
    return raw
        .map((r, i) => (typeof r === "string" ? { id: "old" + i, value: r } : r))
        .filter((r) => r && typeof r.value === "string");
}

function saveRecords(records) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(records));
    } catch { /* 隐私模式下可能写不了，忽略 */ }
}

let nextId = Date.now();

generator.addRecord = function (record) {
    const records = loadRecords();
    records.unshift({ id: "r" + (++nextId), value: record });   // 新的在最前
    saveRecords(records);
    generator.renderRecords();
};

/**
 * 删除一条记录。
 * 原来按数组下标删除（data-index），删除后不重排，下标就失效了；
 * 而且 `if (records[index] = record)` 是赋值不是比较，会删错条目。
 * 现在用稳定 id。
 */
generator.removeRecord = function (id) {
    const records = loadRecords();
    const next = records.filter((r) => r.id !== id);
    if (next.length === records.length) {
        toast('这条记录已经不存在了', 'error');
    }
    saveRecords(next);
    generator.renderRecords();
};

generator.clearRecords = function () {
    saveRecords([]);
    generator.renderRecords();
};

generator.renderRecords = function () {
    const host = generator.ui.recordList;
    if (!host) return;
    host.replaceChildren();
    const records = loadRecords();
    for (const r of records) {
        const con = document.createElement("article");
        const entry = document.createElement("span");
        const copyBtn = document.createElement("button");
        const delBtn = document.createElement("button");

        con.className = "card flex-row";
        entry.className = "password-entry flex-full";
        copyBtn.type = "button";
        delBtn.type = "button";
        copyBtn.className = "button justify-self-end";
        delBtn.className = "button justify-self-end";

        entry.textContent = r.value;
        copyBtn.textContent = "COPY";
        delBtn.textContent = "DEL";
        copyBtn.setAttribute("aria-label", "复制这条密码");
        delBtn.setAttribute("aria-label", "删除这条密码");

        copyBtn.addEventListener("click", () => copyWithFeedback(r.value, '已复制'));
        delBtn.addEventListener("click", () => generator.removeRecord(r.id));

        con.append(entry, copyBtn, delBtn);
        host.append(con);
    }
    if (generator.ui.emptyHint) {
        generator.ui.emptyHint.hidden = records.length > 0;
    }
};

/* ---------------------------------------------------------- UI */

generator.init = function (app) {
    const html = `<article class="card">
    <div class="grid justify-content-center">
        <label for="upper"><input type="checkbox" checked id="upper"><span class="button">[A-Z]</span></label>
        <label for="lower"><input type="checkbox" checked id="lower"><span class="button">[a-z]</span></label>
        <label for="digital"><input type="checkbox" checked id="digital"><span class="button">[0-9]</span></label>
        <label for="special" title='~, !, @, #, $, %, ^, &amp;, *, (, ), _, +'><input type="checkbox" checked id="special"><span class="button">[special]</span></label>
    </div>
    <div class="flex-row flex-full justify-content-center password-generatored" role="status" aria-live="polite">点击 Gen 生成密码</div>
    <div class="flex-row justify-content-end align-items-center">
        <span class="password-range">
            <label class="visually-hidden" for="min">最小长度</label>
            <input type="number" id="min" min="4" max="128" value="12" placeholder="min">
            -
            <label class="visually-hidden" for="max">最大长度</label>
            <input type="number" id="max" min="4" max="128" value="20" placeholder="max">
        </span>
        <button type="button" id="gen" class="button">gen</button>
        <button type="button" id="copy" class="button">copy</button>
    </div>
</article>
<section class="record-list" id="recordList" aria-label="历史记录"></section>
<p class="hint" id="recordHint">生成过的密码会保存在本机浏览器里（明文存储，请勿在公共设备上使用）。</p>`;

    if (app.main instanceof Element) {
        app.main.innerHTML = html;
        app.main.classList.add("password-generator");

        generator.ui = {
            digital: document.getElementById("digital"),
            lower: document.getElementById("lower"),
            upper: document.getElementById("upper"),
            special: document.getElementById("special"),
            min: document.getElementById("min"),
            max: document.getElementById("max"),
            btn: document.getElementById("gen"),
            copy: document.getElementById("copy"),
            currentPassword: document.querySelector(".password-generatored"),
            recordList: document.getElementById("recordList"),
            emptyHint: document.getElementById("recordHint"),
        };

        generator.onGen = () => generator.gen();
        generator.onCopy = () => {
            const text = generator.ui.currentPassword.textContent;
            if (!text || /请至少勾选|点击 Gen/.test(text)) {
                toast('还没有可复制的密码', 'error');
                return;
            }
            copyWithFeedback(text, '已复制');
        };

        generator.ui.btn.addEventListener("click", generator.onGen);
        generator.ui.copy.addEventListener("click", generator.onCopy);
        generator.renderRecords();
    }
};

generator.exit = function (app) {
    const ui = generator.ui;
    if (ui) {
        ui.btn.removeEventListener("click", generator.onGen);
        ui.copy.removeEventListener("click", generator.onCopy);
    }
    generator.ui = null;
    app.main.classList.remove("password-generator");
};

export { generator as tool };
