//https://xiph.org/flac/format.html#metadata_block_header
//https://blog.csdn.net/yu_yuan_1314/article/details/9491763

let flac = {
    iconClass: "back",
    title: "FlacMate",
};

class MetaFlac {
    constructor(file) {
        this.metas = [];
        this.error = null;
        this._ready = this.getFileArrayBuffer(file)
            .then((buf) => this._parse(buf))
            .catch((e) => {
                this.error = e instanceof Error ? e : new Error(String(e));
            });
    }

    /** 解析完成后 resolve（无论成功或失败），调用方据此判断该渲染还是报错 */
    ready() {
        return this._ready;
    }

    _parse(buf) {
        if (!(buf instanceof ArrayBuffer)) {
            throw new Error('无法读取文件内容');
        }
        if (buf.byteLength < 8) {
            throw new Error('文件过小，不是有效的 FLAC');
        }
        if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'fLaC') {
            throw new Error('不是 FLAC 文件（缺少 fLaC 标识）');
        }

        const dv = new DataView(buf);
        let cur = 4;            // 跳过 "fLaC" 魔数
        let metaIndex = 0;

        while (cur + 4 <= buf.byteLength) {
            const header = dv.getInt32(cur);
            const isLast = ((header & 0x80000000) >> 31) !== 0;
            const type = (header & 0x7f000000) >> 24;
            const size = header & 0x00ffffff;

            // 块头占 4 字节，数据从 cur + 4 开始 —— 最后一个块也要走同一套偏移，
            // 否则会从块头开始切，整体错位 4 字节（VORBIS_COMMENT / PICTURE 会整个读错）
            const dataStart = cur + 4;
            const dataEnd = Math.min(dataStart + size, buf.byteLength);

            const parser = MetaFlac.METADATA_BLOCK_HEADER_TYPE[type];
            if (typeof parser === 'function') {
                const res = parser(buf.slice(dataStart, dataEnd), isLast, size);
                res.meta['size'] = size;
                res.meta['index'] = metaIndex;
                this.metas.push(res);
            } else {
                // APPLICATION(2) 与保留类型(7-127) 没有解析器：
                // 以前这里会调用 null/undefined 抛错，并被 catch 吞掉，导致整个块消失
                this.metas.push(MetaFlac.unparsedBlock(type, isLast, size, metaIndex));
            }

            metaIndex++;
            cur = dataStart + size;
            if (isLast) break;
        }

