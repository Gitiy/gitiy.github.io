(function () {
    'use strict';
    const index = {
        name: "Tools PWA",
        description: "a simple tool set by Gitiy",
        hash: "#",
        src: "./index.js",
    };

    let app = {
        shellName: document.querySelector(".header .header-title"),
        main: document.querySelector("main.main"),
        icon: document.querySelector("i.icon"),
    };

    app.route = function (route, needPushState = true) {
        console.log(route)
        if(!route){
            return
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

    // import("./index.js").then((module) => {
    //     app.init(module);
    // });
    app.route(index);

    window.addEventListener("popstate", (e) => {
        // console.log(e.state);
        app.route(e.state, false);
    }, false);

    app.icon.addEventListener("click", (e) => {
        if (app.icon.classList.contains("back")) {
            history.back();
        }
    }, false);

    window.addEventListener("load", function (e) {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker
                .register('service-worker.js')
                .then((registion) => { console.log('Service Worker Registered', registion.scope); });
        }
    }, false);

})();
