/**
 * 工具函数模块
 *
 * 提供API请求封装、Toast通知、Canvas绘制等通用工具函数，
 * 供图片检测、摄像头检测等业务模块调用。
 */

const API_BASE = '';  // 同源部署，无需配置基础路径

/**
 * 发送人脸检测API请求
 *
 * @param {string} endpoint - API端点路径，如'/api/detect/image'或'/api/detect/frame'
 * @param {string} base64Image - Base64编码的图像数据（可包含data:image前缀）
 * @param {number} confThreshold - 置信度阈值，范围0.1-0.9
 * @param {number} iouThreshold - NMS IoU阈值，范围0.1-0.9
 * @returns {Promise<Object>} 检测结果对象，包含faces、count、inference_time、image_shape
 * @throws {Error} 当网络请求失败或服务端返回错误时抛出异常
 *
 * @example
 * const result = await detectRequest('/api/detect/image', base64Str, 0.5, 0.45);
 * console.log(result.count); // 检测到的人脸数量
 */
async function detectRequest(endpoint, base64Image, confThreshold, iouThreshold) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image: base64Image,
            conf_threshold: confThreshold,
            iou_threshold: iouThreshold
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: '请求失败' }));
        throw new Error(errorData.detail || `请求失败 (${response.status})`);
    }

    return await response.json();
}

/**
 * 检查后端服务健康状态
 *
 * @returns {Promise<Object>} 健康状态对象，包含status、model_loaded、device字段
 * @throws {Error} 当服务不可达时抛出异常
 *
 * @example
 * const health = await checkHealth();
 * if (health.model_loaded) { console.log('模型已就绪'); }
 */
async function checkHealth() {
    const response = await fetch(`${API_BASE}/api/health`);
    if (!response.ok) {
        throw new Error('服务不可达');
    }
    return await response.json();
}

/**
 * 将File对象转换为Base64字符串
 *
 * @param {File} file - 用户选择的图片文件对象
 * @returns {Promise<string>} Base64编码的图像字符串（包含data:image前缀）
 * @throws {Error} 当文件读取失败时抛出异常
 *
 * @notes
 *   - 返回的字符串可直接用于img标签src或API请求
 *   - 仅支持图片类型文件
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsDataURL(file);
    });
}

/**
 * 在Canvas上绘制人脸检测框与置信度标注
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D渲染上下文
 * @param {Array<Object>} faces - 人脸信息列表，每项包含bbox([x1,y1,x2,y2])和confidence
 * @param {number} scaleX - X轴缩放比例（原图到Canvas的缩放）
 * @param {number} scaleY - Y轴缩放比例（原图到Canvas的缩放）
 * @returns {void}
 *
 * @notes
 *   - 检测框使用青色(#00f0ff)描边，带发光效果
 *   - 置信度文字显示在检测框左上角，带半透明背景
 *   - 缩放比例用于将模型输出的原图坐标映射到Canvas显示坐标
 */
function drawFaceBoxes(ctx, faces, scaleX, scaleY) {
    faces.forEach((face, index) => {
        const [x1, y1, x2, y2] = face.bbox;
        const sx = x1 * scaleX;
        const sy = y1 * scaleY;
        const sw = (x2 - x1) * scaleX;
        const sh = (y2 - y1) * scaleY;

        // 发光效果
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 10;

        // 检测框
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx, sy, sw, sh);

        // 角标装饰
        const cornerLen = Math.min(15, sw * 0.2, sh * 0.2);
        ctx.lineWidth = 3;
        ctx.beginPath();
        // 左上角
        ctx.moveTo(sx, sy + cornerLen);
        ctx.lineTo(sx, sy);
        ctx.lineTo(sx + cornerLen, sy);
        // 右上角
        ctx.moveTo(sx + sw - cornerLen, sy);
        ctx.lineTo(sx + sw, sy);
        ctx.lineTo(sx + sw, sy + cornerLen);
        // 右下角
        ctx.moveTo(sx + sw, sy + sh - cornerLen);
        ctx.lineTo(sx + sw, sy + sh);
        ctx.lineTo(sx + sw - cornerLen, sy + sh);
        // 左下角
        ctx.moveTo(sx + cornerLen, sy + sh);
        ctx.lineTo(sx, sy + sh);
        ctx.lineTo(sx, sy + sh - cornerLen);
        ctx.stroke();

        // 重置阴影
        ctx.shadowBlur = 0;

        // 置信度标签
        const label = `Face ${index + 1}: ${(face.confidence * 100).toFixed(1)}%`;
        ctx.font = '600 12px "IBM Plex Sans", sans-serif';
        const textMetrics = ctx.measureText(label);
        const textW = textMetrics.width + 12;
        const textH = 20;

        // 标签背景
        ctx.fillStyle = 'rgba(0, 240, 255, 0.85)';
        ctx.fillRect(sx, sy - textH - 2, textW, textH);

        // 标签文字
        ctx.fillStyle = '#060a13';
        ctx.fillText(label, sx + 6, sy - 7);
    });
}

