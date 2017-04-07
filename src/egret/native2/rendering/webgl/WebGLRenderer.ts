//////////////////////////////////////////////////////////////////////////////////////
//
//  Copyright (c) 2014-present, Egret Technology.
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

namespace egret.native2 {

    let blendModes = ["source-over", "lighter", "destination-out"];
    let defaultCompositeOp = "source-over";
    let BLACK_COLOR = "#000000";
    let CAPS_STYLES = { none: 'butt', square: 'square', round: 'round' };
    let renderBufferPool: WebGLRenderBuffer[] = [];//渲染缓冲区对象池
    /**
     * @private
     * WebGL渲染器
     */
    export class WebGLRenderer implements sys.SystemRenderer {

        public constructor() {

        }

        private nestLevel: number = 0;//渲染的嵌套层次，0表示在调用堆栈的最外层。
        /**
         * 渲染一个显示对象
         * @param displayObject 要渲染的显示对象
         * @param buffer 渲染缓冲
         * @param matrix 要对显示对象整体叠加的变换矩阵
         * @param dirtyList 脏矩形列表
         * @param forRenderTexture 绘制目标是RenderTexture的标志
         * @returns drawCall触发绘制的次数
         */
        public render(displayObject: DisplayObject, buffer: sys.RenderBuffer, matrix: Matrix, dirtyList?: egret.sys.Region[], forRenderTexture?: boolean): number {
            this.nestLevel++;
            let webglBuffer: WebGLRenderBuffer = <WebGLRenderBuffer>buffer;
            let webglBufferContext: WebGLRenderContext = webglBuffer.context;
            let root: DisplayObject = forRenderTexture ? displayObject : null;

            webglBufferContext.pushBuffer(webglBuffer);

            //绘制显示对象
            this.drawDisplayObject(displayObject, webglBuffer, dirtyList, matrix, null, null, root);
            webglBufferContext.$drawWebGL();
            let drawCall = webglBuffer.$drawCalls;
            webglBuffer.onRenderFinish();

            webglBufferContext.popBuffer();

            this.nestLevel--;
            if (this.nestLevel === 0) {
                //最大缓存6个渲染缓冲
                if (renderBufferPool.length > 6) {
                    renderBufferPool.length = 6;
                }
                let length = renderBufferPool.length;
                for (let i = 0; i < length; i++) {
                    renderBufferPool[i].resize(0, 0);
                }
            }

            webglBuffer.onRenderFinish2();
            return drawCall;
        }

        /**
         * @private
         * 绘制一个显示对象
         */
        private drawDisplayObject(displayObject: DisplayObject, buffer: WebGLRenderBuffer, dirtyList: egret.sys.Region[],
            matrix: Matrix, displayList: sys.DisplayList, clipRegion: sys.Region, root: DisplayObject): number {
            let drawCalls = 0;
            let node: sys.RenderNode;
            let filterPushed: boolean = false;
            if (displayList && !root) {
                if (displayList.isDirty) {
                    drawCalls += displayList.drawToSurface();
                }
                node = displayList.$renderNode;
            }
            else {
                node = displayObject.$getRenderNode();
            }

            if (node) {
                if (dirtyList) {
                    let renderRegion = node.renderRegion;
                    if (clipRegion && !clipRegion.intersects(renderRegion)) {
                        node.needRedraw = false;
                    }
                    else if (!node.needRedraw) {
                        let l = dirtyList.length;
                        for (let j = 0; j < l; j++) {
                            if (renderRegion.intersects(dirtyList[j])) {
                                node.needRedraw = true;
                                break;
                            }
                        }
                    }
                }
                else {
                    node.needRedraw = true;
                }
                if (node.needRedraw) {
                    drawCalls++;
                    let renderAlpha: number;
                    let m: Matrix;
                    if (root) {
                        renderAlpha = displayObject.$getConcatenatedAlphaAt(root, displayObject.$getConcatenatedAlpha());
                        m = Matrix.create().copyFrom(displayObject.$getConcatenatedMatrix());
                        displayObject.$getConcatenatedMatrixAt(root, m);
                        matrix.$preMultiplyInto(m, m);
                        buffer.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
                        Matrix.release(m);
                    }
                    else {
                        renderAlpha = node.renderAlpha;
                        m = node.renderMatrix;
                        buffer.setTransform(m.a, m.b, m.c, m.d, m.tx + matrix.tx, m.ty + matrix.ty);
                    }
                    buffer.globalAlpha = renderAlpha;
                    this.renderNode(node, buffer);
                    node.needRedraw = false;
                }
            }
            if (displayList && !root) {
                return drawCalls;
            }
            let children = displayObject.$children;
            if (children) {
                let length = children.length;
                for (let i = 0; i < length; i++) {
                    let child = children[i];
                    if (!child.$visible || child.$alpha <= 0 || child.$maskedObject) {
                        continue;
                    }
                    let filters = child.$getFilters();
                    if (filters && filters.length > 0) {
                        drawCalls += this.drawWithFilter(child, buffer, dirtyList, matrix, clipRegion, root);
                    }
                    else if ((child.$blendMode !== 0 ||
                        (child.$mask && (child.$mask.$parentDisplayList || root)))) {//若遮罩不在显示列表中，放弃绘制遮罩。
                        drawCalls += this.drawWithClip(child, buffer, dirtyList, matrix, clipRegion, root);
                    }
                    else if (child.$scrollRect || child.$maskRect) {
                        drawCalls += this.drawWithScrollRect(child, buffer, dirtyList, matrix, clipRegion, root);
                    }
                    else {
                        if (child["isFPS"]) {
                            buffer.context.$drawWebGL();
                            buffer.$computeDrawCall = false;
                            this.drawDisplayObject(child, buffer, dirtyList, matrix, child.$displayList, clipRegion, root);
                            buffer.context.$drawWebGL();
                            buffer.$computeDrawCall = true;
                        }
                        else {
                            drawCalls += this.drawDisplayObject(child, buffer, dirtyList, matrix,
                                child.$displayList, clipRegion, root);
                        }
                    }
                }
            }

            return drawCalls;
        }

