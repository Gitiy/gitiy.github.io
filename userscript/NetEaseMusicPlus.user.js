// ==UserScript==
// @name         + NetEase Music Plus
// @namespace    https://gitiy.github.io/userscript
// @version      0.1.0
// @description  Enhance the experience of NetEase Music Web
// @author       Gitiy
// @updateURL    https://raw.githubusercontent.com/Gitiy/gitiy.github.io/master/userscript/NetEaseMusicPlus.user.js
// @downloadURL  https://raw.githubusercontent.com/Gitiy/gitiy.github.io/master/userscript/NetEaseMusicPlus.user.js
// @require      https://raw.githubusercontent.com/Gitiy/gitiy.github.io/master/userscript/utils/notice.js
// @match        https://music.163.com/*
// ==/UserScript==
(function () {
    'use strict';
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
            // window.open(url,'top',);
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

    class NetEaseMusicPlus {
        constructor(containor) {
            this.containor = containor;
            this.styleNode = this.containor.createElement('style');
            this.containor.documentElement.append(this.styleNode);
        }


        async getSongDetail(id) {
            try {
                const resp = await fetch(`//music.163.com/api/song/detail?ids=%5B${id}%5D`);
                return resp.json();
            } catch (error) {
                error.message = `获取歌曲详情出错\n${error.message}`;
                throw error;
            }
        }

        static async getLyrics(id) {
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
                    if (l.split(']').pop() === '//' || /^腾讯享有本{0,1}翻译作品的著作权$/.test(l.replace(/^\[[\d.:\]]*\]/, '').trim()) || /^\[[\d.:\]]*\]\s*$/.test(l)) {
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
                return res.join('\n');
            };

            try {
                const resp = await fetch(`//music.163.com/api/song/lyric?os=pc&id=${id}&lv=-1&kv=-1&tv=-1`);
                // const data = resp.ok ? resp.json() : new Error(`fetch lyric fiald: ${id}`);
                if (!resp.ok) {
                    throw new Error(`Fetch lyric failed: ${id}\nHTTP error, status = ${resp.status}`);
                }
                const data = await resp.json();
                // console.log(data);
                if (data['code'] !== 200) {
                    throw new Error('获取歌词出错');
                }
                if (data['nolyric']) {
                    throw new Error('此歌曲为没有填词的纯音乐，请您欣赏');
                }
                let lrc = data['lrc']['lyric'];
                if ('tlyric' in data && data['tlyric']['lyric']) {
                    const trans = data['tlyric']['lyric'];
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



        async songLyrics(song) {
            const addLyricsUI = function (lrc) {
                let lrcNode = document.createElement('pre');
                lrcNode.innerText = lrc;
                //console.log(lrcNode);
                console.log(lrc);
                let lrcToggle = document.createElement('a');
                lrcToggle.style.cssText = 'margin-top:0.5rem;user-select: none;cursor: alias;';
                lrcToggle.innerHTML = '<i>切换LRC</i>';
                lrcToggle.className = 'u-btni u-btni-share';
                let lrcDown = document.createElement('a');
                lrcDown.style.cssText = 'margin-top:0.5rem;user-select: none;cursor: pointer;';
                lrcDown.innerHTML = '<i>下载LRC</i>';
                lrcDown.className = 'u-btni u-btni-dl';

                let lyricContent = document.querySelector('#lyric-content');
                let originLyricHTML = null;


                let showLRC = false;
                lrcToggle.addEventListener('click', (e) => {
                    if (!originLyricHTML) {
                        originLyricHTML = lyricContent.innerHTML;
                    }
                    if (showLRC) {
                        lyricContent.innerHTML = originLyricHTML;

                    } else {
                        lyricContent.innerHTML = lrcNode.outerHTML;

                    }
                    showLRC = !showLRC;
                });
                lrcDown.addEventListener('click', (e) => {
                    let prefix = `${String.prototype.padStart.call(song['no'], 2, 0)}`;
                    if (song['disc'] != '01' || parseInt(song['disc']) > 1) {
                        prefix = `${song['disc']}-${prefix}`;
                    }
                    const fileName = `${prefix}. ${song['name']}.lrc`;
                    // const fileName = document.title.split(` - ${document.querySelector('a[href^="/artist"]').text}`)[0];
                    download(strEncodeUTF16(lrc), fileName, 'application/octet-stream;charset=UTF-16BE;');
                });

                if (document.querySelector('#content-operation')) {
                    document.querySelector('#content-operation').append(lrcToggle);
                    document.querySelector('#content-operation').append(lrcDown);
                } else {
                    document.querySelector('.m-info').append(lrcDown);
                }
            };

            try {
                let lrc = await NetEaseMusicPlus.getLyrics(song['id']);
                lrc = lrc.split('\n').filter(x => /^\[[\d.:[\]]+\]|^$/.test(x)).join('\n');
                // console.log(song);
                lrc = `[ti:${song['name']}]\n[ar:${song['artists'].reduce((acc, cur) => `${acc}; ${cur['name']}`, '')}]\n[al:${song['album']['name']}]\n[by:]\n[offset:0]\n\n${lrc}`;
                addLyricsUI(lrc);
            } catch (error) {
                console.log(error);
                notify(error.message);
            }
        }



        async songHandle() {
            try {

                const id = new URL(this.containor.querySelector('link[rel="canonical"]').getAttribute('href')).searchParams.get('id');
                const detail = await this.getSongDetail(id);
                console.log(detail);
                if (detail['code'] !== 200 || detail['songs'].length < 1) {
                    notify('获取歌曲详情出错');
                    this.songLyrics({ id, });
                } else {

                    this.songLyrics(detail.songs[0]);
                }

            } catch (error) {
                console.log(error);
                notify(error.message);
            }
        }



        async albumLyrics() {
            this.styleNode.append('.NetEase-Music-Plus-Album-LRC-Item{cursor: pointer; line-height: 30px;}');
            this.styleNode.append('.NetEase-Music-Plus-Album-LRC-List { position: relative; display: flex; flex-direction: column; left: -2rem; width: 30px; transform: translateY(-100%); float: left;}');
            const containor = this.containor.createElement('div');
            containor.className = 'NetEase-Music-Plus-Album-LRC-List';
            for (let i of this.containor.querySelectorAll('span.txt>a')) {
                const id = i.href.split('?id=').pop();
                console.log('get lyrics for', i.children[0].title, id);

                let node = document.createElement('a');
                node.href = 'javascript:void(0)';
                node.textContent = 'LRC';
                node.title = `点击下载 "${i.children[0].title}" 歌词`;
                node.className = 'NetEase-Music-Plus-Album-LRC-Item';

                node.addEventListener('click', async (e) => {

                    try {

                        let lrc = await NetEaseMusicPlus.getLyrics(id);
                        lrc = lrc.split('\n').filter(x => /^\[[\d.:[\]]+\]|^$/.test(x)).join('\n');
                        let detail = await this.getSongDetail(id);
                        console.log(detail);
                        if (detail['code'] !== 200 || detail['songs'].length < 1) {
                            notify('获取歌曲详情出错');
                        }

                        const song = detail['songs'][0];
                        // console.log(this, '\n', song);
                        let fileName = id + '.lrc';
                        if (song) {
                            let prefix = `${String.prototype.padStart.call(song['no'], 2, 0)}`;
                            if (song['disc'] != '01' || parseInt(song['disc']) > 1) {
                                prefix = `${song['disc']}-${prefix}`;
                            }
                            fileName = `${prefix}. ${song['name']}.lrc`;
                            lrc = `[ti:${song['name']}]\n[ar:${song['artists'].reduce((acc, cur) => `${acc}; ${cur['name']}`, '')}]\n[al:${song['album']['name']}]\n[by:]\n[offset:0]\n\n${lrc}`;
                        }

                        console.log(fileName, '\n', lrc);
                        download(strEncodeUTF16(lrc), fileName, 'application/octet-stream;charset=UTF-16BE;');
                    } catch (error) {
                        console.log(error);
                        notify(error.message);
                    }
                });

                containor.append(node);
                this.containor.querySelector('#song-list-pre-cache').insertAdjacentElement('beforeend', containor);
                //line.insertAdjacentElement('beforeend', node)
            }
        }

        async albumHandle() {
            try {
                this.albumLyrics();

            } catch (error) {
                console.log(error);
                notify(error.message);
            }
        }
    }



    document.addEventListener('readystatechange', (e) => {
        console.log(e.target.readyState);
        if (e.target.readyState === 'complete') {
            // console.log(e.target);
            // console.log(location);
            if (e.target.contentFrame) {
                return;
            }
            let containor = document.querySelector('iframe[name=contentFrame]') || document;
            containor = containor.contentDocument || containor;
            const nmp = new NetEaseMusicPlus(containor);
            if (location.hash.startsWith('#/album') || location.pathname.startsWith('/album')) {
                nmp.albumHandle();
            }
            if (location.hash.startsWith('#/song') || location.pathname.startsWith('/song')) {
                // console.log('song');
                nmp.songHandle();
            }

        }
    });


})();