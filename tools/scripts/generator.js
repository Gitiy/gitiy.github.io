let generator = {
    iconClass: "back",
    title: "Password Generator",
};

const data = {
    digital: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
    lower: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"],
    upper: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"],
    special: ["~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+"],
},
    localStorageKey = "records";


generator.gen = function (min, max) {

    min = parseInt(min);
    max = parseInt(max);

    //可以生成随机密码的相关数组
    var config = []
    var arr = [];
    // Object.keys(data).forEach((v, i, a) => (config = config.concat(data[v])));

    //先放入一个必须存在的
    Object.entries(generator.ui).map(([k, v], i, raw) => {
        if (!(v instanceof HTMLInputElement)) {
            return;
        }
        if (v.checked) {
            config = config.concat(data[k]);
            //随机从数组中抽出一个
            arr.push((arr => arr[Math.floor(Math.random() * arr.length)])(data[k]))
        }
    });
    // console.log(config,arr);

    //获取需要生成的长度
    var len = min + Math.floor(Math.random() * (max - min + 1));
    console.log(min, "~", max, ":", len);

    for (var i = 4; i < len; i++) {
        //从数组里面抽出一个
        arr.push(config[Math.floor(Math.random() * config.length)]);
    }

    //乱序
    var newArr = [];
    for (var j = 0; j < len; j++) {
        newArr.push(arr.splice(Math.random() * arr.length, 1)[0]);
    }

    const record = newArr.join("");
    document.querySelector(".flex-row.flex-full.password-generatored").innerText = record;
    generator.addRecord(record);
    return record;
}

generator.copy = function (text, e) {
    let textField = document.createElement("input");
    let currentFocus = document.activeElement;
    textField.style.cssText = "position: fixed; z-index: -2;";
    document.body.appendChild(textField);
    textField.value = text;
    textField.focus();
    textField.setSelectionRange(0, textField.value.length);
    document.execCommand("copy", true);
    console.log("已复制", text);
    currentFocus.focus();
    textField.remove();
}

generator.addRecordUI = function (index, record) {
    let con = document.createElement("article"),
        entry = document.createElement("span"),
        copyBtn = document.createElement("span"),
        delBtn = document.createElement("span");

    con.className = "card flex-row";
    entry.className = "password-entry flex-full";
    copyBtn.className = "button justify-self-end";
    delBtn.className = "button justify-self-end";

    entry.textContent = record;
    copyBtn.textContent = "COPY";
    delBtn.textContent = "DEL";

    con.setAttribute('data-index', index)

    copyBtn.addEventListener("click", e => generator.copy.call(con, record, e), false);
    delBtn.addEventListener("click", e => generator.removeRecord.call(con, index, record), false)
    con.appendChild(entry);
    con.appendChild(copyBtn);
    con.appendChild(delBtn);

    generator.ui.panel.insertAdjacentElement('afterend', con);
}

generator.removeRecord = function (index, record) {
    let records = JSON.parse(localStorage.getItem(localStorageKey));
    if (!records || !(records instanceof Array)) {
        records = [];
        return;
    }
    if (records[index] = record) {
        delete records[index];
        records = records.filter(x => x);
        localStorage.setItem(localStorageKey, JSON.stringify(records));
        console.info("del:", record);
        this.remove();
    } else {
        console.log("NOT FOUND:", record);
    }

}

generator.addRecord = function (record) {
    let records = JSON.parse(localStorage.getItem(localStorageKey));

    if (!records || !(records instanceof Array)) {
        records = [];
    }
    generator.addRecordUI(records.length, record);
    records.push(record)
    console.log(JSON.stringify(records))
    localStorage.setItem(localStorageKey, JSON.stringify(records));

}

generator.listRecords = function () {
    let records = JSON.parse(localStorage.getItem(localStorageKey));
    for (let i in records) {
        generator.addRecordUI(i, records[i]);
    }
}

generator.init = function (app) {
    const html = `<article class="card">
    <div class="grid justify-content-center">
        <label for="upper"><input type="checkbox" checked id="upper"><span class="button">[A-Z]</span></label>
        <label for="lower"><input type="checkbox" checked id="lower"><span class="button">[a-z]</span></label>
        <label for="digital"><input type="checkbox" checked id="digital"><span class="button">[0-9]</span></label>
        <label for="special" title='~, !, @, #, $, %, ^, &, *, (, ), _, +'><input type="checkbox" checked id="special"><span class="button">[special]</span></label>
    </div>
    <div class="flex-row flex-full justify-content-center password-generatored">点击Gen生成密码</div>
    <div class="flex-row justify-content-end align-items-center">
        <span class="password-range">
            <input type="number" id="min" min=6 value="12" placeholder="min">
            - 
            <input type="number" id="max" min=6 value="20" placeholder="max">
        </span>
        <span id="gen" class="button">gen</span>
        <span id="copy" class="button">copy</span>
    </div>
</article>`;

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
            panel: document.querySelector('main.password-generator>.card'),
            currentPassword: document.querySelector(".password-generatored"),
        };

        generator.ui.btn.addEventListener("click", (e) => generator.gen.call(generator,
            generator.ui.min.value, generator.ui.max.value), false);

        generator.ui.copy.addEventListener("click", (e) => generator.copy.call(generator.ui.panel,
            generator.ui.currentPassword.textContent, e), false)

        generator.listRecords();
    }
}
generator.exit = function(app){
    app.main.classList.remove("password-generator");
}


export { generator as tool }