        /**
         * @private
         */
        private drawWithFilter(displayObject: DisplayObject, buffer: WebGLRenderBuffer, dirtyList: egret.sys.Region[],
            matrix: Matrix, clipRegion: sys.Region, root: DisplayObject): number {
            let drawCalls = 0;
            let filters = displayObject.$getFilters();
            let hasBlendMode = (displayObject.$blendMode !== 0);
            let compositeOp: string;
            if (hasBlendMode) {
                compositeOp = blendModes[displayObject.$blendMode];
                if (!compositeOp) {
                    compositeOp = defaultCompositeOp;
                }
            }

            if (filters.length == 1 && filters[0].type == "colorTransform" && !displayObject.$children) {
                if (hasBlendMode) {
                    buffer.context.setGlobalCompositeOperation(compositeOp);
                }

                buffer.context.$filter = <ColorMatrixFilter>filters[0];
                if ((displayObject.$mask && (displayObject.$mask.$parentDisplayList || root))) {
                    drawCalls += this.drawWithClip(displayObject, buffer, dirtyList, matrix, clipRegion, root);
                }
                else if (displayObject.$scrollRect || displayObject.$maskRect) {
                    drawCalls += this.drawWithScrollRect(displayObject, buffer, dirtyList, matrix, clipRegion, root);
                }
                else {
                    drawCalls += this.drawDisplayObject(displayObject, buffer, dirtyList, matrix, displayObject.$displayList, clipRegion, root);
                }
                buffer.context.$filter = null;

                if (hasBlendMode) {
                    buffer.context.setGlobalCompositeOperation(defaultCompositeOp);
                }

                return drawCalls;
            }

            // 获取显示对象的链接矩阵
            let displayMatrix = Matrix.create();
            displayMatrix.copyFrom(displayObject.$getConcatenatedMatrix());
            if (root) {
                displayObject.$getConcatenatedMatrixAt(root, displayMatrix);
            }

            // 获取显示对象的矩形区域
            let region: sys.Region;
            region = sys.Region.create();
            let bounds = displayObject.$getOriginalBounds();
            region.updateRegion(bounds, displayMatrix);

            // 为显示对象创建一个新的buffer
            // todo 这里应该计算 region.x region.y
            let displayBuffer = this.createRenderBuffer(region.width, region.height);
            displayBuffer.context.pushBuffer(displayBuffer);
            displayBuffer.setTransform(1, 0, 0, 1, -region.minX, -region.minY);
            let offsetM = Matrix.create().setTo(1, 0, 0, 1, -region.minX, -region.minY);

            //todo 可以优化减少draw次数
            if ((displayObject.$mask && (displayObject.$mask.$parentDisplayList || root))) {
                drawCalls += this.drawWithClip(displayObject, displayBuffer, dirtyList, offsetM, region, root);
            }
            else if (displayObject.$scrollRect || displayObject.$maskRect) {
                drawCalls += this.drawWithScrollRect(displayObject, displayBuffer, dirtyList, offsetM, region, root);
            }
            else {
                drawCalls += this.drawDisplayObject(displayObject, displayBuffer, dirtyList, offsetM, displayObject.$displayList, region, root);
            }

            Matrix.release(offsetM);
            displayBuffer.context.popBuffer();

            //绘制结果到屏幕
            if (drawCalls > 0) {

                if (hasBlendMode) {
                    buffer.context.setGlobalCompositeOperation(compositeOp);
                }

                drawCalls++;
                buffer.globalAlpha = 1;
                buffer.setTransform(1, 0, 0, 1, region.minX + matrix.tx, region.minY + matrix.ty);
                // 绘制结果的时候，应用滤镜
                buffer.context.drawTargetWidthFilters(filters, displayBuffer);

                if (hasBlendMode) {
                    buffer.context.setGlobalCompositeOperation(defaultCompositeOp);
                }

            }

            renderBufferPool.push(displayBuffer);
            sys.Region.release(region);
            Matrix.release(displayMatrix);

            return drawCalls;
        }

