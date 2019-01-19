//https://xiph.org/flac/format.html#metadata_block_header
//https://blog.csdn.net/yu_yuan_1314/article/details/9491763

let flac = {
    iconClass: "back",
    title: "Flac Meta",
};

class MetaFlac {
    constructor(flac) {
        this.metas = [];
        this.getFileArrayBuffer(flac).then((arrayBuffer) => {
            this._flac = arrayBuffer;
            //console.log(this._flac);
            if (String.fromCharCode.apply(null, new Int8Array(this._flac.slice(0, 4))) != "fLaC") {
                console.info("no a flac file");
                return new Error("Not A Flac file");
            }
            return this._flac;
        }).then((buf) => {
            let cur = 4,
                dv = new DataView(buf),
                header = dv.getInt32(cur),
                metaIndex = 0,
                res = null;

            while ((header & 0x80000000) >> 31 == 0) {
                cur += 4; // header size
                let type = (header & 0x7f000000) >> 24;
                let size = header & 0x00ffffff;

                switch (type) {
                    case 0:
                    case 3:
                    case 4:
                    case 6:
                        // MetaFlac.METADATA_BLOCK_STREAMINFO(buf.slice(cur,cur + size));
                        // console.log(type,  MetaFlac.METADATA_BLOCK_HEADER_TYPE[parseInt(type)]);
                        console.log(`%cMetadata Block #${metaIndex}, size: ${size}`, "color:blue;");
                        res = MetaFlac.METADATA_BLOCK_HEADER_TYPE[type](buf.slice(cur, cur + size), false, size);
                        res.meta['size'] = size;
                        res.meta['index'] = metaIndex;
                        this.metas.push(res);
                        //for(let i in res.tips){
                        //     console.log(res.tips[i](res.data[i]));
                        // }
                        break;
                    default:
                        // console.log(new Int8Array(buf.slice(cur,cur + size)));
                        console.log(`%cMetadata Block #${metaIndex}, size: ${size}, type:${getMetaHeaderType(type)}`
                            , "color:blue;");
                }
                metaIndex++;

                cur += size;
                header = dv.getInt32(cur);
            }
        }).catch((e) => {
            console.log(e)
            return e;
        }).finally(() => {
            console.log(this.metas);
        });

        // console.log(this._flac);
    }

