const toolList = [
    {
        name: "AdBolck Hosts Sort",
        description: "a simple tool to sort adblock hosts items",
        hash: "hostssort",
        src: "./hosts.js",
    },
    {
        name: "FlacMate",
        description: "a simple tool to show flac's matedata",
        hash: "flacmate",
        src: "./flacmeta.js",
    },
    {
      name: "Password Generator",
      description:"a simple tool to generator password",
      hash:"password-generator",
      src:"./generator.js",
    },
];

let tools = {
    title: "Tools",
    iconClass: null,
    description: "tools list",
};

tools.createListItem = function ({ name, description, hash, src, ...rest }) {
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

tools.exit = function(app){
    app.main.classList.remove("toollist")
}

export { tools as tool };