        /**
         * @private
         */
        private drawWithClip(displayObject: DisplayObject, buffer: WebGLRenderBuffer, dirtyList: egret.sys.Region[],
            matrix: Matrix, clipRegion: sys.Region, root: DisplayObject): number {
            let drawCalls = 0;
            let hasBlendMode = (displayObject.$blendMode !== 0);
            let compositeOp: string;
            if (hasBlendMode) {
                compositeOp = blendModes[displayObject.$blendMode];
                if (!compositeOp) {
                    compositeOp = defaultCompositeOp;
                }
            }

            let scrollRect = displayObject.$scrollRect ? displayObject.$scrollRect : displayObject.$maskRect;
            let mask = displayObject.$mask;
            if (mask) {
                let maskRenderNode = mask.$getRenderNode();
                if (maskRenderNode) {
                    let maskRenderMatrix = maskRenderNode.renderMatrix;
                    //遮罩scaleX或scaleY为0，放弃绘制
                    if ((maskRenderMatrix.a == 0 && maskRenderMatrix.b == 0) || (maskRenderMatrix.c == 0 && maskRenderMatrix.d == 0)) {
                        return drawCalls;
                    }
                }
            }
            //if (mask && !mask.$parentDisplayList) {
            //    mask = null; //如果遮罩不在显示列表中，放弃绘制遮罩。
            //}

            //计算scrollRect和mask的clip区域是否需要绘制，不需要就直接返回，跳过所有子项的遍历。
            let maskRegion: sys.Region;
            let displayMatrix = Matrix.create();
            displayMatrix.copyFrom(displayObject.$getConcatenatedMatrix());
            if (displayObject.$parentDisplayList) {
                let displayRoot = displayObject.$parentDisplayList.root;
                if (displayRoot !== displayObject.$stage) {
                    displayObject.$getConcatenatedMatrixAt(displayRoot, displayMatrix);
                }
            }

            let bounds: Rectangle;
            if (mask) {
                bounds = mask.$getOriginalBounds();
                maskRegion = sys.Region.create();
                let m = Matrix.create();
                m.copyFrom(mask.$getConcatenatedMatrix());
                maskRegion.updateRegion(bounds, m);
                Matrix.release(m);
            }
            let region: sys.Region;
            if (scrollRect) {
                region = sys.Region.create();
                region.updateRegion(scrollRect, displayMatrix);
            }
            if (region && maskRegion) {
                region.intersect(maskRegion);
                sys.Region.release(maskRegion);
            }
            else if (!region && maskRegion) {
                region = maskRegion;
            }
            if (region) {
                if (region.isEmpty() || (clipRegion && !clipRegion.intersects(region))) {
                    sys.Region.release(region);
                    Matrix.release(displayMatrix);
                    return drawCalls;
                }
            }
            else {
                region = sys.Region.create();
                bounds = displayObject.$getOriginalBounds();
                region.updateRegion(bounds, displayMatrix);
            }
            let found = false;
            if (!dirtyList) {//forRenderTexture
                found = true;
            }
            else {
                let l = dirtyList.length;
                for (let j = 0; j < l; j++) {
                    if (region.intersects(dirtyList[j])) {
                        found = true;
                        break;
                    }
                }
            }
            if (!found) {
                sys.Region.release(region);
                Matrix.release(displayMatrix);
                return drawCalls;
            }

            //没有遮罩,同时显示对象没有子项
            if (!mask && (!displayObject.$children || displayObject.$children.length == 0)) {
                if (scrollRect) {
                    let m = displayMatrix;
                    buffer.setTransform(m.a, m.b, m.c, m.d, m.tx - region.minX, m.ty - region.minY);
                    buffer.context.pushMask(scrollRect);
                }
                //绘制显示对象
                if (hasBlendMode) {
                    buffer.context.setGlobalCompositeOperation(compositeOp);
                }
                drawCalls += this.drawDisplayObject(displayObject, buffer, dirtyList, matrix,
                    displayObject.$displayList, clipRegion, root);
                if (hasBlendMode) {
                    buffer.context.setGlobalCompositeOperation(defaultCompositeOp);
                }
                if (scrollRect) {
                    buffer.context.popMask();
                }
                sys.Region.release(region);
                Matrix.release(displayMatrix);
                return drawCalls;
            }
            else {
                //绘制显示对象自身，若有scrollRect，应用clip
                let displayBuffer = this.createRenderBuffer(region.width, region.height);
                // let displayContext = displayBuffer.context;
                displayBuffer.context.pushBuffer(displayBuffer);
                displayBuffer.setTransform(1, 0, 0, 1, -region.minX, -region.minY);
                let offsetM = Matrix.create().setTo(1, 0, 0, 1, -region.minX, -region.minY);

                drawCalls += this.drawDisplayObject(displayObject, displayBuffer, dirtyList, offsetM,
                    displayObject.$displayList, region, root);
                //绘制遮罩
                if (mask) {
                    //如果只有一次绘制或是已经被cache直接绘制到displayContext
                    //webgl暂时无法添加,因为会有边界像素没有被擦除
                    //let maskRenderNode = mask.$getRenderNode();
                    //if (maskRenderNode && maskRenderNode.$getRenderCount() == 1 || mask.$displayList) {
                    //    displayBuffer.context.setGlobalCompositeOperation("destination-in");
                    //    drawCalls += this.drawDisplayObject(mask, displayBuffer, dirtyList, offsetM,
                    //        mask.$displayList, region, root);
                    //}
                    //else {
                    let maskBuffer = this.createRenderBuffer(region.width, region.height);
                    maskBuffer.context.pushBuffer(maskBuffer);
                    maskBuffer.setTransform(1, 0, 0, 1, -region.minX, -region.minY);
                    offsetM = Matrix.create().setTo(1, 0, 0, 1, -region.minX, -region.minY);
                    drawCalls += this.drawDisplayObject(mask, maskBuffer, dirtyList, offsetM,
                        mask.$displayList, region, root);
                    maskBuffer.context.popBuffer();
                    displayBuffer.context.setGlobalCompositeOperation("destination-in");
                    displayBuffer.setTransform(1, 0, 0, -1, 0, maskBuffer.height);
                    displayBuffer.globalAlpha = 1;
                    let maskBufferWidth = maskBuffer.rootRenderTarget.width;
                    let maskBufferHeight = maskBuffer.rootRenderTarget.height;
                    displayBuffer.context.drawTexture(maskBuffer.rootRenderTarget.texture, 0, 0, maskBufferWidth, maskBufferHeight,
                        0, 0, maskBufferWidth, maskBufferHeight, maskBufferWidth, maskBufferHeight);
                    displayBuffer.context.setGlobalCompositeOperation("source-over");
                    renderBufferPool.push(maskBuffer);
                    //}
                }
                Matrix.release(offsetM);

                displayBuffer.context.setGlobalCompositeOperation(defaultCompositeOp);
                displayBuffer.context.popBuffer();

                //绘制结果到屏幕
                if (drawCalls > 0) {
                    drawCalls++;
                    if (hasBlendMode) {
                        buffer.context.setGlobalCompositeOperation(compositeOp);
                    }
                    if (scrollRect) {
                        let m = displayMatrix;
                        displayBuffer.setTransform(m.a, m.b, m.c, m.d, m.tx - region.minX, m.ty - region.minY);
                        displayBuffer.context.pushMask(scrollRect);
                    }
                    buffer.globalAlpha = 1;
                    buffer.setTransform(1, 0, 0, -1, region.minX + matrix.tx, region.minY + matrix.ty + displayBuffer.height);
                    let displayBufferWidth = displayBuffer.rootRenderTarget.width;
                    let displayBufferHeight = displayBuffer.rootRenderTarget.height;
                    buffer.context.drawTexture(displayBuffer.rootRenderTarget.texture, 0, 0, displayBufferWidth, displayBufferHeight,
                        0, 0, displayBufferWidth, displayBufferHeight, displayBufferWidth, displayBufferHeight);
                    if (scrollRect) {
                        displayBuffer.context.popMask();
                    }
                    if (hasBlendMode) {
                        buffer.context.setGlobalCompositeOperation(defaultCompositeOp);
                    }
                }

                renderBufferPool.push(displayBuffer);
                sys.Region.release(region);
                Matrix.release(displayMatrix);

                return drawCalls;
            }
        }