    getMeta() {
        console.log("getMeta:")
        // METADATA_BLOCK_STREAMINFO()
    }
    static get METADATA_BLOCK_HEADER_TYPE() {
        return [MetaFlac.METADATA_BLOCK_STREAMINFO,
            null,
            null,
        MetaFlac.METADATA_BLOCK_SEEKTABLE,
        MetaFlac.METADATA_BLOCK_VORBIS_COMMENT,
            null,
        MetaFlac.METADATA_BLOCK_PICTURE];
    }
    getFileArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            if (file instanceof File) {
                let reader = new FileReader();
                reader.onload = ((e) => resolve(e.target.result));
                reader.readAsArrayBuffer(file);
            } else {
                if (file instanceof ArrayBuffer) {
                    resolve(file);
                }
            }
        });
    }

    static METADATA_BLOCK_STREAMINFO(buf, isLast, length) {
        console.log(`Type: 0 (STREAMINFO)`);
        let res = {
            "stylized": {
                "tips": [
                    (x = null) => `type: ${x}`,
                    (x = null) => `is last: ${x}`,
                    (x = null) => `length: ${x}`,
                    (x = null) => `minimum blocksize: ${x}`,
                    (x = null) => `maximum blocksize: ${x}`,
                    (x = null) => `minimum framesize: ${x}`,
                    (x = null) => `maximum framesize: ${x}`,
                    (x = null) => `sample_rate: ${x} Hz`,
                    (x = null) => `channels: ${x}`,
                    (x = null) => `bits-per-sample: ${x}`,
                    (x = null) => `total samples: ${x}`,
                    (x = null) => `MD5 signature: ${x}`,
                ],
                "data": [0, isLast, length,],
            },
            meta: {},
        };

        let dv = new DataView(buf);
        let v = new Int8Array(4);

        res.stylized.data.push(dv.getInt16(0));
        res.stylized.data.push(dv.getInt16(2));

        v.set(new Int8Array(buf.slice(4, 7)), 1);
        res.stylized.data.push(new DataView(v.buffer).getInt32());


        v = new Int8Array(4);
        v.set(new Int8Array(buf.slice(7, 10)), 1);
        res.stylized.data.push(new DataView(v.buffer).getInt32());

        let t = dv.getInt32(10);
        res.stylized.data.push(`${t >> 12}`);
        res.stylized.data.push(((t & 0xe00) >> 9) + 1);
        res.stylized.data.push(((t & 0x1f0) >> 4) + 1)

        v = new Int8Array(8)
        v.set(new Int8Array(buf.slice(13, 18)), 3)
        v[3] = v[3] & 0x0f;
        t = new DataView(v.buffer).getBigInt64();
        res.stylized.data.push(t.toString());
        res.stylized.data.push(Array.from(new Uint8Array(buf.slice(18))).map((x) => x.toString(16)).join(""));

        for (let i in res.stylized.tips) {
            console.log(res.stylized.tips[i](res.stylized.data[i]));
        }
        res.meta["type"] = 0;
        res.meta["isLast"] = isLast;
        res.meta["length"] = length;
        res.meta["minimumBlockSize"] = res.stylized.data[3];
        res.meta["maximumBlockSize"] = res.stylized.data[4];
        res.meta["minimumFrameSize"] = res.stylized.data[5];
        res.meta["sampleRate"] = res.stylized.data[7];
        res.meta["channels"] = res.stylized.data[8];
        res.meta["bitsPerSample"] = res.stylized.data[9];
        res.meta["totalSamples"] = res.stylized.data[10];
        res.meta["md5Signature"] = res.stylized.data[11];

        return res;
    }

    static METADATA_BLOCK_SEEKTABLE(buf, isLast, length) {
        console.log(`Type: 3 (SEEKTABLE)`);
        let res = {
            "stylized": {
                "tips": [
                    (x = null) => `type: ${x}`,
                    (x = null) => `is last: ${x}`,
                    (x = null) => `length: ${x}`,
                    (x = null) => `seek points: ${x}`,
                    (x = null) => {
                        let res = [];
                        for (let i in x) {
                            res.push(`point ${i}: sample_number=${x[i]["sampleNumber"]}, stream_offset=${x[i]["streamOffset"]}, frame_samples=${x[i]["frameSamples"]}`);
                        }
                        return "\t" + res.join("\n\t");
                    },
                ],
                "data": [3, isLast, length,],
            },
            meta: {},
        };

        let dv = new DataView(buf),
            cur = 0;

        let seekPoints = [];

        do {
            let seekPoint = {};
            // Sample number of first sample in the target frame, or 0xFFFFFFFFFFFFFFFF for a placeholder point.
            seekPoint["sampleNumber"] = dv.getBigInt64(cur);
            cur = cur + 8;

            //Offset (in bytes) from the first byte of the first frame header to the first byte of the target frame's header.
            seekPoint["streamOffset"] = dv.getBigInt64(cur);
            cur = cur + 8;

            //Number of samples in the target frame.
            seekPoint["frameSamples"] = dv.getInt16(cur);
            cur = cur + 2;
            seekPoints.push(seekPoint);
        } while (cur < length);

        res.stylized.data.push(seekPoints.length);
        res.stylized.data.push(seekPoints);

        for (let i in res.stylized.tips) {
            console.log(res.stylized.tips[i](res.stylized.data[i]));
        }
        res.meta["type"] = 3;
        res.meta["isLast"] = isLast;
        res.meta["length"] = length;
        res.meta["seekTableLenth"] = res.stylized.data[3];
        res.meta["seekPoints"] = res.stylized.data[4];

        return res;
    }

    static METADATA_BLOCK_VORBIS_COMMENT(buf, isLast, length) {
        console.log(`Type: 4 (VORBIS_COMMENT)`);

        let res = {
            "stylized": {
                "tips": [
                    (x = null) => `type: ${x}`,
                    (x = null) => `is last: ${x}`,
                    (x = null) => `length: ${x}`,
                    (x = null) => `vendor length: ${x}`,
                    (x = null) => `vendor string: ${x}`,
                    (x = null) => `comments: ${x}`,
                    (x = null) => {
                        let res = "";
                        for (let i in x) {
                            res += `\tcomment[${i}]: ${x[i]}\n`;
                        }
                        return res;
                    },
                ],
                "data": [4, isLast, length,],
            },
            meta: {},
        };



        let vendorLength = new DataView((new Uint8Array(buf.slice(0, 4)).reverse()).buffer).getUint32();
        res.stylized.data.push(vendorLength);

        let cur = 4;
        let vendorString = String.fromCharCode.apply(null, new Int8Array(buf.slice(cur, cur + vendorLength)));
        res.stylized.data.push(vendorString);

        cur = cur + vendorLength;
        let userCommentListLength = new DataView((new Uint8Array(buf.slice(cur, cur + 4)).reverse()).buffer).getUint32();
        res.stylized.data.push(userCommentListLength);

        let comments = [];
        res.stylized.data.push(comments);

        cur = cur + 4;
        for (let i = 0; i < userCommentListLength; i++) {
            let length = new DataView((new Uint8Array(buf.slice(cur, cur + 4)).reverse()).buffer).getUint32();
            cur = cur + 4;
            // let userComment = decodeURIComponent(escape(String.fromCharCode.apply(null, new Uint8Array(buf.slice(cur, cur + length)))));
            let userComment = decodeURIComponent(String.fromCharCode.apply(null,
                new Uint8Array(buf.slice(cur, cur + length))).split('').map(c => {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
                }).join(''));

            cur = cur + length;
            comments.push(userComment);
        }
        for (let i in res.stylized.tips) {
            console.log(res.stylized.tips[i](res.stylized.data[i]));
        }
        res.meta["type"] = 4;
        res.meta["isLast"] = isLast;
        res.meta["length"] = length;
        res.meta["vendorLength"] = res.stylized.data[3];
        res.meta["vendorString"] = res.stylized.data[4];
        res.meta["userCommentListLength"] = res.stylized.data[5];
        res.meta["comments"] = comments;

        return res;
    }

    static METADATA_BLOCK_PICTURE(buf, isLast, length) {
        console.log(`Type: 6 (PICTURE)`);
        const picType = ["Other", "32x32 pixels 'file icon' (PNG only)", "Other file icon", "Cover (front)", "Cover (back)", "Leaflet page", "Media (e.g. label side of CD)", "Lead artist/lead performer/soloist", "Artist/performer", "Conductor", "Band/Orchestra", "Composer", "Lyricist/text writer", "Recording Location", "During recording", "During performance", "Movie/video screen capture", "A bright coloured fish", "Illustration", "Band/artist logotype", "Publisher/Studio logotype",];
        let res = {
            "stylized": {
                "tips": [
                    (x = null) => `type: ${x}`,
                    (x = null) => `is last: ${x}`,
                    (x = null) => `length: ${x}`,
                    (x = null) => `picture type: ${x} (${picType[x]})`,
                    (x = null) => `MIME string length: ${x}`,
                    (x = null) => `MIME type: ${x}`,
                    (x = null) => `description length: ${x}`,
                    (x = null) => `description: ${x}`,
                    (x = null) => `width: ${x}`,
                    (x = null) => `height: ${x}`,
                    (x = null) => `color depth: ${x}`,
                    (x = null) => `colors: ${x}`,
                    (x = null) => `length of the picture data: ${x}`,
                ],
                "data": [6, isLast, length,],
            },
            meta: {},
        };

        let dv = new DataView(buf),
            cur = 0;

        // The picture type according to the ID3v2 APIC frame
        res.stylized.data.push(dv.getInt32(cur));

        // The length of the MIME type string in bytes.
        cur = cur + 4;
        let len = dv.getInt32(cur);
        res.stylized.data.push(len);

        // The MIME type string
        cur = cur + 4;
        res.stylized.data.push(decodeURIComponent(String.fromCharCode.apply(null,
            new Uint8Array(buf.slice(cur, cur + len))).split('').map(c => {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
            }).join('')));

        //  The length of the description string in bytes.
        cur = cur + len;
        len = dv.getInt32(cur);
        res.stylized.data.push(len);

        // The description of the picture, in UTF-8.
        cur = cur + 4;
        res.stylized.data.push(decodeURIComponent(String.fromCharCode.apply(null,
            new Uint8Array(buf.slice(cur, cur + len))).split('').map(c => {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
            }).join('')));

        // The width of the picture in pixels.
        cur = cur + len;
        res.stylized.data.push(dv.getInt32(cur));

        // The height of the picture in pixels.
        cur = cur + 4;
        res.stylized.data.push(dv.getInt32(cur));

        // The color depth of the picture in bits-per-pixel.
        cur = cur + 4;
        res.stylized.data.push(dv.getInt32(cur));

        // The number of colors used
        cur = cur + 4;
        res.stylized.data.push(dv.getInt32(cur));

        // The length of the picture data in bytes.
        cur = cur + 4;
        res.stylized.data.push(dv.getInt32(cur));

        // The binary picture data.
        cur = cur + 4;
        res.meta["pictureData"] = buf.slice(cur)

        for (let i in res.stylized.tips) {
            console.log(res.stylized.tips[i](res.stylized.data[i]));
        }

        res.meta["type"] = 6;
        res.meta["isLast"] = isLast;
        res.meta["length"] = length;
        res.meta["pictureType"] = res.stylized.data[3];
        res.meta["MIMEStringLength"] = res.stylized.data[4];
        res.meta["MIME"] = res.stylized.data[5];
        res.meta["descriptionLength"] = res.stylized.data[6];
        res.meta["description"] = res.stylized.data[7];
        res.meta["width"] = res.stylized.data[8];
        res.meta["height"] = res.stylized.data[9];
        res.meta["colorDepth"] = res.stylized.data[10];
        res.meta["colors"] = res.stylized.data[11];
        res.meta["pictureDataLength"] = res.stylized.data[12];

        // console.log(Array.from(new Uint8Array((res.meta["picture"]).slice(0, 10))).map((x)=>x.toString(16)).join(""))

        // let scale = Math.max(res.meta["width"], res.meta["height"]) > 500 ? Math.max(res.meta["width"], res.meta["height"]) / 800 : 1;
        // let img = new Image(res.meta["width"] / scale, res.meta["height"]  / scale),
        let blob = new Blob([res.meta["pictureData"]], { type: res.meta["MIME"] });
        res.meta['src'] = URL.createObjectURL(blob);
        // document.getElementById("pics").appendChild(img);

        return res;
    }
}

