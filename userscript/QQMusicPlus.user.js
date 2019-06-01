// ==UserScript==
// @name         + QQ Music Plus
// @namespace    https://gitiy.github.io/userscript
// @version      0.1.5
// @description  Enhance the experience of QQ Music Web
// @author       Gitiy
// @updateURL    https://raw.githubusercontent.com/Gitiy/gitiy.github.io/master/userscript/QQMusicPlus.user.js
// @downloadURL  https://raw.githubusercontent.com/Gitiy/gitiy.github.io/master/userscript/QQMusicPlus.user.js
// @require      https://raw.githubusercontent.com/Gitiy/gitiy.github.io/master/userscript/utils/notice.js
// @match        https://y.qq.com/n/yqq/*
// ==/UserScript==
(function () {
    'use strict';



    async function sendAria2RPC(data) {
        try {
            const resp = await fetch('http://localhost:6800/jsonrpc', {
                method: 'POST',
                body: JSON.stringify(data),
                credentials: 'same-origin',
                headers: new Headers({
                    'User-Agent': 'Mozilla/4.0 MDN Example',
                    'Content-type': 'application/json',
                }),
                mode: 'cors',
                redirect: 'follow',
                referrer: 'no-referrer',
                cache: 'no-cache',
            });
            return resp.json();
        }
        catch (error) {
            error.message = `发送Aria2RPC出错\n${error.message}`;
            throw error;
        }
    }

    function download(data, filename, type) {
        var file = new Blob([data,], {
            type: type,
        });
        if (window.navigator.msSaveOrOpenBlob) { // IE10+
            window.navigator.msSaveOrOpenBlob(file, filename);
        } else { // Others
            var a = document.createElement('a'),
                url = URL.createObjectURL(file);
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                // document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }, 0);
        }
    }

    function strEncodeUTF16(str) {
        // ref: https://stackoverflow.com/q/6226189
        var charCode, byteArray = [];

        // BE BOM
        //byteArray.push(254, 255);

        // LE BOM
        byteArray.push(255, 254);

        for (var i = 0; i < str.length; ++i) {

            charCode = str.charCodeAt(i);

            // BE Bytes
            //byteArray.push((charCode & 0xFF00) >>> 8);
            //byteArray.push(charCode & 0xFF);

            // LE Bytes
            byteArray.push(charCode & 0xff);
            byteArray.push(charCode / 256 >>> 0);
        }
        return new Uint8Array(byteArray);
    }

    function notify(options) {
        if (window[Symbol.for('notice+')]) {
            window[Symbol.for('notice+')].notice(options);
        }
    }

    class QQMusicPlus {
        constructor() {
            this.mid = QQMusicPlus.getMid();
            this.styleNode = document.createElement('style');
            document.documentElement.append(this.styleNode);
        }

        static getMid(url = window.location.href) {
            if (url.includes('song/')) {
                return url.split('song/')[1].split('.')[0];
            }
            if (url.includes('album/')) {
                return url.split('album/')[1].split('.')[0];
            }
            return null;
        }

        static async getVkey() {
            try {
                // const resp = await fetch('https://c.y.qq.com/base/fcgi-bin/fcg_music_express_mobile3.fcg?cid=205361747&guid=0&songmid=003a1tne1nSz1Y&filename=0.m4a');
                const resp = await fetch('https://c.y.qq.com/base/fcgi-bin/fcg_music_express_mobile3.fcg?cid=205361747&songmid=003a1tne1nSz1Y&filename=0.m4a&guid=ffffffff82def4af4b12b3cd9337d5e7&uin=346897220');
                const json = await resp.json();
                return json.data.items[0].vkey;
            } catch (error) {
                error.message = `获取 vkey 出错\n${error.message}`;
                throw error;
            }
        }

        static async getLyrics(mid) {
            const lrcTagValue = function (line) {
                if (!(/\[[\d:.]+\]/g.test(line))) {
                    return [];
                }
                let res = [];
                for (let tag of line.match(/\[[\d:.]+\]/g)) {
                    let val = 0,
                        time = tag.slice(1, -1).split(':');
                    for (let i in time) {
                        val += parseFloat(time[i]) * Math.pow(60, time.length - 1 - i);
                    }
                    res.push(val.toFixed(2));
                }
                return res;
            };

            const mergeLyrics = function (lrc, trans) {
                let res = [],
                    transMap = {};

                for (let l of trans.split('\n')) {
                    if (l.split(']').pop() === '//' || /^腾讯享有本{0,1}翻译作品的著作权$/.test(l.replace(/^\[[\d.:\]]*\]/,'').trim()) || /^\[[\d.:\]]*\]\s*$/.test(l)) {
                        continue;
                    }
                    let tagVals = lrcTagValue(l);

                    for (let val of tagVals) {
                        transMap[val] = l;
                    }
                }

                let firstValidLine = true;
                for (let line of lrc.split('\n')) {
                    if (line.startsWith('[by:')) {
                        line = '[by:]';
                    }
                    let vals = lrcTagValue(line);
                    if (vals.length > 0) {
                        if (firstValidLine) {
                            line = `\n${line}`;
                            firstValidLine = false;
                        }

                        if (vals[0] in transMap) {
                            res.push(`${line}\n${transMap[vals[0]]}\n`);
                            delete (transMap[vals[0]]);
                        } else { // 不存在翻译
                            // 小于当前时间标签的翻译处理
                            const t = Object.keys(transMap).filter(v => parseFloat(v) < vals[0]);
                            if (t.length === 1) {
                                if (Math.abs(vals[0] - t[0]) < 1) {
                                    res.push(`${line}\n${line.split(']').slice(0, -1).join(']') + ']'}${transMap[t[0]].replace(/^\[[\d.:\]]*\]/, '')}\n`);
                                }
                                delete (transMap[t[0]]);
                                continue;
                            } else {
                                for (let i of t) {
                                    res.push(`${transMap[i]}\n`);
                                    delete (transMap[i]);
                                }
                            }
                            res.push(`${line}\n`);
                        }
                    } else {
                        res.push(`${line}`);
                    }
                }
                // console.log(res);
                return res.join('\n').unescapeHTML();
            };

            //return fetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?pcachetime=${Date.now()}&songmid=${mid}&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`)
            // g_tk=5381 必须加，否则不返回翻译
            try {
                const resp = await fetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?-=MusicJsonCallback_lrc&pcachetime=${Date.now()}&songmid=${mid}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`);
                // const data = resp.ok ? resp.json() : new Error(`fetch lyric fiald: ${mid}`);
                if (!resp.ok) {
                    throw new Error(`Fetch lyric failed: ${mid}\nHTTP error, status = ${resp.status}`);
                }
                const data = await resp.json();
                console.log(data);
                // let lrc = decdecodeURIComponent(escape(atob(data.lyeic)));
                // let lrc = decodeURIComponent(Array.from([...atob(data.lyric)], c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
                let lrc = decodeURIComponent(atob(data.lyric).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
                if (lrc.includes('此歌曲为没有填词的纯音乐，请您欣赏')) {
                    throw new Error('此歌曲为没有填词的纯音乐，请您欣赏');
                }
                if ('trans' in data) {
                    const trans = decodeURIComponent(atob(data.trans).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
                    lrc = mergeLyrics(lrc, trans);
                }
                return lrc;
            }
            catch (error) {
                error.message = `解析(合并)歌词出错\n${error.message}`;
                console.log(error.message);
                throw error;
            }
        }

        async songLyrics(songDetail) {
            const addLyricsUI = function (lrc) {
                let lrcNode = document.createElement('pre');
                lrcNode.innerText = lrc;
                //console.log(lrcNode);
                //console.log(lrc);
                let lrcToggle = document.createElement('a');
                lrcToggle.style.cssText = 'color:#666;margin:1rem;user-select: none;cursor: alias;';
                lrcToggle.textContent = '切换LRC';
                let lrcDown = document.createElement('a');
                lrcDown.style.cssText = 'color:#666;margin:1rem;user-select: none;cursor: pointer;';
                lrcDown.textContent = '下载LRC';

                let lyricContent = document.querySelector('#lrc_content');
                let originLyricHTML = null;
                let copyContent = document.querySelector('#copy_content'),
                    originCopyContent = copyContent.value;

                let showLRC = false;
                lrcToggle.addEventListener('click', (e) => {
                    if (!originLyricHTML) {
                        originLyricHTML = lyricContent.innerHTML;
                    }
                    if (showLRC) {
                        lyricContent.innerHTML = originLyricHTML;
                        copyContent.value = originCopyContent;
                    } else {
                        lyricContent.innerHTML = lrcNode.outerHTML;
                        copyContent.value = lrc;
                    }
                    showLRC = !showLRC;
                });
                lrcDown.addEventListener('click', (e) => {
                    let prefix = `${String.prototype.padStart.call(songDetail.songinfo.data.track_info.index_album, 2, 0)}`;
                    if (songDetail.songinfo.data.track_info.index_cd > 0) {
                        prefix = `${String.prototype.padStart.call(songDetail.songinfo.data.track_info.index_cd, 2, 0)}-${prefix}`;
                    }
                    const fileName = `${prefix}. ${songDetail.songinfo.data.track_info.name}.lrc`;
                    download(strEncodeUTF16(lrc), fileName, 'application/octet-stream;charset=UTF-16BE;');
                });

                if (document.querySelector('.lyric__hd')) {
                    document.querySelector('.lyric__hd').append(lrcToggle);
                    document.querySelector('.lyric__hd').append(lrcDown);
                } else {
                    lrcDown.className = 'mod_btn_green';
                    document.querySelector('.none_txt').append(lrcDown);
                }
            };

            try {
                let lrc = await QQMusicPlus.getLyrics(songDetail.songinfo.data.track_info.mid || this.mid);
                lrc = lrc.split('\n').filter(x => /^\[[\d.:[\]]+\]|^$/.test(x)).join('\n');
                lrc = `[ti:${songDetail.songinfo.data.track_info.title || songDetail.songinfo.data.track_info.name}]\n[ar:${songDetail.songinfo.data.track_info.singer.reduce((acc, cur) => `${acc}; ${cur.title || cur.name}`, '').slice(2)}]\n[al:${songDetail.songinfo.data.track_info.album.title || songDetail.songinfo.data.track_info.album.name}]\n[by:]\n[offset:0]\n\n${lrc}`;
                addLyricsUI(lrc);
            } catch (error) {
                console.log(error);
                notify(error.message);
            }
        }

        async getSongDetail(mid) {
            try {
                let data = {
                    'comm': {
                        'ct': 24,
                        'cv': 0,
                    },
                    'songinfo': {
                        'method': 'get_song_detail_yqq',
                        'param': {
                            'song_type': 0,
                            'song_mid': mid,
                            'song_id': null,
                        },
                        'module': 'music.pf_song_detail_svr',
                    },
                };
                const resp = await fetch(`https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(data))}`);
                return resp.json();
            } catch (error) {
                error.message = `获取歌曲详情出错\n${error.message}`;
                throw error;
            }
        }

        async songHandle() {
            try {
                const json = await this.getSongDetail(this.mid);

                console.log(json);

                const name = `${json.songinfo.data.track_info.index_cd}-${String.prototype.padStart.call(json.songinfo.data.track_info.index_album, 2, 0)}. ${json.songinfo.data.track_info.title}.flac`.replace(/[<>:"/\\|?*]/g, ''); // Remove illegal characters

                this.songLyrics(json);

                if (!json.songinfo.data.track_info.file.size_flac) {
                    console.log('不存在无损');
                    return json;
                }
                var aria2 = document.createElement('a');
                aria2.className = 'mod_btn';
                aria2.innerText = 'Aria2 RPC';
                document.querySelector('.data__actions').append(aria2);
                aria2.style.cssText = 'cursor:pointer';
                aria2.addEventListener('click', async (e) => {
                    const vkey = await QQMusicPlus.getVkey();
                    let s = '';
                    // let url = `http://streamoc.music.tc.qq.com/F000${json.songinfo.data.track_info.file.media_mid}.flac?guid=0&uin=0&fromtag=53&vkey=${vkey}`;
                    let url = `http://mobileoc.music.tc.qq.com/F000${json.songinfo.data.track_info.file.media_mid}.flac?guid=ffffffff82def4af4b12b3cd9337d5e7&uin=346897220&fromtag=53&vkey=${vkey}`;

                    s += `${url}\n\tsplit=16\n\tmax-connection-per-server=16\n\tdir=./\n\tout=${name}\n`;
                    let data = {
                        'jsonrpc': '2.0',
                        'id': Date.now(),
                        'method': 'aria2.addUri',
                        'params': [
                            [url,],
                            {
                                'out': `${name}`,
                                'split': 16,
                                'max-connection-per-server': 5,
                                'async-dns': false,
                            },
                        ],
                    };

                    console.log(s);

                    try {
                        let res = await sendAria2RPC(data);
                        if (res) {
                            console.log(`已添加 ${name} 到 aria2 任务`);
                            return json;
                        }
                    } catch (error) {
                        console.log('添加 aria2 任务出错', error);
                        throw error;
                    }
                });

                return json;

            } catch (error) {
                console.log(error);
                notify(error.message);
            }
        }

        async getAlbumDetail(mid) {
            try {
                const resp = await fetch(`https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albummid=${mid}`);
                return resp.json();
            } catch (error) {
                error.message = `获取专辑详情出错\n${error.message}`;
                throw error;
            }
        }

        async albumLyrics(albumDetial) {
            this.styleNode.append('.QQ-Music-Plus-Album-LRC-Item{cursor: pointer; line-height: 50px;}');
            this.styleNode.append('.QQ-Music-Plus-Album-LRC-List { position: absolute; display: flex; flex-direction: column; left: -2rem; padding-top: 50px;}');
            const containor = document.createElement('div');
            containor.className = 'QQ-Music-Plus-Album-LRC-List';
            for (let i of albumDetial.data.list) {

                let node = document.createElement('a');
                node.textContent = 'LRC';
                node.title = `点击下载 "${i.songname}" 歌词`;
                node.className = 'QQ-Music-Plus-Album-LRC-Item';
                node.addEventListener('click', async (e) => {
                    let prefix = `${String.prototype.padStart.call(i.belongCD, 2, 0)}`;
                    if (albumDetial.data.list.slice(-1)[0].cdIdx > 0) {
                        prefix = `${String.prototype.padStart.call(i.cdIdx, 2, 0)}-${prefix}`;
                    }

                    try {
                        let lrc = await QQMusicPlus.getLyrics(i.songmid);
                        lrc = lrc.split('\n').filter(x => /^\[[\d.:[\]]+\]|^$/.test(x)).join('\n');
                        lrc = `[ti:${i.songname}]\n[ar:${i.singer.reduce((acc, cur) => `${acc}; ${cur.name}`, '').slice(2)}]\n[al:${i.albumname}]\n[by:]\n[offset:0]\n\n${lrc}`;
                        const name = `${prefix}. ${i.songorig || i.songname}.lrc`.replace(/[<>:"/\\|?*]/g, '');
                        // console.log(name, '\n', lrc);
                        download(strEncodeUTF16(lrc), name, 'application/octet-stream;charset=UTF-16BE;');
                    } catch (error) {
                        console.log(error);
                        notify(error.message);
                    }
                });

                containor.append(node);
                document.querySelector('.detail_layout').insertAdjacentElement('beforeend', containor);
                //line.insertAdjacentElement('beforeend', node)
            }
        }

        async albumHandle() {
            try {
                let json = await this.getAlbumDetail(this.mid);
                console.log(json);
                if (!(json.code === 0 && json.subcode === 0 && 'data' in json && 'list' in json.data)) {
                    throw new Error('专辑详情格式错误');
                }
                this.albumLyrics(json);

                var aria2 = document.createElement('a');
                aria2.className = 'mod_btn';
                aria2.innerText = 'Aria2 RPC';
                document.querySelector('.data__actions').append(aria2);
                aria2.addEventListener('click', async (e) => {
                    const vkey = await QQMusicPlus.getVkey();
                    let s = '';
                    for (let i in json.data.list) {
                        if (json.data.list[i].sizeflac) {
                            // let url = `http://streamoc.music.tc.qq.com/F000${json.data.list[i].strMediaMid}.flac?guid=0&uin=0&fromtag=53&vkey=${vkey}`;
                            let url = `http://mobileoc.music.tc.qq.com/F000${json.data.list[i].strMediaMid}.flac?guid=ffffffff82def4af4b12b3cd9337d5e7&uin=346897220&fromtag=53&vkey=${vkey}`,
                                name = `${json.data.list[i].songname}.flac`.replace(/[<>:"/\\|?*]/g, ''); // Remove illegal characters
                            s += `${url}\n\tsplit=16\n\tmax-connection-per-server=16\n\tdir=./\n\tout=${name}\n`;

                            let data = {
                                'jsonrpc': '2.0',
                                'id': Date.now(),
                                'method': 'aria2.addUri',
                                'params': [
                                    [url,],
                                    {
                                        'out': `${json.data.list[i].singer[0].name.replace(/[<>:"/\\|?*]/g, '')}\\${json.data.list[i].albumname.replace(/[<>:"/\\|?*]/g, '')}\\${json.data.list[i].cdIdx}-${json.data.list[i].belongCD}. ${name}`,
                                        'split': 16,
                                        'max-connection-per-server': 16,
                                    },
                                ],
                            };

                            try {
                                let res = await sendAria2RPC(data);
                                if (res) {
                                    console.log(`已添加 ${name} 到 aria2 任务`, res);
                                }
                            } catch (error) {
                                console.log('添加 aria2 出错', error);
                                throw error;
                            }
                        }
                    }
                    console.log(s);
                });

                setTimeout(() => {
                    try {
                        let flacIcon = document.createElement('i');
                        flacIcon.style.cssText = 'text-transform: uppercase;border: 1px solid #31c27c; padding: 1px 4px; font-size: 7px; border-radius: 4px; color: #34c47e; cursor: pointer; position: relative; top: 4px; user-select: none; line-height: 50px; margin-right: 4px; font-family: monospace;';
                        flacIcon.textContent = 'flac';
                        for (let i of json.data.list) {
                            if (i.sizeflac) {
                                const con = document.querySelector(`li[mid="${i.songid}"]`).querySelector('div.songlist__songname');
                                const t = flacIcon.cloneNode(true);
                                t.setAttribute('title', `通过 aria2 下载 ${i.songname}.flac`);
                                con.insertAdjacentElement('afterbegin', t);
                                t.addEventListener('click', async () => {
                                    const vkey = await QQMusicPlus.getVkey();
                                    let url = `http://mobileoc.music.tc.qq.com/F000${i.strMediaMid}.flac?guid=ffffffff82def4af4b12b3cd9337d5e7&uin=346897220&fromtag=53&vkey=${vkey}`,
                                        name = `${i.songname}.flac`.replace(/[<>:"/\\|?*]/g, ''); // Remove illegal characters
                                    console.log(`${url}\n\tsplit=16\n\tmax-connection-per-server=16\n\tdir=./\n\tout=${name}\n`);

                                    let data = {
                                        'jsonrpc': '2.0',
                                        'id': Date.now(),
                                        'method': 'aria2.addUri',
                                        'params': [
                                            [url,],
                                            {
                                                'out': `${name}`,
                                                'split': 16,
                                                'max-connection-per-server': 16,
                                            },
                                        ],
                                    };

                                    try {
                                        let res = await sendAria2RPC(data);
                                        if (res) {
                                            console.log(`已添加 ${name} 到 aria2 任务`, res);
                                        }
                                    } catch (error) {
                                        console.log('添加 aria2 出错', error);
                                        throw error;
                                    }
                                });
                            }
                        }
                    } catch (e) {
                        console.log(e);
                    }
                }, 1000); // delay for page render

                return json;


            } catch (error) {
                console.log(error);
                notify(error.message);
            }
        }
    }


    const qmp = new QQMusicPlus();
    document.addEventListener('readystatechange', (e) => {
        console.log(e.target.readyState);
        if (e.target.readyState == 'complete') {
            if (location.pathname.startsWith('/n/yqq/album/')) {
                qmp.albumHandle();
            }
            if (location.pathname.startsWith('/n/yqq/song/')) {
                qmp.songHandle();
            }
        }
    });


})();