        /**
         * @private
         */
        private drawWithScrollRect(displayObject: DisplayObject, buffer: WebGLRenderBuffer, dirtyList: egret.sys.Region[],
            matrix: Matrix, clipRegion: sys.Region, root: DisplayObject): number {
            let drawCalls = 0;
            let scrollRect = displayObject.$scrollRect ? displayObject.$scrollRect : displayObject.$maskRect;
            if (scrollRect.isEmpty()) {
                return drawCalls;
            }
            let m = Matrix.create();
            m.copyFrom(displayObject.$getConcatenatedMatrix());
            if (root) {
                displayObject.$getConcatenatedMatrixAt(root, m);
            }
            else if (displayObject.$parentDisplayList) {
                let displayRoot = displayObject.$parentDisplayList.root;
                if (displayRoot !== displayObject.$stage) {
                    displayObject.$getConcatenatedMatrixAt(displayRoot, m);
                }
            }
            let region: sys.Region = sys.Region.create();
            region.updateRegion(scrollRect, m);
            if (region.isEmpty() || (clipRegion && !clipRegion.intersects(region))) {
                sys.Region.release(region);
                Matrix.release(m);
                return drawCalls;
            }
            let found = false;
            if (!dirtyList) {//forRenderTexture
                found = true;
            }
            else {
                let l = dirtyList.length;
                for (let j = 0; j < l; j++) {
                    if (region.intersects(dirtyList[j])) {
                        found = true;
                        break;
                    }
                }
            }
            if (!found) {
                sys.Region.release(region);
                Matrix.release(m);
                return drawCalls;
            }

            //绘制显示对象自身
            buffer.setTransform(m.a, m.b, m.c, m.d, m.tx + matrix.tx, m.ty + matrix.ty);

            let context = buffer.context;
            let scissor = false;
            if (buffer.$hasScissor || m.b != 0 || m.c != 0) {// 有旋转的情况下不能使用scissor
                context.pushMask(scrollRect);
            } else {
                let a = m.a;
                let d = m.d;
                let tx = m.tx;
                let ty = m.ty;
                let x = scrollRect.x;
                let y = scrollRect.y;
                let xMax = x + scrollRect.width;
                let yMax = y + scrollRect.height;
                let minX: number, minY: number, maxX: number, maxY: number;
                //优化，通常情况下不缩放的对象占多数，直接加上偏移量即可。
                if (a == 1.0 && d == 1.0) {
                    minX = x + tx;
                    minY = y + ty;
                    maxX = xMax + tx;
                    maxY = yMax + ty;
                }
                else {
                    let x0 = a * x + tx;
                    let y0 = d * y + ty;
                    let x1 = a * xMax + tx;
                    let y1 = d * y + ty;
                    let x2 = a * xMax + tx;
                    let y2 = d * yMax + ty;
                    let x3 = a * x + tx;
                    let y3 = d * yMax + ty;

                    let tmp = 0;

                    if (x0 > x1) {
                        tmp = x0;
                        x0 = x1;
                        x1 = tmp;
                    }
                    if (x2 > x3) {
                        tmp = x2;
                        x2 = x3;
                        x3 = tmp;
                    }

                    minX = (x0 < x2 ? x0 : x2);
                    maxX = (x1 > x3 ? x1 : x3);

                    if (y0 > y1) {
                        tmp = y0;
                        y0 = y1;
                        y1 = tmp;
                    }
                    if (y2 > y3) {
                        tmp = y2;
                        y2 = y3;
                        y3 = tmp;
                    }

                    minY = (y0 < y2 ? y0 : y2);
                    maxY = (y1 > y3 ? y1 : y3);
                }
                context.enableScissor(minX + matrix.tx, -matrix.ty - maxY + buffer.height, maxX - minX, maxY - minY);
                scissor = true;
            }

            drawCalls += this.drawDisplayObject(displayObject, buffer, dirtyList, matrix, displayObject.$displayList, region, root);
            buffer.setTransform(m.a, m.b, m.c, m.d, m.tx + matrix.tx, m.ty + matrix.ty);

            if (scissor) {
                context.disableScissor();
            } else {
                context.popMask();
            }

            sys.Region.release(region);
            Matrix.release(m);
            return drawCalls;
        }