const getMetaHeaderType = (id) => {
    id = parseInt(id);
    const METADATA_BLOCK_HEADER_TYPE = {
        0: "STREAMINFO",
        1: "PADDING",
        2: "APPLICATION",
        3: "SEEKTABLE",
        4: "VORBIS_COMMENT",
        5: "CUESHEET",
        6: "PICTURE",
        "7-126": "reserved",
        127: "invalid, to avoid confusion with a frame sync code",
    };
    if (id >= 0 && id <= 127) {
        if (id < 7 || id == 127) {
            return METADATA_BLOCK_HEADER_TYPE[id];
        } else {
            return METADATA_BLOCK_HEADER_TYPE["7-126"];
        }
    } else {
        console.log("Error Metadata Header Type")
    }

}

function uploadSize() {
    var oFiles = document.getElementById("fileForm").files;
    handleFiles(oFiles);
}


flac.addPanel = function (node) {
    flac.ui.flacmeta.insertAdjacentElement('beforeend', node);
}

flac.addTextPanel = function (stylized, meta) {
    let con = document.createElement("article"),
        h2 = document.createElement("h2"),
        pre = document.createElement("pre");

    h2.textContent = `Metadata Block #${meta.index}, size: ${meta.size}`;
    con.className = "card";

    let data = [];
    for (let i in stylized.tips) {
        data.push(stylized.tips[i](stylized.data[i]));
    }
    pre.append(data.join("\n"))
    con.append(h2, pre);
    console.log(con);
    flac.addPanel(con);
}
flac.addImagePanel = function (stylized, meta) {
    const picType = ["Other", "32x32 pixels 'file icon' (PNG only)", "Other file icon", "Cover (front)", "Cover (back)", "Leaflet page", "Media (e.g. label side of CD)", "Lead artist/lead performer/soloist", "Artist/performer", "Conductor", "Band/Orchestra", "Composer", "Lyricist/text writer", "Recording Location", "During recording", "During performance", "Movie/video screen capture", "A bright coloured fish", "Illustration", "Band/artist logotype", "Publisher/Studio logotype",];

    let con = document.createElement("article"),
        figure = document.createElement("figure"),
        caption = document.createElement("figcaption");
    let scale = Math.max(meta["width"], meta["height"]) > 500 ? Math.max(meta["width"], meta["height"]) / 400 : 1;
    let img = new Image(meta["width"] / scale, meta["height"] / scale)

    con.className = "flex-row justify-content-center";
    figure.className = "image-figure";
    caption.className = "image-caption";

    img.src = meta.src;
    img.title = `Metadata Block #${meta.index}, size: ${meta.size}`;

    let type = picType[meta.pictureType],
        desc = meta.description;

    if (desc) {
        img.alt = `${type}:${desc}`;
        caption.textContent = `${type}:${desc}`;
    } else {
        img.alt = type;
        caption.textContent = type;
    }

    figure.append(img, caption);
    con.append(figure);

    flac.addPanel(con);
}

