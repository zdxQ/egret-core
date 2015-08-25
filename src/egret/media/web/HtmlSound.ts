//////////////////////////////////////////////////////////////////////////////////////
//
//  Copyright (c) 2014-2015, Egret Technology Inc.
//  All rights reserved.
//  Redistribution and use in source and binary forms, with or without
//  modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright
//       notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//     * Neither the name of the Egret nor the
//       names of its contributors may be used to endorse or promote products
//       derived from this software without specific prior written permission.
//
//  THIS SOFTWARE IS PROVIDED BY EGRET AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
//  OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
//  OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
//  IN NO EVENT SHALL EGRET AND CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
//  INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
//  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;LOSS OF USE, DATA,
//  OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
//  LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
//  NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
//  EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
//////////////////////////////////////////////////////////////////////////////////////

module egret.web {

    /**
     * @private
     * @inheritDoc
     */
    export class HtmlSound extends egret.EventDispatcher implements egret.Sound {
        /**
         * @language en_US
         * Background music
         * @version Egret 2.0
         * @platform Web,Native
         */
        /**
         * @language zh_CN
         * 背景音乐
         * @version Egret 2.0
         * @platform Web,Native
         */
        public static MUSIC:string = "music";

        /**
         * @language en_US
         * EFFECT
         * @version Egret 2.0
         * @platform Web,Native
         */
        /**
         * @language zh_CN
         * 音效
         * @version Egret 2.0
         * @platform Web,Native
         */
        public static EFFECT:string = "effect";

        /**
         * @private
         */
        public type:string;

        /**
         * @private
         */
        private url:string;
        /**
         * @private
         */
        private originAudio:HTMLAudioElement;
        /**
         * @private
         */
        private loaded:boolean = false;

        /**
         * @private
         * @inheritDoc
         */
        constructor() {
            super();
        }

        /**
         * @inheritDoc
         */
        public load(url:string) {
            var self = this;

            this.url = url;

            if (DEBUG && !url) {
                egret.$error(3002);
            }
            var audio = new Audio(url);
            audio.addEventListener("canplaythrough", onAudioLoaded);
            audio.addEventListener("error", onAudioError);
            audio.load();
            this.originAudio = audio;
            HtmlSound.$recycle(this.url, audio);

            function onAudioLoaded():void {
                removeListeners();

                self.loaded = true;
                self.dispatchEventWith(egret.Event.COMPLETE);
            }

            function onAudioError():void {
                removeListeners();

                self.dispatchEventWith(egret.IOErrorEvent.IO_ERROR);
            }

            function removeListeners():void {
                audio.removeEventListener("canplaythrough", onAudioLoaded);
                audio.removeEventListener("error", onAudioError);
            }
        }

        /**
         * @inheritDoc
         */
        public play(startTime:number = 0, loops:number = 0):SoundChannel {
            if (DEBUG && this.loaded == false) {
                egret.$error(3001);
            }

            var audio = HtmlSound.$pop(this.url);
            if (audio == null) {
                audio = <HTMLAudioElement>this.originAudio.cloneNode();
            }
            else {
                audio.load();
            }
            audio.autoplay = true;

            var channel = new HtmlSoundChannel(audio);
            channel.$url = this.url;
            channel.$loops = loops;
            channel.$startTime = startTime;
            channel.$play();
            return channel;
        }

        public preload(type:string, callback:Function = null, thisObj:any = null):void {
            this.type = type;

            if (callback) {
                window.setTimeout(function() {
                    callback.call(thisObj);
                }, 0);
            }
        }

        /**
         * @inheritDoc
         */
        public close() {
            if (this.loaded == false && this.originAudio)
                this.originAudio.src = "";
            if (this.originAudio)
                this.originAudio = null;
            HtmlSound.$clear(this.url);
        }

        /**
         * @private
         */
        private static audios:Object = {};

        static $clear(url:string):void {
            var array:HTMLAudioElement[] = HtmlSound.audios[url];
            if (array) {
                array.length = 0;
            }
        }

        static $pop(url:string):HTMLAudioElement {
            var array:HTMLAudioElement[] = HtmlSound.audios[url];
            if (array && array.length > 0) {
                return array.pop();
            }
            return null;
        }

        static $recycle(url:string, audio:HTMLAudioElement):void {
            var array:HTMLAudioElement[] = HtmlSound.audios[url];
            if (HtmlSound.audios[url] == null) {
                array = HtmlSound.audios[url] = [];
            }
            array.push(audio);
        }
    }
}