const topDomain = ["top", "com", "xyz", "xin", "vip", "win", "red", "com", "com", "net", "org", "wang", "gov", "edu", "mil", "co", "biz", "name", "info", "mobi", "pro", "travel", "club", "museum", "int", "aero", "post", "rec", "asia", "au", "ad", "ae", "af", "ag", "ai", "al", "am", "an", "ao", "aa", "ar", "as", "at", "au", "aw", "az", "ba", "bb", "bd", "be", "bf", "bg", "bh", "bi", "bj", "bm", "bn", "bo", "br", "bs", "bt", "bv", "bw", "by", "bz", "ca", "cc", "cf", "cd", "ch", "ci", "ck", "cl", "cm", "cn", "co", "cq", "cr", "cu", "cv", "cx", "cy", "cz", "de", "dj", "dk", "dm", "do", "dz", "ec", "ee", "eg", "eh", "er", "es", "et", "ev", "fi", "fj", "fk", "fm", "fo", "fr", "ga", "gd", "ge", "gf", "gg", "gh", "gi", "gl", "gm", "gn", "gp", "gr", "gs", "gt", "gu", "gw", "gy", "hk", "hm", "hn", "hr", "ht", "hu", "id", "ie", "il", "im", "in", "io", "iq", "ir", "is", "it", "jm", "jo", "jp", "je", "ke", "kg", "kh", "ki", "km", "kn", "kp", "kr", "kw", "ky", "kz", "la", "lb", "lc", "li", "lk", "lr", "ls", "lt", "lu", "lv", "ly", "ma", "mc", "md", "me", "mg", "mh", "mk", "ml", "mm", "mn", "mo", "mp", "mq", "mr", "ms", "mt", "mu", "mv", "mw", "mx", "my", "mz", "na", "nc", "ne", "nf", "ng", "ni", "nl", "no", "np", "nr", "nt", "nu", "nz", "om", "qa", "pa", "pe", "pf", "pg", "ph", "pk", "pl", "pm", "pn", "pr", "pt", "pw", "py", "re", "rs", "ro", "ru", "rw", "sa", "sb", "sc", "sd", "se", "sg", "sh", "si", "sj", "sk", "sl", "sm", "sn", "so", "sr", "st", "sv", "su", "sy", "sz", "sx", "tc", "td", "tf", "tg", "th", "tj", "tk", "tl", "tm", "tn", "to", "tr", "tt", "tv", "tw", "tz", "ua", "ug", "uk", "um", "us", "uy", "uz", "va", "vc", "ve", "vg", "vi", "vn", "vu", "wf", "ws", "ye", "yt", "za", "zm", "zw", "arts", "com", "edu", "firm", "gov", "info", "net", "nom", "org", "rec", "store", "web"];


let hosts = {
    iconClass: "back",
    title: "Adblock Hosts Sort",
}

hosts.sort = function (e) {
    let res = {};
    let domains = hosts.ui.input.value;
    let ds = domains.split('\n');

    ds.forEach(function (value, index, arr) {
        if (value.startsWith('0.0.0.0') || value.startsWith('127.0.0.1')) {
            value = value.split(/0\.0\.0\.0\s*|127\.0\.0\.1\s*/)[1];
        } else {
            if (value.startsWith('#0.0.0.0') || value.startsWith('#127.0.0.1')) {
                value = "#" + value.split(/0\.0\.0\.0\s*|127\.0\.0\.1\s*/)[1];
            } else {
                if (value.startsWith('#') || value.trim() === "") {
                    return;
                }
            }
        }
        value = value.split('#')[0].trim()
        let temp = value.split('.');
        var key = "";
        for (var i = temp.length - 1; i >= 0; i--) {
            if (topDomain.includes(temp[i])) {
                i != 0 ? key = "." + temp[i] + key : key = temp[i] + key;
            } else {
                key = temp[i] + key;
                break;
            }
        }
        //console.log(key);

        key in res ? res[key].includes(value) ? console.warn("duplicate: " + value) : res[key].push(value) : res[key] = [value];
    });

    let out = "";
    Object.keys(res).sort().forEach(function (value, index, arr) {
        // console.log(value);
        out += `#[${value}]\n`
        res[value].forEach(function (v, i, a) {
            v.startsWith('#') ? out += "#0.0.0.0 " : out += "0.0.0.0 ";
            out += v.split('#').pop() + '\n'
        });
        out += '\n'
        // out += ("#[" + value +"]\n0.0.0.0 " + res[value].join('\n0.0.0.0 ') + '\n\n');
    });
    hosts.ui.output.value = out;
}
hosts.clear = function (e) {
    hosts.ui.input.value = "";
    hosts.ui.output.value = "";
}

hosts.copy = function (e) {
    let currentFocus = document.activeElement;
    let textField = document.querySelector("textarea.hosts.output");
    textField.focus();
    textField.setSelectionRange(0, textField.value.length);
    document.execCommand("copy", true);
    textField.setSelectionRange(0, 0);
    currentFocus.focus();
}

hosts.init = function (app) {
    // console.log(this, this.title);
    const html = `    
    <div class="card">
        <textarea class="hosts input"></textarea>
    </div>
    <div class="row text-center">
        <span class="button" id="sort">Sort</span>
        <span class="button" id="clear">Clear</span>
        <span class="button" id="copy">Copy</span>
    </div>
    <div class="card">
        <textarea class="hosts output"></textarea>
    </div>
    `;
    if (app.main instanceof Element) {
        app.main.innerHTML = html;
        app.main.classList.add("hosts");
        hosts.ui = {
            sort: document.getElementById('sort'),
            clear: document.getElementById('clear'),
            copy: document.getElementById('copy'),
            output: document.querySelector("textarea.hosts.output"),
            input: document.querySelector("textarea.hosts.input"),
        }
        hosts.ui.sort.addEventListener("click", hosts.sort, false);
        hosts.ui.clear.addEventListener("click", hosts.clear, false);
        hosts.ui.copy.addEventListener("click", hosts.copy, false);
    }

}

hosts.exit = function (app) {
    hosts.ui.sort.removeEventListener("click", hosts.sort);
    hosts.ui.clear.removeEventListener("click", hosts.clear);
    hosts.ui.copy.removeEventListener("click", hosts.copy);
    app.main.classList.remove("hosts");
}

export { hosts as tool };
