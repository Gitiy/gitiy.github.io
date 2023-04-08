// ==UserScript==
// @name         +iTunes Uncompressed High Resolution Artwork
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        https://music.apple.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=apple.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    let timer = null;
    function addOrginalArtwork(){
        console.log('addOrginalArtwork');
        let artwork = document.querySelector('div[data-testid="artwork-component"] source');
        console.log(artwork)
        if(artwork){
            if(timer){
                clearInterval(timer);
            }
        }
        let uri = artwork.srcset.split(' ')[0];
        let uncompressed_high_resolution_uri = uri.replace(/https?:\/\/[\d\w\/\.\-]+thumb\//,'https://a5.mzstatic.com/us/r1000/0/');
        uncompressed_high_resolution_uri = uncompressed_high_resolution_uri.substring(0,uncompressed_high_resolution_uri.lastIndexOf('/'));
        document.documentElement.insertAdjacentHTML('afterBegin',`<a href=${uncompressed_high_resolution_uri} target="_blank" class="product-creator typography-large-title">orignal</a>`);
    }
    window.onload=()=>{
        let currentLocation = location.href;
        const observer = new MutationObserver((mutationList)=>{
            if(location.href != currentLocation){
                currentLocation = location.href;
                console.log(currentLocation)
                if(location.href.includes('/album/')){
                    if(timer){
                        clearInterval(timer);
                    }
                    timer=setInterval(addOrginalArtwork,1000);
                }
            }
        });
        observer.observe(
            document.querySelector('#scrollable-page'),
            {
                childList: true,

                // important for performance
                subtree: false
            });

        if(location.href.includes('/album/')){
            addOrginalArtwork();
        }
    };

})();