function handleFlac(file) {
    console.log(file);
    let metaFlac = new MetaFlac(file);

    let timer = setTimeout(loop, 1000);

    function loop() {
        clearTimeout(timer);
        if (metaFlac.metas.length) {
            for (let { stylized, meta } of metaFlac.metas) {
                // console.log(meta)
                if (meta.type != 6) {
                    flac.addTextPanel(stylized, meta);
                } else {
                    flac.addImagePanel(stylized, meta);
                }
            }
        } else {
            setTimeout(loop, 100);
        }
    }

}

function handleFiles(oFiles) {
    var nBytes = 0,
        nFiles = oFiles.length;
    // var df = document.createDocumentFragment();
    // oItem = document.createElement("li");
    for (var nFileId = 0; nFileId < nFiles; nFileId++) {
        nBytes += oFiles[nFileId].size;
        // let i = oItem.cloneNode();
        // i.innerHTML = `<b>${oFiles[nFileId].name}</b>(${oFiles[nFileId].type || "unknow"}): 
        // ${oFiles[nFileId].size};  ${new Date(oFiles[nFileId].lastModified).toISOString()};`;
        // df.append(i);

        // if (oFiles[nFileId].type.startsWith("image")){
        //     var reader = new FileReader();
        //     reader.onload = ((img) => (e) => {
        //         var image = new Image();
        //         image.height = 400;
        //         image.src = e.target.result;
        //         image.title = img.name;
        //         document.documentElement.appendChild(image);
        //     })(oFiles[nFileId]);
        //     reader.readAsDataURL(oFiles[nFileId]);
        // }

        if (oFiles[nFileId].type == "audio/flac") {
            handleFlac(oFiles[nFileId])
        }
    }

    var sOutput = nBytes + " bytes";
    // optional code for multiples approximation
    for (var aMultiples = ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"], nMultiple = 0, nApprox = nBytes / 1024; nApprox > 1; nApprox /= 1024,
        nMultiple++) {
        sOutput = nApprox.toFixed(3) + " " + aMultiples[nMultiple] + " (" + nBytes + " bytes)";
    }
    // end of optional code
    document.getElementById("fileNum").innerHTML = nFiles;
    document.getElementById("fileSize").innerHTML = sOutput;

    // document.getElementById("fileList").childNodes.forEach((v, i, a) => v.remove());
    // document.getElementById("fileList").append(df);
}