        /**
         * 将一个RenderNode对象绘制到渲染缓冲
         * @param node 要绘制的节点
         * @param buffer 渲染缓冲
         * @param matrix 要叠加的矩阵
         * @param forHitTest 绘制结果是用于碰撞检测。若为true，当渲染GraphicsNode时，会忽略透明度样式设置，全都绘制为不透明的。
         */
        public drawNodeToBuffer(node: sys.RenderNode, buffer: WebGLRenderBuffer, matrix: Matrix, forHitTest?: boolean): void {
            let webglBuffer: WebGLRenderBuffer = <WebGLRenderBuffer>buffer;

            //pushRenderTARGET
            webglBuffer.context.pushBuffer(webglBuffer);

            webglBuffer.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty);
            this.renderNode(node, buffer, forHitTest);
            webglBuffer.context.$drawWebGL();
            webglBuffer.onRenderFinish();

            //popRenderTARGET
            webglBuffer.context.popBuffer();
        }

        public drawNodeToBufferNative(node:sys.RenderNode, forHitTest?:boolean, localX?:number, localY?:number):boolean {
            let gNode: sys.GraphicsNode = <sys.GraphicsNode>node;
            let width: number = gNode.width;
            if (width == undefined) {
                return;
            }
            let height: number = gNode.height;
            let getPixels: boolean = false;
            if (gNode.x || gNode.y) {
                egret_native.Graphics.translate(-gNode.x, -gNode.y);
            }
            if (forHitTest) {
                egret_native.Graphics.bindTexture(gNode.$texture, width, height);
                let drawData = node.drawData;
                let length = drawData.length;

                for (var i = 0; i < length; i++) {
                    var path = drawData[i];
                    switch (path.type) {
                        case 1 /* Fill */:
                            egret_native.Graphics.beginPath();
                            this.renderPath(path);
                            egret_native.Graphics.fill(0, 1);
                            break;
                        case 2 /* GradientFill */:
                            // console.log("GradientFill");
                            this.renderPath(path);
                            break;
                        case 3 /* Stroke */:
                            egret_native.Graphics.beginPath();
                            this.renderPath(path);
                            egret_native.Graphics.stroke(0, 1, path.lineWidth);
                            break;
                    }
                }
                egret_native.Graphics.generateTexture();
                getPixels = egret_native.Graphics.getPixelsAt(localX, localY);
            }
            if (gNode.x || gNode.y) {
                egret_native.Graphics.translate(gNode.x, gNode.y);
            }

            gNode.dirtyRender = true;
            return getPixels;
        }

