/**
 * 摄像头实时检测模块
 *
 * 负责摄像头调用、视频流逐帧推理、实时绘制检测结果、
 * 帧率统计等摄像头检测相关业务逻辑。
 */

/**
 * 摄像头检测器对象
 *
 * 封装摄像头实时检测的全部状态与方法，包括摄像头开关、
 * 帧流推理、Canvas叠加绘制、帧率计算等功能。
 *
 * @namespace CameraDetector
 */
const CameraDetector = {
    /** @type {MediaStream|null} 摄像头媒体流 */
    stream: null,
    /** @type {HTMLVideoElement} 视频播放元素 */
    video: null,
    /** @type {HTMLCanvasElement} 检测结果叠加画布 */
    canvas: null,
    /** @type {CanvasRenderingContext2D} 叠加画布渲染上下文 */
    ctx: null,
    /** @type {boolean} 摄像头是否开启 */
    isRunning: false,
    /** @type {boolean} 检测是否暂停 */
    isPaused: false,
    /** @type {number|null} requestAnimationFrame ID */
    animFrameId: null,
    /** @type {number} 上一帧时间戳（用于帧率计算） */
    lastFrameTime: 0,
    /** @type {number} 帧率计算帧计数 */
    frameCount: 0,
    /** @type {number} 当前FPS值 */
    currentFps: 0,
    /** @type {number} 帧率统计间隔起始时间 */
    fpsIntervalStart: 0,
    /** @type {number} 帧率统计间隔（毫秒） */
    fpsInterval: 1000,
    /** @type {boolean} 是否正在发送检测请求 */
    isDetecting: false,
    /** @type {number} 检测帧间隔控制（毫秒） */
    detectInterval: 80,
    /** @type {number} 上次检测时间戳 */
    lastDetectTime: 0,
    /** @type {ResizeObserver|null} 容器尺寸变化监听器 */
    _resizeObserver: null,

    /**
     * 初始化摄像头检测模块
     *
     * 获取DOM元素引用，绑定按钮事件监听器，初始化Canvas尺寸。
     *
     * @returns {void}
     *
     * @notes
     *   - 必须在DOM加载完成后调用
     *   - 按钮事件包括开启/关闭摄像头、暂停检测
     *   - 初始化时同步叠加Canvas的绘图缓冲区尺寸与容器一致
     */
    init() {
        this.video = document.getElementById('cameraVideo');
        this.canvas = document.getElementById('cameraCanvas');
        this.ctx = this.canvas.getContext('2d');

        // 监听容器尺寸变化，同步更新Canvas缓冲区尺寸（避免拉伸模糊）
        const container = document.getElementById('canvasContainer');
        this._resizeObserver = new ResizeObserver(() => {
            if (container.clientWidth > 0 && container.clientHeight > 0) {
                this.canvas.width = container.clientWidth;
                this.canvas.height = container.clientHeight;
            }
        });
        this._resizeObserver.observe(container);

        document.getElementById('btnStartCamera').addEventListener('click', () => this.start());
        document.getElementById('btnStopCamera').addEventListener('click', () => this.stop());
        document.getElementById('btnPauseDetect').addEventListener('click', () => this.togglePause());
    },

    /**
     * 开启摄像头并启动实时检测
     *
     * 请求浏览器摄像头权限，获取视频流后启动逐帧检测循环。
     *
     * @returns {Promise<void>}
     * @throws 当摄像头权限被拒绝或设备不可用时通过Toast提示用户
     *
     * @notes
     *   - 优先使用后置摄像头（移动端），桌面端默认前置
     *   - 视频画面水平镜像显示
     *   - 检测帧率受detectInterval参数控制
     */
    async start() {
        if (this.isRunning) return;

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                }
            });

            this.video.srcObject = this.stream;
            await this.video.play();

            this.isRunning = true;
            this.isPaused = false;
            this.lastFrameTime = 0;
            this.frameCount = 0;
            this.fpsIntervalStart = performance.now();
            this._hasShownError = false;

            // 同步Canvas缓冲区尺寸与容器一致
            const container = document.getElementById('canvasContainer');
            this.canvas.width = container.clientWidth;
            this.canvas.height = container.clientHeight;

            // 更新UI状态
            this.video.classList.remove('hidden');
            this.canvas.classList.remove('hidden');
            document.getElementById('emptyState').classList.add('hidden');
            document.getElementById('scanLine').classList.remove('hidden');
            document.getElementById('btnStartCamera').disabled = true;
            document.getElementById('btnStopCamera').disabled = false;
            document.getElementById('btnPauseDetect').disabled = false;

            showToast('摄像头已开启', 'success');

            // 启动检测循环
            this.detectLoop();
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                showToast('摄像头权限被拒绝，请在浏览器设置中允许', 'error');
            } else if (error.name === 'NotFoundError') {
                showToast('未检测到摄像头设备', 'error');
            } else {
                showToast(`摄像头启动失败：${error.message}`, 'error');
            }
        }
    },

    /**
     * 关闭摄像头并停止检测
     *
     * 停止视频流、取消动画帧、清空画布、重置UI状态。
     *
     * @returns {void}
     *
     * @notes
     *   - 会释放摄像头设备，其他应用可重新访问
     *   - 重置FPS显示为"--"
     */
    stop() {
        if (!this.isRunning) return;

        // 停止视频流
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        // 取消动画帧
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }

        // 清空画布
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // 重置状态
        this.isRunning = false;
        this.isPaused = false;
        this.isDetecting = false;
        this._hasShownError = false;

        // 更新UI
        this.video.classList.add('hidden');
        this.canvas.classList.add('hidden');
        document.getElementById('scanLine').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('btnStartCamera').disabled = false;
        document.getElementById('btnStopCamera').disabled = true;
        document.getElementById('btnPauseDetect').disabled = true;
        document.getElementById('fpsValue').textContent = '-- FPS';

        showToast('摄像头已关闭', 'info');
    },

    /**
     * 切换检测暂停/恢复状态
     *
     * @returns {void}
     *
     * @notes
     *   - 暂停时视频画面保持显示，但不发送检测请求
     *   - 按钮文字随状态切换变化
     */
    togglePause() {
        if (!this.isRunning) return;

        this.isPaused = !this.isPaused;
        const btn = document.getElementById('btnPauseDetect');

        if (this.isPaused) {
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                恢复检测`;
            showToast('检测已暂停', 'warning');
        } else {
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
                暂停检测`;
            showToast('检测已恢复', 'info');
        }
    },

    /**
     * 实时检测主循环
     *
     * 通过requestAnimationFrame驱动，逐帧捕获视频画面并发送检测请求。
     *
     * @returns {void}
     *
     * @notes
     *   - 检测频率受detectInterval控制，避免过度请求
     *   - 帧率统计每秒更新一次
     *   - 暂停状态下仅更新画面不发送请求
     */
    detectLoop() {
        if (!this.isRunning) return;

        this.animFrameId = requestAnimationFrame(() => this.detectLoop());

        // 帧率统计
        this.frameCount++;
        const now = performance.now();
        if (now - this.fpsIntervalStart >= this.fpsInterval) {
            this.currentFps = Math.round(
                (this.frameCount * 1000) / (now - this.fpsIntervalStart)
            );
            this.frameCount = 0;
            this.fpsIntervalStart = now;
        }

        // 检测控制
        if (this.isPaused || this.isDetecting) return;
        if (now - this.lastDetectTime < this.detectInterval) return;

        this.lastDetectTime = now;
        this.detectFrame();
    },

    /**
     * 捕获当前视频帧并发送检测请求
     *
     * 将视频帧绘制到临时Canvas转为Base64，发送至后端推理，
     * 接收结果后在叠加Canvas上绘制检测框。
     *
     * 坐标映射说明：
     *   - 视频通过 CSS scaleX(-1) 镜像显示（用户看到的是镜像画面）
     *   - 但 drawImage() 捕获的是未镜像的原始像素数据
     *   - 后端基于原始像素检测，返回原始坐标系中的bbox
     *   - 绘制时需将 x 坐标镜像翻转：mirrorX = displayW - (x * scaleX)
     *
     * @returns {Promise<void>}
     *
     * @notes
     *   - 使用临时Canvas进行帧捕获，避免影响显示Canvas
     *   - 检测失败时静默处理，不中断检测循环
     */
    async detectFrame() {
        if (!this.video.videoWidth || !this.video.videoHeight) return;

        this.isDetecting = true;

        try {
            // 捕获视频帧到临时Canvas（捕获的是原始像素，非CSS变换后的）
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.video.videoWidth;
            tempCanvas.height = this.video.videoHeight;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(this.video, 0, 0);

            // 转Base64
            const base64 = tempCanvas.toDataURL('image/jpeg', 0.8);

            // 获取参数
            const conf = parseFloat(document.getElementById('confSlider').value);
            const iou = parseFloat(document.getElementById('iouSlider').value);

            // 发送检测请求
            const result = await detectRequest('/api/detect/frame', base64, conf, iou);

            // 调试日志：确认后端是否返回了检测结果
            console.log('[Camera] 检测结果:', result.count, '张人脸', result.faces?.length > 0 ? result.faces : '无');

            // === 计算视频在容器中的实际显示尺寸和偏移 ===
            const container = document.getElementById('canvasContainer');
            const containerW = container.clientWidth;
            const containerH = container.clientHeight;
            const videoAspect = this.video.videoWidth / this.video.videoHeight;
            const containerAspect = containerW / containerH;

            let displayW, displayH, offsetX, offsetY;
            if (videoAspect > containerAspect) {
                // 视频更宽：以容器宽度为准，高度留白
                displayW = containerW;
                displayH = containerW / videoAspect;
                offsetX = 0;
                offsetY = (containerH - displayH) / 2;
            } else {
                // 视频更高：以容器高度为准，宽度留白
                displayH = containerH;
                displayW = containerH * videoAspect;
                offsetX = (containerW - displayW) / 2;
                offsetY = 0;
            }

            // 缩放比例：原图坐标 → 显示坐标
            const scaleX = displayW / this.video.videoWidth;
            const scaleY = displayH / this.video.videoHeight;

            // === 设置叠加Canvas尺寸并清空 ===
            // 注意：直接用CSS的100%尺寸，JS不再重复设置width/height属性
            // 避免每帧重置画布导致的闪烁和上下文状态丢失
            this.ctx.clearRect(0, 0, containerW, containerH);

            // === 绘制检测结果 ===
            if (result.faces && result.faces.length > 0) {
                result.faces.forEach((face, index) => {
                    const [x1, y1, x2, y2] = face.bbox;

                    // 原图坐标 → 显示坐标（缩放）
                    let sx = x1 * scaleX;
                    let sy = y1 * scaleY;
                    let sw = (x2 - x1) * scaleX;
                    let sh = (y2 - y1) * scaleY;

                    // 关键修复：X轴镜像翻转
                    // 视频CSS做了scaleX(-1)，所以检测框x也要翻转才能对齐
                    sx = offsetX + displayW - (sx + sw);
                    // sy 不变，Y轴无镜像

                    // 绘制单个检测框（直接使用计算后的屏幕坐标，无需canvas transform）
                    this._drawSingleBox(sx, sy, sw, sh, face.confidence, index);
                });
            }

            // 更新统计
            updateStats(result.count, result.inference_time, this.currentFps);
            updateResultsList(result.faces);
        } catch (error) {
            // 首次错误弹窗提示，后续静默避免频繁打扰
            if (!this._hasShownError) {
                this._hasShownError = true;
                showToast(`检测异常: ${error.message}`, 'error', 5000);
                // 5秒后重置标记，允许再次提示（应对服务重启等场景）
                setTimeout(() => { this._hasShownError = false; }, 5000);
            }
            console.warn('帧检测失败:', error.message);
        } finally {
            this.isDetecting = false;
        }
    },

    /**
     * 在叠加Canvas上绘制单个人脸检测框（摄像头模式专用）
     *
     * 直接使用已转换好的屏幕坐标绘制，不依赖Canvas transform，
     * 避免复杂变换矩阵带来的坐标偏移问题。
     *
     * @param {number} x - 检测框左上角X坐标（已做镜像+缩放+偏移）
     * @param {number} y - 检测框左上角Y坐标（已做缩放+偏移）
     * @param {number} w - 检测框宽度
     * @param {number} h - 检测框高度
     * @param {number} confidence - 置信度 (0-1)
     * @param {number} index - 人脸序号
     * @returns {void}
     */
    _drawSingleBox(x, y, w, h, confidence, index) {
        const ctx = this.ctx;

        // 发光效果
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 10;

        // 检测框边框
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // 角标装饰
        const cornerLen = Math.min(15, w * 0.2, h * 0.2);
        ctx.lineWidth = 3;
        ctx.beginPath();
        // 左上角
        ctx.moveTo(x, y + cornerLen);
        ctx.lineTo(x, y);
        ctx.lineTo(x + cornerLen, y);
        // 右上角
        ctx.moveTo(x + w - cornerLen, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + cornerLen);
        // 右下角
        ctx.moveTo(x + w, y + h - cornerLen);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x + w - cornerLen, y + h);
        // 左下角
        ctx.moveTo(x + cornerLen, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x, y + h - cornerLen);
        ctx.stroke();

        // 重置阴影
        ctx.shadowBlur = 0;

        // 置信度标签
        const label = `Face ${index + 1}: ${(confidence * 100).toFixed(1)}%`;
        ctx.font = '600 12px "IBM Plex Sans", sans-serif';
        const textMetrics = ctx.measureText(label);
        const textW = textMetrics.width + 12;
        const textH = 20;

        // 标签背景
        ctx.fillStyle = 'rgba(0, 240, 255, 0.85)';
        ctx.fillRect(x, y - textH - 2, textW, textH);

        // 标签文字
        ctx.fillStyle = '#060a13';
        ctx.fillText(label, x + 6, y - 7);
    },

    /**
     * 重置摄像头检测状态
     *
     * 关闭摄像头、清空画布、重置所有状态。
     *
     * @returns {void}
     */
    reset() {
        this.stop();
    }
};