flac.init = function (app) {
    let html = `<article class="card file-box">
<input style="display: none" id="fileForm" type="file" name="fileForm" multiple>
<p class="size-info">
  files: <span id="fileNum">0</span>;
   size: <span id="fileSize">0</span>
  </p>
<div id="dropbox">
  DROP FLAC FILE HERE!
</div>
</article>
`;



    function dragenter(e) {
        console.log('dragenter');
        e.stopPropagation();
        e.preventDefault();
    }

    function dragover(e) {
        e.stopPropagation();
        e.preventDefault();
    }

    function drop(e) {
        e.stopPropagation();
        e.preventDefault();
        var dt = e.dataTransfer;
        var files = dt.files;
        handleFiles(files);
    }



    if (app.main instanceof Element) {
        app.main.innerHTML = html;
        flac.ui = {
            dropbox: document.getElementById("dropbox"),
            flacmeta: app.main,
            fileForm: document.getElementById("fileForm"),
        }
        app.main.classList.add("flacmeta")
        flac.ui.dropbox = document.getElementById("dropbox");
        flac.ui.dropbox.addEventListener("dragenter", dragenter, false);
        flac.ui.dropbox.addEventListener("dragover", dragover, false);
        flac.ui.dropbox.addEventListener("drop", drop, false);
        flac.ui.fileForm.addEventListener("change", uploadSize, false);

        flac.ui.dropbox.addEventListener("click", (e) => document.getElementById("fileForm").click());
    }
}
// flac.init();

flac.exit = function (app) {
    app.main.classList.remove("flacmeta");
}
export { flac as tool }