/**
 * 显示Toast通知消息
 *
 * @param {string} message - 通知消息内容
 * @param {'success'|'error'|'warning'|'info'} type - 通知类型，默认'info'
 * @param {number} duration - 显示时长（毫秒），默认3000
 * @returns {void}
 *
 * @notes
 *   - 通知从右侧滑入，自动在指定时长后消失
 *   - 同一时间可显示多条通知，垂直排列
 */
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, duration);
}

/**
 * 更新统计信息显示
 *
 * @param {number} faceCount - 检测到的人脸数量
 * @param {number} inferenceTime - 推理耗时（毫秒）
 * @param {string|null} fps - 帧率显示值，为null时不更新帧率
 * @returns {void}
 *
 * @notes
 *   - 人脸数量变化时会有数字高亮动画效果
 *   - 帧率仅在摄像头模式下更新
 */
function updateStats(faceCount, inferenceTime, fps = null) {
    const countEl = document.getElementById('faceCount');
    const timeEl = document.getElementById('inferenceTime');
    const fpsEl = document.getElementById('fpsValue');

    countEl.textContent = faceCount;
    timeEl.textContent = `${inferenceTime.toFixed(1)} ms`;

    if (fps !== null) {
        fpsEl.textContent = `${fps} FPS`;
    }
}

/** @type {string|null} 上一次渲染的检测结果摘要，用于防闪烁 */
let _lastResultsHash = null;

/**
 * 更新检测结果详情列表

 * @param {Array<Object>} faces - 人脸信息列表
 * @returns {void}
 *
 * @notes
 *   - 每个人脸显示编号、置信度和边界框坐标
 *   - 列表为空时显示"暂无检测结果"占位文字
 *   - 内置防抖机制：仅当数据实际变化时才更新DOM，避免高频重绘导致闪烁
 */
function updateResultsList(faces) {
    const listEl = document.getElementById('resultsList');

    if (!faces || faces.length === 0) {
        const emptyHtml = '<div class="results-empty">暂无检测结果</div>';
        // 仅在内容变化时更新
        if (_lastResultsHash !== '__empty__') {
            listEl.innerHTML = emptyHtml;
            _lastResultsHash = '__empty__';
        }
        return;
    }

    // 生成当前数据的轻量哈希（人脸数 + 各置信度取整），避免不必要的DOM重建
    const hash = faces.length + '|' + faces.map(f => Math.round(f.confidence * 100)).join(',');

    if (hash === _lastResultsHash) {
        return; // 数据未变，跳过渲染
    }
    _lastResultsHash = hash;

    listEl.innerHTML = faces.map((face, i) => `
        <div class="result-item">
            <span class="face-id">FACE-${String(i + 1).padStart(2, '0')}</span>
            <span class="face-conf">${(face.confidence * 100).toFixed(1)}%</span>
            <span class="face-bbox">[${face.bbox.map(v => Math.round(v)).join(', ')}]</span>
        </div>
    `).join('');
}


