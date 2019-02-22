let ifw = {
    iconClass: "back",
    title: "X-APM to IFW",
}
ifw.gen_rules = function (component) {
    try {
        var apm = JSON.parse(this.ui.input.value);
        let xmlDoc = null
        if (this.ui.output.value) {
            xmlDoc = new DOMParser().parseFromString(this.ui.output.value, 'text/xml');
            // xmlDoc = xmlDoc.children[0];
        } else {
            // xmlDoc = new DOMParser().parseFromString(`<rules>\n\t<${component} block="true" log="true">\n\t</${component}>\n</rules>`, "text/xml");
            xmlDoc = document.implementation.createDocument(null, "rules");
        }

        let componentNode = null;
        const filterRes = Array.prototype.filter.call(xmlDoc.children[0].children, (x) => x.nodeName === component);
        if (filterRes.length === 0) {
            componentNode = xmlDoc.createElement(component);
            componentNode.setAttribute("block", true);
            componentNode.setAttribute("log", true);
            xmlDoc.documentElement.insertAdjacentText("beforeEnd", "\n\t");
            xmlDoc.documentElement.insertAdjacentElement("beforeEnd", componentNode);
            xmlDoc.documentElement.insertAdjacentText("beforeEnd", "\n");
        } else {
            componentNode = filterRes[0];
        }


        for (let i of apm.exports) {
            // console.log(i.allowed);
            if (!i.allowed) {
                let name = `${i.componentName.mPackage}/${i.componentName.mClass}`;
                
                if (Array.prototype.some.call(componentNode.children, (x) => x.attributes.getNamedItem("name").value === name)) {
                    continue;
                }
                let item = xmlDoc.createElement("component-filter");
                item.setAttribute("name", name);
                componentNode.insertAdjacentText("beforeEnd", "\n\t\t");
                componentNode.insertAdjacentElement("beforeEnd", item);
                componentNode.insertAdjacentText("beforeEnd", "\n\t");
            }
        }



        // console.log(xmlDoc.children[0].children, xmlDoc.childNodes[0].childNodes);
        this.ui.output.value = xmlDoc.querySelector("rules").outerHTML;

    } catch (e) {
        console.log(e);
    }
}


ifw.clear = function (e) {
    ifw.ui.input.value = "";
    ifw.ui.output.value = "";
}

ifw.copy = function (e) {
    let currentFocus = document.activeElement;
    let textField = ifw.ui.output;
    textField.focus();
    textField.setSelectionRange(0, textField.value.length);
    document.execCommand("copy", true);
    textField.setSelectionRange(0, 0);
    currentFocus.focus();
}


ifw.init = function (app) {
    // console.log(this, this.title);
    const html = `
    <div class="card">
        <textarea id="input" class="hosts"></textarea>
    </div>
    <div class="row text-center">
        <span class="button" id="service">service</span>
        <span class="button" id="broadcast">broadcast</span>
        <span class="button" id="activity">activity</span>
        <span class="button" id="copy">copy</span>
        <span class="button" id="clear">clear</span>
    </div>
    <div class="card">
        <textarea id="output" class="hosts"></textarea>
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
            output: document.getElementById("output"),
            input: document.getElementById("input"),
        }
        ifw.ui.service.addEventListener("click", e => ifw.gen_rules.call(this, "service"), false);
        ifw.ui.broadcast.addEventListener("click", e => ifw.gen_rules.call(this, "broadcast"), false);
        ifw.ui.activity.addEventListener("click", e => ifw.gen_rules.call(this, "activity"), false);
        ifw.ui.clear.addEventListener("click", ifw.clear, false);
        ifw.ui.copy.addEventListener("click", ifw.copy, false);
    }

}

ifw.exit = function (app) {
    ifw.ui.clear.removeEventListener("click", ifw.clear);
    ifw.ui.copy.removeEventListener("click", ifw.copy);
    app.main.classList.remove("ifw");
}

export { ifw as tool };
