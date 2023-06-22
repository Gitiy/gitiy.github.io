// ==UserScript==
// @name         +YouTube Playback Qulity
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Youtube 播放视频时自动切换视频质量
// @author       You
// @match        https://www.youtube.com/*
// @grant        none
// @reference    https://developer.mozilla.org/zh-CN/docs/Web/API/MutationObserver
// ==/UserScript==

(function() {
    'use strict';

    var globalObserver,
        allQulityLevels=["highres", "hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny", "auto"],
        qulityLevel = allQulityLevels[3],
        mo = null;

    function switchQulity(){
        try{
            var player = document.querySelector("#movie_player");
            //console.log(player);
            if(player.getPlaybackQuality() == qulityLevel && player.getPreferredQuality() != "auto"){
                return;
            }
            if(player.getPreferredQuality() == "auto"){
                console.log(`cureent Current / Optimal Res: ${player.getPlaybackQuality()}/${player.getPreferredQuality()}`)
            }
            if(null !== player){
                if(player.getAvailableQualityLevels().includes(qulityLevel)){
                    player.setPlaybackQualityRange([qulityLevel]);
                    console.log(`Switched to ${qulityLevel}`);
                }else{
                    if(player.getAvailableQualityLevels()[0] === undefined){
                        setTimeout(switchQulity, 1000);
                    }else{
                        player.setPlaybackQualityRange([player.getAvailableQualityLevels()[0]]);
                        console.log("Switched to",player.getAvailableQualityLevels()[0]);
                    }
                }
            }else{
                console.log("Not Found Player");
            }
        }catch(err){
            console.error(err);
        }finally{

        }
    }
    function callback(){
        if(!document.querySelector("video")){
            setTimeout(callback,1000);
            return;
        }

        document.querySelector("video").addEventListener("canplay", switchQulity);
        //moni();
    }

    function moni(){
        var observer = new MutationObserver(function(mutations){
            observer.disconnect();
            console.log(mutations);
            switchQulity();
        });
        observer.observe(document.querySelector("video"), {attributes:true,attributeFilter:["src"]});
    }
    /*
    document.addEventListener("DOMContentLoaded",function(){
        console.log(document.readyState);
        switchQulity();
        callback();
    });
    */
    document.onreadystatechange = function(){
        console.log(document.readyState);
        //switchQulity();
        callback();
    };

    // 前进后退
    window.onpopstate = function(e){
        callback();
    };
})();