        if (!this.metas.length) {
            throw new Error('未找到任何元数据块');
        }
    }

    /** 无法解析内部结构的块：仍然把块信息展示出来，而不是静默丢弃 */
    static unparsedBlock(type, isLast, size, index) {
        return {
            stylized: {
                tips: [
                    (x = null) => `type: ${x}`,
                    (x = null) => `is last: ${x}`,
                    (x = null) => `length: ${x}`,
                    () => 'content: （该类型本工具不解析内部结构）',
                ],
                data: [type, isLast, size],
            },
            meta: { type, isLast, length: size, size, index },
        };
    }

    getMeta() {
        // METADATA_BLOCK_STREAMINFO()
    }
    static get METADATA_BLOCK_HEADER_TYPE() {
        // 下标 2（APPLICATION）与 7-127（保留）没有解析器，调用方需判空
        return [MetaFlac.METADATA_BLOCK_STREAMINFO,
        MetaFlac.METADATA_BLOCK_PADDING,
            null,
        MetaFlac.METADATA_BLOCK_SEEKTABLE,
        MetaFlac.METADATA_BLOCK_VORBIS_COMMENT,
        MetaFlac.METADATA_BLOCK_CUESHEET,
        MetaFlac.METADATA_BLOCK_PICTURE];
    }
    getFileArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            if (file instanceof File) {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = () => reject(new Error('文件读取失败'));
                reader.readAsArrayBuffer(file);
            } else if (file instanceof ArrayBuffer) {
                resolve(file);
            } else {
                // 以前这里既没 resolve 也没 reject，Promise 永远挂着，调用方会一直等下去
                reject(new Error('不支持的数据来源'));
            }
        });
    }

    static METADATA_BLOCK_STREAMINFO(buf, isLast, length) {
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

    static METADATA_BLOCK_PADDING(buf, isLast, length) {
        let res = {
            "stylized": {
                "tips": [
                    (x = null) => `type: ${x}`,
                    (x = null) => `is last: ${x}`,
                    (x = null) => `length: ${x}`,
                ],
                "data": [1, isLast, length,],
            },
            meta: {},
        };


        res.meta["type"] = 1;
        res.meta["isLast"] = isLast;
        res.meta["length"] = length;
        res.meta["buf"] = buf;

        return res;
    }

    static METADATA_BLOCK_SEEKTABLE(buf, isLast, length) {
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

        res.meta["type"] = 3;
        res.meta["isLast"] = isLast;
        res.meta["length"] = length;
        res.meta["seekTableLenth"] = res.stylized.data[3];
        res.meta["seekPoints"] = res.stylized.data[4];

        return res;
    }

    static METADATA_BLOCK_VORBIS_COMMENT(buf, isLast, length) {

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
        res.meta["type"] = 4;
        res.meta["isLast"] = isLast;
        res.meta["length"] = length;
        res.meta["vendorLength"] = res.stylized.data[3];
        res.meta["vendorString"] = res.stylized.data[4];
        res.meta["userCommentListLength"] = res.stylized.data[5];
        res.meta["comments"] = comments;

        return res;
    }

    static METADATA_BLOCK_CUESHEET(buf, isLast, length) {

        let cur = 0;

        let res = {
            "stylized": {
                "tips": [
                    (x = null) => `type: ${x}`,
                    (x = null) => `is last: ${x}`,
                    (x = null) => `length: ${x}`,
                    (x = null) => `media catalog number: ${x}`,
                    (x = null) => `lead-in: ${x.toString()}`,
                    (x = null) => `is CD: ${x}`,
                    (x = null) => `number of tracks: ${x}`,
                    (x = null) => {
                        let res = "";
                        for (let i in x) {
                            res += `\ttrack[${i}]\n\t  offset: ${x[i]['offset']}\n\t  number: ${x[i]['number']}\n\t  ISRC:${x[i]['ISRC']}\n\t  type: ${x[i]['type']}\n\t  pre-emphasis: ${x[i]['pre-emphasis']}\n\t  number of index points: ${x[i]['number of index points']}`;
                            for (let j in x[i]['index']) {
                                res += `\n\t  index[${j}]:\n\t\toffset: ${x[i]['index'][j]['offset']}\n\t\tnumber: ${x[i]['index'][j]['number']}`;
                            }
                            res += "\n";
                        }
                        return res;
                    },
                ],
                "data": [5, isLast, length,],
            },
            meta: {},
        };

        // Media catalog number, in ASCII printable characters 0x20-0x7e.
        // console.log(buf.slice(cur, cur + 128));
        // console.log((new Uint8Array(buf.slice(cur, cur + 128))).filter(v => v >= 0x20 && v <= 0x7e));
        let mediaCatalogNumber = "";
        if (new Uint8Array(buf.slice(cur, cur + 128)).every(v => v >= 0x20 && v <= 0x7e)) {
            mediaCatalogNumber = decodeURIComponent(String.fromCharCode.apply(null,
                new Uint8Array(buf.slice(cur, cur + 128))).split('').map(c => {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
                }).join(''));
        }
        cur = cur + 128;
        res.stylized.data.push(mediaCatalogNumber);

        // The number of lead-in samples.
        let leadIn = new DataView(buf).getBigInt64(cur);
        cur = cur + 8;
        res.stylized.data.push(leadIn)

        // 1 if the CUESHEET corresponds to a Compact Disc, else 0.
        let isCD = (new DataView(buf).getInt8(cur) & 0x80) >> 7;
        res.stylized.data.push(!!isCD);

        // Reserved
        let reserved = new Int8Array(buf.slice(cur, cur + 259));
        reserved[0] = reserved[0] & 0x7F;
        reserved = reserved.buffer;
        cur = cur + 259;

        // The number of tracks.
        let tracksNum = new DataView(buf).getInt8(cur);
        cur = cur + 1;
        res.stylized.data.push(tracksNum);

        let tracks = [];
        // CUESHEET_TRACK
        for (let i = 0; i < tracksNum; i++) {
            let track = {}
            // Track offset in samples, relative to the beginning of the FLAC audio stream.
            track['offset'] = new DataView(buf).getBigInt64(cur);
            cur = cur + 8;

            // Track number. 
            track['number'] = new DataView(buf).getInt8(cur);
            if (track['number'] < 0) {
                track['number'] = new DataView(buf).getUint8(cur) + " (LEAD-OUT)";
            }
            cur = cur + 1;

            // Track ISRC. 

            if (new Int8Array(buf.slice(cur, cur + 12)).every(v => v == 0)) {
                track['ISRC'] = "";
            } else {
                track['ISRC'] = decodeURIComponent(String.fromCharCode.apply(null,
                    new Uint8Array(buf.slice(cur, cur + 12))).split('').map(c => {
                        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
                    }).join(''));
            }

            cur = cur + 12;


            let t = new DataView(buf).getInt8(cur);

            // The track type: 0 for audio, 1 for non-audio. 
            track['type'] = ((t & 0x80) >> 7) ? "NON-AUDIO" : "AUDIO";

            // he pre-emphasis flag: 0 for no pre-emphasis, 1 for pre-emphasis.
            track['pre-emphasis'] = ((t & 0x40) >> 6) ? true : false;

            // Reserved
            let reserved = new Int8Array(buf.slice(cur, cur + 14));
            reserved[0] = reserved[0] & 0x3F;
            reserved = reserved.buffer;
            cur = cur + 14;

            // The number of track index points.
            track['number of index points'] = new DataView(buf).getInt8(cur);
            cur = cur + 1;

            // CUESHEET_TRACK_INDEX
            track["index"] = []
            for (let j = 0; j < track['number of index points']; j++) {
                // Offset in samples, relative to the track offset, of the index point. 
                let index = {};
                index['offset'] = new DataView(buf).getBigInt64(cur);
                cur = cur + 8;

                //The index point number.
                index['number'] = new DataView(buf).getInt8(cur);
                cur = cur + 1;

                let reserved = buf.slice(cur, cur + 3);
                cur = cur + 3;

                track['index'].push(index);
            }
            tracks.push(track)
        }

        res.stylized.data.push(tracks);
        // console.log(tracks, cur);


        res.meta["type"] = 5;
        res.meta["isLast"] = isLast;
        res.meta["length"] = length;
        res.meta["mediaCatalogNumber"] = res.stylized.data[3];
        res.meta["leadInSamples"] = res.stylized.data[4];
        res.meta["isCD"] = res.stylized.data[5];
        res.meta["tracksLength"] = res.stylized.data[6];
        res.meta["tracks"] = res.stylized.data[7];

        return res;
    }

    static METADATA_BLOCK_PICTURE(buf, isLast, length) {
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
        objectUrls.push(res.meta['src']);   // 登记以便后续回收
        // document.getElementById("pics").appendChild(img);

        return res;
    }
}