        /**
         * @private
         */
        private renderNode(node: sys.RenderNode, buffer: WebGLRenderBuffer, forHitTest?: boolean): void {
            switch (node.type) {
                case sys.RenderNodeType.BitmapNode:
                    this.renderBitmap(<sys.BitmapNode>node, buffer);
                    break;
                case sys.RenderNodeType.TextNode:
                    this.renderText(<sys.TextNode>node, buffer);
                    break;
                case sys.RenderNodeType.GraphicsNode:
                    this.renderGraphics(<sys.GraphicsNode>node, buffer, forHitTest);
                    break;
                case sys.RenderNodeType.GroupNode:
                    this.renderGroup(<sys.GroupNode>node, buffer);
                    break;
                case sys.RenderNodeType.SetAlphaNode:
                    buffer.globalAlpha = node.drawData[0];
                    break;
                case sys.RenderNodeType.MeshNode:
                    this.renderMesh(<sys.MeshNode>node, buffer);
                    break;
            }
        }

        /**
         * @private
         */
        private renderBitmap(node: sys.BitmapNode, buffer: WebGLRenderBuffer): void {
            let image = node.image;
            if (!image) {
                return;
            }
            //buffer.imageSmoothingEnabled = node.smoothing;
            let data = node.drawData;
            let length = data.length;
            let pos = 0;
            let m = node.matrix;
            let blendMode = node.blendMode;
            let alpha = node.alpha;
            if (m) {
                buffer.saveTransform();
                buffer.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);
            }
            //这里不考虑嵌套
            if (blendMode) {
                buffer.context.setGlobalCompositeOperation(blendModes[blendMode]);
            }
            let originAlpha: number;
            if (alpha == alpha) {
                originAlpha = buffer.globalAlpha;
                buffer.globalAlpha *= alpha;
            }
            if (node.filter) {
                buffer.context.$filter = node.filter;
                while (pos < length) {
                    buffer.context.drawImage(image, data[pos++], data[pos++], data[pos++], data[pos++],
                        data[pos++], data[pos++], data[pos++], data[pos++], node.imageWidth, node.imageHeight);
                }
                buffer.context.$filter = null;
            }
            else {
                while (pos < length) {
                    buffer.context.drawImage(image, data[pos++], data[pos++], data[pos++], data[pos++],
                        data[pos++], data[pos++], data[pos++], data[pos++], node.imageWidth, node.imageHeight);
                }
            }
            if (blendMode) {
                buffer.context.setGlobalCompositeOperation(defaultCompositeOp);
            }
            if (alpha == alpha) {
                buffer.globalAlpha = originAlpha;
            }
            if (m) {
                buffer.restoreTransform();
            }
        }

        /**
         * @private
         */
        private renderMesh(node: sys.MeshNode, buffer: WebGLRenderBuffer): void {
            let image = node.image;
            //buffer.imageSmoothingEnabled = node.smoothing;
            let data = node.drawData;
            let length = data.length;
            let pos = 0;
            let m = node.matrix;
            if (m) {
                buffer.saveTransform();
                buffer.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);
            }
            while (pos < length) {
                buffer.context.drawMesh(image, data[pos++], data[pos++], data[pos++], data[pos++],
                    data[pos++], data[pos++], data[pos++], data[pos++], node.imageWidth, node.imageHeight, node.uvs, node.vertices, node.indices, node.bounds);
            }
            if (m) {
                buffer.restoreTransform();
            }
        }

        private canvasRenderer: CanvasRenderer;
        private canvasRenderBuffer: CanvasRenderBuffer;

        /**
         * @private
         */
        private renderText(node: sys.TextNode, buffer: WebGLRenderBuffer): void {

            if (node.drawData.length == 0) {
                return;
            }

            let width = node.width - node.x;
            let height = node.height - node.y;

            if (node.x || node.y) {
                buffer.transform(1, 0, 0, 1, node.x, node.y);
            }

            if (!node.$texture) {
                var canvas = window["canvas"];
                var context = canvas.getContext("webgl");
                             
                var gl = context;
                var texture = gl.createTexture();
                if (!texture) {
                    //先创建texture失败,然后lost事件才发出来..
                    console.log("------ !texture");
                    return;
                }
                
                gl.bindTexture(gl.TEXTURE_2D, texture);
                
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

                node.$texture = texture;
            }

            if (node.dirtyRender) {
                egret_native.Label.bindTexture(node.$texture, width, height);
                             
                var drawData = node.drawData;
                var length = drawData.length;
                var pos = 0;
                while (pos < length) {
                    var x = drawData[pos++];
                    var y = drawData[pos++];
                    var text = drawData[pos++];
                    var format = drawData[pos++];
                    var size = format.size == null ? node.size : format.size;
                    var textColor = format.textColor == null ? node.textColor : format.textColor;
                    var stroke = format.stroke == null ? node.stroke : format.stroke;
                    var strokeColor = format.strokeColor == null ? node.strokeColor : format.strokeColor;
                    egret_native.Label.drawText(x, y, text, size, textColor, stroke, strokeColor);
                }
                egret_native.Label.generateTexture();
                node.$textureWidth = width;
                node.$textureHeight = height;
            }
//
            var textureWidth = node.$textureWidth;
            var textureHeight = node.$textureHeight;
            buffer.context.drawTexture(node.$texture, 0, 0, textureWidth, textureHeight, 0, 0, textureWidth, textureHeight, textureWidth, textureHeight);
                             
            if (node.x || node.y) {
                buffer.transform(1, 0, 0, 1, -node.x, -node.y);
            }
            
            node.dirtyRender = false;
                             
            return;

            // // lj
            // var drawData = node.drawData;
            // var length = drawData.length;
            // var pos = 0;
            // while (pos < length) {
            //     var x = drawData[pos++];
            //     var y = drawData[pos++];
            //     var text = drawData[pos++];
            //     var format = drawData[pos++];
            //     // context.font = getFontString(node, format);
            //     var textColor = format.textColor == null ? node.textColor : format.textColor;
            //     var strokeColor = format.strokeColor == null ? node.strokeColor : format.strokeColor;
            //     var stroke = format.stroke == null ? node.stroke : format.stroke;
            //     var size = format.size == null ? node.size : format.size;
            //     // context.fillStyle = egret.toColorString(textColor);
            //     // context.strokeStyle = egret.toColorString(strokeColor);
            //     // if (stroke) {
            //         // context.lineWidth = stroke * 2;
            //         // context.strokeText(text, x, y);
            //     // }
            //     // context.fillText(text, x, y);
            //     var atlasAddr = egret_native.Label.createLabel("", size, "", stroke);

            //     var transformDirty = false;

            //     if (x != 0 || y != 0) {
            //         transformDirty = true;
            //         buffer.saveTransform();
            //         buffer.transform(1, 0, 0, 1, x, y);
            //     }

            //     buffer.context.drawText(text, size, 0, 0, textColor, stroke, strokeColor, atlasAddr);

            //     if (transformDirty) {
            //         buffer.restoreTransform();
            //     }
            // }
        }

        /**
         * @private
         */
        private renderGraphics(node: sys.GraphicsNode, buffer: WebGLRenderBuffer, forHitTest?: boolean): void {
            let width = node.width;
            if (width == undefined) {
                return;
            }
            let height = node.height;
            if (node.x || node.y) {
                egret_native.Graphics.translate(-node.x, -node.y);
                buffer.transform(1, 0, 0, 1, node.x, node.y);
            }

            if (!node.$texture) {
                let canvas = window["canvas"];
                let context = canvas.getContext("webgl");
                let gl = context;
                let texture = gl.createTexture();
                if (!texture) {
                    //先创建texture失败,然后lost事件才发出来..
                    console.log("------ !texture");
                    return;
                }
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                node.$texture = texture;
            }
            if (node.dirtyRender) {
                egret_native.Graphics.bindTexture(node.$texture, width, height);

                let drawData = node.drawData;
                let length = drawData.length;
                for (let i = 0; i < length; i++) {
                    let path = drawData[i];
                    switch (path.type) {
                        case 1 /* Fill */:
                            egret_native.Graphics.beginPath();
                            this.renderPath(path);
                            egret_native.Graphics.fill(path.fillColor, path.fillAlpha);
                            break;
                        case 2 /* GradientFill */:
                            console.log("GradientFill");
                            this.renderPath(path);
                            break;
                        case 3 /* Stroke */:
                            egret_native.Graphics.beginPath();
                            this.renderPath(path);
                            egret_native.Graphics.stroke(path.lineColor, path.lineAlpha, path.lineWidth);
                            break;
                    }
                }

                egret_native.Graphics.generateTexture();
                node.$textureWidth = width;
                node.$textureHeight = height;
            }

            let textureWidth = node.$textureWidth;
            let textureHeight = node.$textureHeight;
            buffer.context.drawTexture(node.$texture, 0, 0, textureWidth, textureHeight, 0, 0,
                textureWidth, textureHeight, textureWidth, textureHeight);
            if (node.x || node.y) {
                egret_native.Graphics.translate(node.x, node.y);
                buffer.transform(1, 0, 0, 1, -node.x, -node.y);
            }
            node.dirtyRender = false;
        }

        private renderPath(path: sys.Path2D): void {
            let data = path.$data;
            let commands = path.$commands;
            let commandCount = commands.length;
            let pos = 0;
            for (let commandIndex = 0; commandIndex < commandCount; commandIndex++) {
                let command = commands[commandIndex];
                switch (command) {
                    case 4 /* CubicCurveTo */:
                        egret_native.Graphics.cubicCurveTo(data[pos++], data[pos++], data[pos++], data[pos++], data[pos++], data[pos++]);
                        break;
                    case 3 /* CurveTo */:
                        egret_native.Graphics.curveTo(data[pos++], data[pos++], data[pos++], data[pos++]);
                        break;
                    case 2 /* LineTo */:
                        egret_native.Graphics.lineTo(data[pos++], data[pos++]);
                        break;
                    case 1 /* MoveTo */:
                        egret_native.Graphics.moveTo(data[pos++], data[pos++]);
                        break;
                }
            }
        }

        private renderGroup(groupNode: sys.GroupNode, buffer: WebGLRenderBuffer): void {
            let m = groupNode.matrix;
            if (m) {
                buffer.saveTransform();
                buffer.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);
            }

            let children = groupNode.drawData;
            let length = children.length;
            for (let i = 0; i < length; i++) {
                let node: sys.RenderNode = children[i];
                this.renderNode(node, buffer);
            }

            if (m) {
                buffer.restoreTransform();
            }
        }

        /**
         * @private
         */
        private createRenderBuffer(width: number, height: number): WebGLRenderBuffer {
            let buffer = renderBufferPool.pop();
            if (buffer) {
                buffer.resize(width, height);
            }
            else {
                buffer = new WebGLRenderBuffer(width, height);
                buffer.$computeDrawCall = false;
            }
            return buffer;
        }
    }
}
