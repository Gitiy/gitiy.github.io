import { copyWithFeedback, setStatus } from './ui.js';

let ifw = {
    iconClass: "back",
    title: "X-APM to IFW",
};

/** 已有规则里是否已经存在同名 component-filter（属性缺失时不能直接取 .value） */
function hasFilter(node, name) {
    return Array.prototype.some.call(node.children, (x) => {
        const attr = x.attributes && x.attributes.getNamedItem("name");
        return !!attr && attr.value === name;
    });
}

ifw.gen_rules = function (component) {
    const ui = ifw.ui;

    let apm;
    try {
        apm = JSON.parse(ui.input.value);
    } catch (err) {
        // 原来这里只写 console，界面上毫无反应，用户会以为按钮坏了
        setStatus(ui.status, `输入的 JSON 无法解析：${err.message}`, 'error');
        return;
    }

    if (!apm || !Array.isArray(apm.exports)) {
        setStatus(ui.status, 'JSON 里没有 exports 数组，请确认粘贴的是 X-APM 导出的配置', 'error');
        return;
    }

    let xmlDoc;
    const existing = ui.output.value.trim();
    if (existing) {
        xmlDoc = new DOMParser().parseFromString(existing, 'text/xml');
        if (xmlDoc.querySelector('parsererror') || !xmlDoc.querySelector('rules')) {
            setStatus(ui.status, '输出区的 XML 无法解析，已改为新建一份规则文档', 'error');
            xmlDoc = document.implementation.createDocument(null, "rules");
        }
    } else {
        xmlDoc = document.implementation.createDocument(null, "rules");
    }

    const root = xmlDoc.querySelector("rules");
    let componentNode = Array.prototype.find.call(
        root.children, (x) => x.nodeName === component
    );

    if (!componentNode) {
        componentNode = xmlDoc.createElement(component);
        componentNode.setAttribute("block", true);
        componentNode.setAttribute("log", true);
        root.insertAdjacentText("beforeEnd", "\n\t");
        root.insertAdjacentElement("beforeEnd", componentNode);
        root.insertAdjacentText("beforeEnd", "\n");
    }

    let added = 0, existed = 0, allowed = 0;
    for (const item of apm.exports) {
        if (item && item.allowed) { allowed++; continue; }
        const cn = item && item.componentName;
        if (!cn || !cn.mPackage || !cn.mClass) continue;
        const name = `${cn.mPackage}/${cn.mClass}`;

        // 原来这里写的是 x.attributes.getNamedItem("name").value：
        // 只要已有一条缺 name 属性的规则就抛 TypeError，被 catch 吞掉，
        // 结果是新规则一条都没追加，用户完全不知道发生了什么
        if (hasFilter(componentNode, name)) { existed++; continue; }

        const el = xmlDoc.createElement("component-filter");
        el.setAttribute("name", name);
        componentNode.insertAdjacentText("beforeEnd", "\n\t\t");
        componentNode.insertAdjacentElement("beforeEnd", el);
        componentNode.insertAdjacentText("beforeEnd", "\n\t");
        added++;
    }

    ui.output.value = root.outerHTML;

    const parts = [`新增 ${added} 条 ${component} 规则`];
    if (existed) parts.push(`已存在 ${existed} 条`);
    parts.push(`跳过 allowed 项 ${allowed} 条`);
    setStatus(ui.status, parts.join(' · '), 'ok');
};

ifw.clear = function () {
    ifw.ui.input.value = "";
    ifw.ui.output.value = "";
    setStatus(ifw.ui.status, "", 'info');
};

ifw.copy = function () {
    copyWithFeedback(ifw.ui.output.value, '已复制 IFW 规则');
};

ifw.init = function (app) {
    const html = `
    <div class="card">
        <textarea id="input" class="hosts" aria-label="粘贴 X-APM 导出的 JSON" placeholder='{"exports":[{"allowed":false,"componentName":{"mPackage":"com.foo","mClass":"Bar"}}]}'></textarea>
    </div>
    <div class="row text-center">
        <button type="button" class="button" id="service">service</button>
        <button type="button" class="button" id="broadcast">broadcast</button>
        <button type="button" class="button" id="activity">activity</button>
        <button type="button" class="button" id="copy">copy</button>
        <button type="button" class="button" id="clear">clear</button>
    </div>
    <p class="hint" id="ifwStatus" role="status" aria-live="polite"></p>
    <div class="card">
        <textarea id="output" class="hosts" aria-label="生成的 IFW 规则"></textarea>
    </div>
    `;
    if (app.main instanceof Element) {
        app.main.innerHTML = html;
        app.main.classList.add("ifw");
        ifw.ui = {
            service: document.getElementById('service'),
            broadcast: document.getElementById('broadcast'),
            activity: document.getElementById('activity'),
            clear: document.getElementById('clear'),
            copy: document.getElementById('copy'),
            status: document.getElementById('ifwStatus'),
            output: document.getElementById("output"),
            input: document.getElementById("input"),
        };

        // 原来用 `e => ifw.gen_rules.call(this, ...)`，依赖 init 的 this 恰好是工具对象；
        // 直接调用更直观
        ifw.onService = () => ifw.gen_rules('service');
        ifw.onBroadcast = () => ifw.gen_rules('broadcast');
        ifw.onActivity = () => ifw.gen_rules('activity');

        ifw.ui.service.addEventListener("click", ifw.onService);
        ifw.ui.broadcast.addEventListener("click", ifw.onBroadcast);
        ifw.ui.activity.addEventListener("click", ifw.onActivity);
        ifw.ui.clear.addEventListener("click", ifw.clear);
        ifw.ui.copy.addEventListener("click", ifw.copy);
    }
};

ifw.exit = function (app) {
    const ui = ifw.ui;
    if (ui) {
        // 原来 exit 只移除了 clear/copy，三个生成按钮的监听全部残留
        ui.service.removeEventListener("click", ifw.onService);
        ui.broadcast.removeEventListener("click", ifw.onBroadcast);
        ui.activity.removeEventListener("click", ifw.onActivity);
        ui.clear.removeEventListener("click", ifw.clear);
        ui.copy.removeEventListener("click", ifw.copy);
    }
    ifw.ui = null;
    app.main.classList.remove("ifw");
};

export { ifw as tool };