const getMetaHeaderType = (id) => {
    id = parseInt(id, 10);
    if (!Number.isInteger(id) || id < 0 || id > 127) {
        return "unknown";
    }
    if (id === 127) {
        return "invalid, to avoid confusion with a frame sync code";
    }
    if (id >= 7) {
        return "reserved";
    }
    return ["STREAMINFO", "PADDING", "APPLICATION", "SEEKTABLE",
        "VORBIS_COMMENT", "CUESHEET", "PICTURE"][id];
}

function uploadSize() {
    const oFiles = document.getElementById("fileForm").files;
    handleFiles(oFiles);
}

/** 已创建的封面图 blob URL：面板清空或退出工具时必须回收，否则每次拖文件都泄漏一份图片内存 */
let objectUrls = [];
function releaseObjectUrls() {
    for (const u of objectUrls) {
        try { URL.revokeObjectURL(u); } catch { /* 忽略 */ }
    }
    objectUrls = [];
}

flac.addPanel = function (node) {
    flac.ui.flacmeta.insertAdjacentElement('beforeend', node);
}

/** 在结果区顶部显示一条提示（错误或信息），不依赖 console */
flac.showMessage = function (text, isError) {
    const con = document.createElement("article");
    const p = document.createElement("p");
    con.className = "card";
    if (isError) con.classList.add("error-card");
    p.textContent = text;
    con.append(p);
    flac.addPanel(con);
}

