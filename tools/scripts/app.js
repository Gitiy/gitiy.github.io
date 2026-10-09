'use strict';
const toolList = [
    {
        name: "AdBlock Hosts Sort",
        description: "sort and group adblock hosts entries",
        hash: "#hostssort",
        src: "./hosts.js",
    },
    {
        name: "FlacMate",
        description: "show a FLAC file's metadata blocks",
        hash: "#flacmate",
        src: "./flacmeta.js",
    },
    {
        name: "Password Generator",
        description: "generate random passwords with a secure RNG",
        hash: "#password-generator",
        src: "./generator.js",
    },
    {
        name: "X-APM to IFW",
        description: "convert an X-APM export into IFW rules",
        hash: "#xamp2ifw",
        src: "./ifw.js",
    },
    {
        // 独立子应用（不在本 SPA 内）：带 url 的条目直接跳转，不做 hash 路由
        name: "ScanLike",
        description: "把 PDF / Word / Excel / PPT / 图片变成逼真的扫描件，纯本地处理，可离线",
        url: "./scanlike/",
    },
];


const tools = {
    title: "Tools PWA",
    iconClass: null,
    description: "tools list",
};

const index = {
    name: "Tools PWA",
    description: "a simple tool set by Gitiy",
    hash: "#",
};

tools.createListItem = function ({ name, description, hash, src, url, rest, }) {
    // console.debug(name, description, hash, src, rest);
    let item = document.createElement("article"),
        titleNode = document.createElement("h1"),
        descriptionNode = document.createElement("p"),
        contains = document.createElement('a');
    item.appendChild(contains);
    contains.appendChild(titleNode);
    contains.appendChild(descriptionNode);

    contains.setAttribute('href', url || hash);

    item.className = "card tool-item";
    titleNode.className = "tool-name";
    descriptionNode.className = "tool-description";

    titleNode.textContent = name;
    descriptionNode.textContent = description;

    return item;
}

tools.init = function (app) {
    // console.log("tools",this, this.title);
    // console.log(app.main.childNodes);
    // app.main.childNodes.forEach((v) => { v.remove(); });
    app.main.innerHTML = '';

    let df = document.createDocumentFragment();
    for (let i of toolList) {
        let item = tools.createListItem(i);

        // 带 url 的是独立子应用，走原生跳转，不参与本 SPA 的 hash 路由
        if (!i.url) {
            item.addEventListener("click", (e) => {
                // console.log(e);
                app.route(i);
            });
        }

        df.appendChild(item);
    }
    app.main.appendChild(df);
    app.main.className = "main";
    app.main.classList.add("toollist")
};

tools.exit = function (app) {
    app.main.classList.remove("toollist")
}

let app = {
    shellName: document.querySelector(".header .header-title"),
    main: document.querySelector("main.main"),
    icon: document.querySelector("i.icon"),
};

app.route = function (route, needPushState = true) {
    // console.log(route)
    if (!route) {
        return
    }
    app.currentHash = route.hash;
    if (route.hash === '#') {
        if (app.module) {
            app.module.tool.exit(this);
        }
        if (window.location.hash !== route.hash && needPushState) {
            window.history.pushState(route, route.name, route.hash);
        }
        app.init({ tool: tools });
        return;
    }
    import(route.src).then((module) => {
        if (app.module) {
            app.module.tool.exit(this);
        }
        if (window.location.hash !== route.hash && needPushState) {
            window.history.pushState(route, route.name, route.hash);
        }
        app.init(module);
    }).catch((err) => {
        // 模块加载失败（离线且未缓存、404 等）时原来完全静默，界面停在上一个工具
        console.error('加载工具模块失败', route.src, err);
        app.main.innerHTML = '';
        const tip = document.createElement('article');
        tip.className = 'card error-card';
        const p = document.createElement('p');
        p.textContent = `无法加载「${route.name}」：${err.message}。若是离线状态，请先联网打开一次。`;
        tip.appendChild(p);
        app.main.appendChild(tip);
    });
}

app.init = function (module) {
    // console.log(this, module);
    app.module = module;
    document.title = module.tool.title;
    this.shellName.textContent = module.tool.title;
    this.icon.className = "icon";
    if (module.tool.iconClass) {
        this.icon.classList.add(module.tool.iconClass);
    }
    module.tool.init(this);
}

window.addEventListener("popstate", (e) => {
    // console.log(e.state);
    app.route(e.state, false);
}, false);

// 直接改地址栏的 hash（或从外部链接进入）原来不会切换工具，
// 因为只有 popstate 和首屏 readystatechange 两个入口
window.addEventListener("hashchange", () => {
    if (location.hash === app.currentHash) return;   // 由 app.route 自己触发的，忽略
    const i = toolList.findIndex((x) => x.hash === location.hash);
    if (i !== -1) {
        app.route(toolList[i], false);
    } else if (!location.hash) {
        app.route(index, false);
    }
}, false);

app.icon.addEventListener("click", (e) => {
    if (app.icon.classList.contains("back")) {
        history.back();
    }
}, false);

document.addEventListener('readystatechange', (e) => {
    if (document.readyState === 'complete') {
        console.log('readystatechange:', location.hash)
        const i = toolList.findIndex(x => x.hash === location.hash)
        if (i !== -1) {
            app.route(toolList[i], false);
        } else {
            app.route(index);
            // app.init({tool:tools});
        }
    }
})

// window.addEventListener('load', (e) => {
//     console.log('load:', location.hash)
// })

window.addEventListener("load", function (e) {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker
            .register('service-worker.js')
            .then((registion) => { console.log('Service Worker Registered', registion.scope); });
    }
}, false);
// export { tools as tool };