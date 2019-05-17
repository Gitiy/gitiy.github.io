'use strict';
const toolList = [
    {
        name: "AdBolck Hosts Sort",
        description: "a simple tool to sort adblock hosts items",
        hash: "#hostssort",
        src: "./hosts.js",
    },
    {
        name: "FlacMate",
        description: "a simple tool to show flac's matedata",
        hash: "#flacmate",
        src: "./flacmeta.js",
    },
    {
        name: "Password Generator",
        description: "a simple tool to generator password",
        hash: "#password-generator",
        src: "./generator.js",
    },
    {
        name: "X-AMP To IFW",
        description: "a simple tool to convert X-APM config to IFW",
        hash: "#xamp2ifw",
        src: "./ifw.js",
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

tools.createListItem = function ({ name, description, hash, src, rest, }) {
    // console.debug(name, description, hash, src, rest);
    let item = document.createElement("article"),
        titleNode = document.createElement("h1"),
        descriptionNode = document.createElement("p");
    item.appendChild(titleNode);
    item.appendChild(descriptionNode);

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

        item.addEventListener("click", (e) => {
            // console.log(e);
            app.route(i);
        });

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