flac.addTextPanel = function (stylized, meta) {
    let con = document.createElement("article"),
        h2 = document.createElement("h2"),
        pre = document.createElement("pre");

    h2.textContent = `Metadata Block #${meta.index}, size: ${meta.size}, type: ${meta.type} (${getMetaHeaderType(meta.type)})`;
    con.className = "card";

    let data = [];
    for (let i in stylized.tips) {
        data.push(stylized.tips[i](stylized.data[i]));
    }
    pre.append(data.join("\n"))
    con.append(h2, pre);
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

/** 解析并渲染一个 FLAC 文件；失败时抛出可读的错误信息 */
async function handleFlac(file) {
    const metaFlac = new MetaFlac(file);
    await metaFlac.ready();      // 原来是 setTimeout 无限轮询：非 FLAC 文件会一直空转
    if (metaFlac.error) throw metaFlac.error;

    for (const { stylized, meta } of metaFlac.metas) {
        if (meta.type !== 6) {
            flac.addTextPanel(stylized, meta);
        } else {
            flac.addImagePanel(stylized, meta);
        }
    }
}

const isFlacFile = (f) =>
    f.type === 'audio/flac' || f.type === 'audio/x-flac' || /\.flac$/i.test(f.name);

function formatBytes(n) {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let v = n, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return i === 0 ? `${n} B` : `${v.toFixed(3)} ${units[i]} (${n} bytes)`;
}

async function handleFiles(oFiles) {
    const files = [...oFiles];
    if (!files.length) return;
    const flacFiles = files.filter(isFlacFile);
    const skipped = files.length - flacFiles.length;

    // 清空上一次的结果，并回收封面图的 blob URL（原来从不回收，每次拖文件泄漏一份图片）
    releaseObjectUrls();
    document.querySelectorAll("main>article:not(:first-of-type)").forEach((v) => v.remove());

    document.getElementById("fileNum").textContent = files.length;
    document.getElementById("fileSize").textContent =
        formatBytes(files.reduce((sum, f) => sum + f.size, 0));

    if (!flacFiles.length) {
        flac.showMessage(`没有可解析的文件：需要 .flac 文件（本次 ${files.length} 个都不支持）`, true);
        return;
    }
    if (skipped) {
        flac.showMessage(`已跳过 ${skipped} 个非 FLAC 文件`, false);
    }

    // 逐个串行处理，避免多个文件的异步解析结果互相插队
    for (const f of flacFiles) {
        try {
            await handleFlac(f);
        } catch (err) {
            flac.showMessage(`${f.name}：${err.message}`, true);
        }
    }
}

flac.init = function (app) {
    let html = `<article class="card file-box">
<input style="display: none" id="fileForm" type="file" name="fileForm" accept=".flac,audio/flac,audio/x-flac" multiple>
<p class="size-info">
  files: <span id="fileNum">0</span>;
   size: <span id="fileSize">0</span>
  </p>
<div id="dropbox" role="button" tabindex="0" aria-label="拖入 FLAC 文件，或按回车选择文件">
  <span>DROP FLAC FILE HERE!<br><small>（点击选择，或聚焦后按回车）</small></span>
</div>
</article>
`;

    function dragenter(e) {
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
        handleFiles(e.dataTransfer.files);
    }

    function openPicker() {
        document.getElementById("fileForm").click();
    }

    function onDropboxKeydown(e) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
        }
    }

    if (app.main instanceof Element) {
        app.main.innerHTML = html;
        app.main.classList.add("flacmeta");
        const dropbox = document.getElementById("dropbox");
        const fileForm = document.getElementById("fileForm");
        flac.ui = { dropbox, flacmeta: app.main, fileForm };
        dropbox.addEventListener("dragenter", dragenter, false);
        dropbox.addEventListener("dragover", dragover, false);
        dropbox.addEventListener("drop", drop, false);
        dropbox.addEventListener("click", openPicker, false);
        dropbox.addEventListener("keydown", onDropboxKeydown, false);
        fileForm.addEventListener("change", uploadSize, false);
        // 记下来供 exit 移除（原来 exit 只删了个 class，监听全部残留）
        flac.handlers = { dragenter, dragover, drop, openPicker, onDropboxKeydown };
    }
}
// flac.init();

flac.exit = function (app) {
    const ui = flac.ui;
    const h = flac.handlers;
    if (ui && h) {
        ui.dropbox.removeEventListener("dragenter", h.dragenter);
        ui.dropbox.removeEventListener("dragover", h.dragover);
        ui.dropbox.removeEventListener("drop", h.drop);
        ui.dropbox.removeEventListener("click", h.openPicker);
        ui.dropbox.removeEventListener("keydown", h.onDropboxKeydown);
        ui.fileForm.removeEventListener("change", uploadSize);
    }
    releaseObjectUrls();
    flac.handlers = null;
    app.main.classList.remove("flacmeta");
}
export { flac as tool }