// ============================================================
// WebSocket 连接管理模块（摄像头实时检测专用）
// ============================================================

/**
 * WebSocket检测连接管理器（请求-应答配对模式）
 *
 * 封装WebSocket连接的完整生命周期，核心特点是 sendFrame() 返回 Promise，
 * 每次发送帧后会 await 等待对应的结果返回，保持发送-接收的严格顺序。
 * 这确保检测结果与发送的帧一一对应，不会出现乱序或闪烁。
 *
 * @namespace WSDetectClient
 *
 * @example
 * // 开启摄像头时连接
 * await WSDetectClient.connect();
 *
 * // 发送帧并等待结果（请求-应答配对）
 * const result = await WSDetectClient.sendFrame(blob);
 * console.log(result.count); // 人脸数量
 *
 * // 更新检测参数
 * WSDetectClient.updateConfig(0.6, 0.5);
 *
 * // 关闭摄像头时断开
 * WSDetectClient.disconnect();
 */
const WSDetectClient = {
    /** @type {WebSocket|null} WebSocket连接实例 */
    _ws: null,
    /** @type {string} WebSocket服务端地址 */
    _url: '',
    /** @type {boolean} 是否已连接 */
    connected: false,
    /** @type {Function|null} 错误回调函数（用于连接级错误） */
    _onError: null,
    /** @type {Array<{resolve: Function, reject: Function}>} 待处理的请求队列 */
    _pending: [],
    /** @type {number} 自动重连最大次数 */
    _maxRetries: 3,
    /** @type {number} 当前重连计数 */
    _retryCount: 0,
    /** @type {number} 重连间隔基数（毫秒），指数退避 */
    _retryBaseDelay: 1000,

    /**
     * 建立WebSocket连接
     *
     * 创建到后端 /ws/detect 端点的持久连接，
     * 连接成功后标记为可用状态。
     *
     * @param {Object} [options] - 连接选项
     * @param {Function} [options.onError] - 发生连接级错误时的回调
     * @param {string} [options.url] - 自定义WebSocket地址
     * @returns {Promise<void>}
     * @throws {Error} 当连接失败且重试耗尽时抛出异常
     *
     * @notes
     *   - 自动根据当前页面协议选择 ws:// 或 wss://
     *   - 已有活跃连接时会先断开旧连接
     *   - 支持指数退避自动重连（最多3次）
     *   - 清空待处理队列，避免残留的过期 Promise
     */
    async connect(options = {}) {
        this._onError = options.onError || null;
        this._pending = [];  // 清空残留队列

        if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
            this.disconnect();
        }

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        this._url = options.url || `${protocol}//${location.host}/ws/detect`;

        return new Promise((resolve, reject) => {
            try {
                this._ws = new WebSocket(this._url);
            } catch (err) {
                reject(new Error(`WebSocket创建失败: ${err.message}`));
                return;
            }

            this._ws.binaryType = 'arraybuffer';

            this._ws.onopen = () => {
                console.log('[WS] 连接已建立:', this._url);
                this.connected = true;
                this._retryCount = 0;
                resolve();
            };

            /**
             * 处理服务端消息，实现请求-应答配对
             *
             * 收到检测结果时，从_pending队列中取出最早的一个 Promise 并 resolve，
             * 确保每个 sendFrame() 调用都能拿到对应的、正确顺序的结果。
             */
            this._ws.onmessage = (event) => {
                if (typeof event.data !== 'string') return;

                try {
                    const msg = JSON.parse(event.data);

                    // 配置确认消息：不消耗 pending 队列
                    if (msg.type === 'config_ack') {
                        console.log('[WS] 配置已更新');
                        return;
                    }

                    // 错误消息：reject 最旧的 pending 请求
                    if (msg.type === 'error') {
                        console.warn('[WS] 服务端错误:', msg.detail);
                        const pending = this._pending.shift();
                        if (pending) {
                            pending.reject(new Error(msg.detail));
                        } else if (this._onError) {
                            this._onError(msg.detail);
                        }
                        return;
                    }

                    // 正常检测结果：resolve 最旧的 pending 请求
                    const pending = this._pending.shift();
                    if (pending) {
                        pending.resolve(msg);
                    }
                } catch (parseErr) {
                    console.warn('[WS] 消息解析失败:', parseErr);
                    // 解析失败也释放一个 pending，避免死等
                    const pending = this._pending.shift();
                    if (pending) {
                        pending.reject(parseErr);
                    }
                }
            };

            this._ws.onerror = () => {
                // onclose 会紧随其后触发
            };

            this._ws.onclose = (event) => {
                this.connected = false;
                console.log(`[WS] 连接已关闭, code=${event.code}`);

                // reject 所有 pending 中的等待者
                while (this._pending.length > 0) {
                    const p = this._pending.shift();
                    p.reject(new Error('WebSocket连接已断开'));
                }

                // 自动重连
                if (event.code !== 1000 && this._retryCount < this._maxRetries) {
                    this._retryCount++;
                    const delay = this._retryBaseDelay * Math.pow(2, this._retryCount - 1);
                    console.log(`[WS] ${delay}ms 后第 ${this._retryCount} 次重连...`);
                    setTimeout(() => this.connect(options), delay);
                } else if (this._retryCount >= this._maxRetries && this._onError) {
                    this._onError(`WebSocket连接失败，已重试${this._maxRetries}次`);
                }
            };
        });
    },

    /**
     * 发送二进制图像帧并等待检测结果（请求-应答配对）
     *
     * 将Blob数据通过WebSocket发送后返回一个Promise，
     * Promise 在收到对应的检测结果时 resolve。
     * 调用方通过 await 保持发送-接收的严格顺序。
     *
     * @param {Blob|ArrayBuffer} frameData - 图像帧二进制数据（JPEG Blob）
     * @returns {Promise<Object>} 检测结果对象，包含 faces/count/inference_time 等
     * @throws {Error} 连接未就绪或服务端返回错误时抛出异常
     *
     * @notes
     *   - 必须在 connected=true 时调用
     *   - 内部维护 FIFO 队列保证请求-响应严格配对
     *   - 多个并发调用会按发送顺序依次返回结果
     *   - 连接断开时会 reject 所有等待中的 Promise
     */
    sendFrame(frameData) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this._ws || this._ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket未连接'));
                return;
            }

            // 将 Promise 的 resolve/reject 加入待处理队列
            this._pending.push({ resolve, reject });

            try {
                this._ws.send(frameData);
            } catch (err) {
                // 发送失败，立即移除并 reject
                this._pending.pop();
                reject(err);
            }
        });
    },

    /**
     * 动态更新检测参数（无需断开重连）
     *
     * 通过发送配置文本消息实时调整置信度和IoU阈值，
     * 服务端收到后对后续帧生效。此方法为 fire-and-forget 模式。
     *
     * @param {number} confThreshold - 置信度阈值，范围0.1-0.9
     * @param {number} iouThreshold - NMS IoU阈值，范围0.1-0.9
     * @returns {boolean} 发送成功返回true
     */
    updateConfig(confThreshold, iouThreshold) {
        if (!this.connected || !this._ws || this._ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            this._ws.send(JSON.stringify({
                type: 'config',
                conf_threshold: confThreshold,
                iou_threshold: iouThreshold
            }));
            return true;
        } catch (err) {
            console.warn('[WS] 配置发送失败:', err.message);
            return false;
        }
    },

    /**
     * 断开WebSocket连接并清理资源
     *
     * @returns {void}
     */
    disconnect() {
        this._retryCount = this._maxRetries;  // 阻止自动重连

        // reject 所有 pending
        while (this._pending.length > 0) {
            const p = this._pending.shift();
            p.reject(new Error('连接已主动断开'));
        }

        if (this._ws) {
            try {
                this._ws.close(1000, '客户端主动断开');
            } catch (e) { /* ignore */ }
            this._ws = null;
        }
        this.connected = false;
        this._onError = null;
        console.log('[WS] 连接已释放');
    }
};
