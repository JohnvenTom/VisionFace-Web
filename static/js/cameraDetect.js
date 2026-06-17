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
    /** @type {HTMLSelectElement} 摄像头设备选择下拉框 */
    selectEl: null,
    /** @type {Array<MediaDeviceInfo>} 已枚举的视频输入设备列表 */
    devices: [],
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
    detectInterval: 50,
    /** @type {number} 上次检测时间戳 */
    lastDetectTime: 0,
    /** @type {ResizeObserver|null} 容器尺寸变化监听器 */
    _resizeObserver: null,
    /** @type {HTMLCanvasElement|null} 复用的临时截图Canvas（避免每帧新建） */
    _tempCanvas: null,
    /** @type {CanvasRenderingContext2D|null} 临时截图Canvas的2D上下文 */
    _tempCtx: null,
    /** @type {Object|null} 缓存的容器显示尺寸计算结果（resize时失效） */
    _displayCache: null,
    /** @type {HTMLElement|null} 缓存的容器DOM引用 */
    _containerEl: null,

    /**
     * 初始化摄像头检测模块
     *
     * 获取DOM元素引用，绑定按钮事件监听器，初始化Canvas尺寸，
     * 枚举可用摄像头设备并填充选择下拉框。
     *
     * @returns {void}
     *
     * @notes
     *   - 必须在DOM加载完成后调用
     *   - 按钮事件包括开启/关闭摄像头、暂停检测
     *   - 初始化时同步叠加Canvas的绘图缓冲区尺寸与容器一致
     *   - 自动枚举摄像头设备，支持USB热插拔自动刷新列表
     */
    init() {
        this.video = document.getElementById('cameraVideo');
        this.canvas = document.getElementById('cameraCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.selectEl = document.getElementById('cameraDeviceSelect');

        // Watch container size changes, re-sync canvas overlay to video position
        const container = document.getElementById('canvasContainer');
        this._resizeObserver = new ResizeObserver(() => {
            if (container.clientWidth > 0 && container.clientHeight > 0) {
                this._syncOverlayToVideo();
            }
        });
        this._resizeObserver.observe(container);

        document.getElementById('btnStartCamera').addEventListener('click', () => this.start());
        document.getElementById('btnStopCamera').addEventListener('click', () => this.stop());
        document.getElementById('btnPauseDetect').addEventListener('click', () => this.togglePause());

        // 检测参数滑块变化时，通过WebSocket动态推送新阈值（替代每帧读取）
        const confSlider = document.getElementById('confSlider');
        const iouSlider = document.getElementById('iouSlider');
        confSlider.addEventListener('input', () => {
            if (this.isRunning && WSDetectClient.connected) {
                WSDetectClient.updateConfig(
                    parseFloat(confSlider.value),
                    parseFloat(iouSlider.value)
                );
            }
        });
        iouSlider.addEventListener('input', () => {
            if (this.isRunning && WSDetectClient.connected) {
                WSDetectClient.updateConfig(
                    parseFloat(confSlider.value),
                    parseFloat(iouSlider.value)
                );
            }
        });

        // 摄像头设备切换时提示用户重新开启
        this.selectEl.addEventListener('change', () => {
            if (this.isRunning) {
                showToast('请先关闭当前摄像头再切换设备', 'warning');
                // 回滚到当前使用的设备
                this._restoreSelectToActive();
            }
        });

        // 监听设备插拔变化（USB摄像头热插拔）
        navigator.mediaDevices.addEventListener('devicechange', () => {
            console.log('[Camera] 设备列表变化，重新枚举');
            this.enumerateDevices();
        });

        // 初始枚举设备（需要先获取权限才能看到设备标签）
        this.enumerateDevices();
    },

    /**
     * 枚举系统可用的视频输入设备并更新下拉框
     *
     * 调用 enumerateDevices API 获取所有 videoinput 设备，
     * 填充到选择下拉框中。首次调用时需先请求临时权限以获取设备标签。
     *
     * @returns {Promise<void>}
     *
     * @notes
     *   - 首次枚举会临时请求摄像头权限以获取完整设备信息
     *   - 设备按 label 排序显示，无标签的设备显示为"默认摄像头"
     *   - 无可用设备时下拉框禁用并提示
     */
    async enumerateDevices() {
        try {
            // 首次调用需要先获取权限才能读取 device.label
            if (!this._hasPermission) {
                try {
                    const tempStream = await navigator.mediaDevices.getUserMedia({
                        video: true, audio: false
                    });
                    // 立即释放临时流，仅用于获取权限
                    tempStream.getTracks().forEach(t => t.stop());
                    this._hasPermission = true;
                } catch (permErr) {
                    // 权限被拒绝，仍尝试枚举（可能已有其他页面授权过）
                    console.warn('[Camera] 临时权限请求失败:', permErr.name);
                }
            }

            // 记录当前用户选中的 deviceId，用于枚举完成后恢复选中状态
            const previousSelectedId = this.selectEl.value;

            const allDevices = await navigator.mediaDevices.enumerateDevices();
            this.devices = allDevices.filter(d => d.kind === 'videoinput');

            // 更新下拉框选项
            this.selectEl.innerHTML = '';

            if (this.devices.length === 0) {
                this.selectEl.innerHTML =
                    '<option value="">未检测到摄像头</option>';
                this.selectEl.disabled = true;
                return;
            }

            this.selectEl.disabled = false;

            // 按 label 排序：有名称的在前，无名称的在后
            const sorted = [...this.devices].sort((a, b) => {
                const la = a.label || '';
                const lb = b.label || '';
                if (!la && !lb) return 0;
                if (!la) return 1;
                if (!lb) return -1;
                return la.localeCompare(lb);
            });

            sorted.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                // 显示友好名称：优先使用label，无label则用默认名
                option.textContent = device.label ||
                    `摄像头 ${index + 1}`;
                this.selectEl.appendChild(option);
            });

            // 恢复用户之前的选中项（如果该设备仍存在于列表中）
            if (previousSelectedId) {
                const exists = [...this.selectEl.options].some(
                    opt => opt.value === previousSelectedId
                );
                if (exists) {
                    this.selectEl.value = previousSelectedId;
                }
            }

            console.log(`[Camera] 已枚举 ${this.devices.length} 个摄像头设备`);
        } catch (error) {
            console.error('[Camera] 设备枚举失败:', error);
            this.selectEl.innerHTML =
                '<option value="">设备枚举失败</option>';
            this.selectEl.disabled = true;
        }
    },

    /**
     * 将下拉框选中项恢复到当前正在使用的设备
     *
     * 当用户在运行中切换设备时回滚选择，防止状态不一致。
     *
     * @returns {void}
     */
    _restoreSelectToActive() {
        if (!this.stream) return;
        const activeTrack = this.stream.getVideoTracks()[0];
        if (activeTrack) {
            this.selectEl.value = activeTrack.getSettings().deviceId || '';
        }
    },

    /**
     * 开启摄像头并启动实时检测
     *
     * 使用用户选择的摄像头设备请求视频流，
     * 建立WebSocket持久连接后启动逐帧检测循环。
     *
     * @returns {Promise<void>}
     * @throws 当摄像头权限被拒绝或设备不可用时通过Toast提示用户
     *
     * @notes
     *   - 优先使用下拉框选择的指定设备（deviceId）
     *   - 未选择或deviceId无效时回退到默认前置摄像头
     *   - 视频画面水平镜像显示
     *   - 检测帧率受detectInterval参数控制
     *   - 通过WebSocket二进制帧传输替代HTTP轮询，大幅降低延迟和带宽开销
     */
    async start() {
        if (this.isRunning) return;

        // 构建视频约束：优先使用选定设备
        const selectedDeviceId = this.selectEl.value;
        const videoConstraints = {
            width: { ideal: 640 },
            height: { ideal: 480 }
        };

        // 如果用户选择了具体设备，使用 deviceId 约束
        if (selectedDeviceId) {
            videoConstraints.deviceId = { exact: selectedDeviceId };
        } else {
            // 回退：默认使用前置摄像头
            videoConstraints.facingMode = 'user';
        }

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: videoConstraints,
                audio: false
            });

            this.video.srcObject = this.stream;
            await this.video.play();

            // 建立WebSocket持久连接（替代HTTP轮询）
            await WSDetectClient.connect({
                onError: (errMsg) => {
                    if (!this._hasShownError) {
                        this._hasShownError = true;
                        showToast(`检测异常: ${errMsg}`, 'error', 5000);
                        setTimeout(() => { this._hasShownError = false; }, 5000);
                    }
                }
            });

            // 发送初始配置（置信度 + IoU阈值）
            const conf = parseFloat(document.getElementById('confSlider').value);
            const iou = parseFloat(document.getElementById('iouSlider').value);
            WSDetectClient.updateConfig(conf, iou);

            this.isRunning = true;
            this._postStartInit();
            showToast('摄像头已开启', 'success');
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                showToast('摄像头权限被拒绝，请在浏览器设置中允许', 'error');
            } else if (error.name === 'NotFoundError') {
                showToast('未检测到所选摄像头设备，请检查连接', 'error');
            } else if (error.name === 'OverconstrainedError') {
                showToast('所选摄像头不支持请求的分辨率，将尝试默认设置', 'warning');
                try {
                    this.stream = await navigator.mediaDevices.getUserMedia({
                        video: { width: { ideal: 640 }, height: { ideal: 480 } },
                        audio: false
                    });
                    this.video.srcObject = this.stream;
                    await this.video.play();

                    await WSDetectClient.connect({
                        onError: (errMsg) => {
                            if (!this._hasShownError) {
                                this._hasShownError = true;
                                showToast(`检测异常: ${errMsg}`, 'error', 5000);
                                setTimeout(() => { this._hasShownError = false; }, 5000);
                            }
                        }
                    });
                    const conf = parseFloat(document.getElementById('confSlider').value);
                    const iou = parseFloat(document.getElementById('iouSlider').value);
                    WSDetectClient.updateConfig(conf, iou);

                    this.isRunning = true;
                    this._postStartInit();
                    return;
                } catch (retryErr) {
                    showToast(`摄像头启动失败：${retryErr.message}`, 'error');
                }
            } else {
                showToast(`摄像头启动失败：${error.message}`, 'error');
            }
        }
    },

    /**
     * 开启后的通用初始化逻辑（避免start()中重复代码）
     *
     * @returns {void}
     */
    _postStartInit() {
        this.isPaused = false;
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.fpsIntervalStart = performance.now();
        this._hasShownError = false;

        // Cache container DOM reference
        this._containerEl = document.getElementById('canvasContainer');

        // Create reusable temp canvas for screenshot capture
        this._tempCanvas = document.createElement('canvas');
        this._tempCtx = this._tempCanvas.getContext('2d');

        // Sync canvas overlay to exactly match video's rendered position & size
        this._syncOverlayToVideo();

        // Update UI state
        this.video.classList.remove('hidden');
        this.canvas.classList.remove('hidden');
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('scanLine').classList.remove('hidden');
        document.getElementById('btnStartCamera').disabled = true;
        document.getElementById('btnStopCamera').disabled = false;
        document.getElementById('btnPauseDetect').disabled = false;

        // Lock select dropdown while running
        this.selectEl.disabled = true;

        this.detectLoop();
    },

    /**
     * 关闭摄像头并停止检测
     *
     * 停止视频流、断开WebSocket连接、取消动画帧、清空画布、重置UI状态，
     * 重新枚举可用摄像头设备（支持USB热插拔）。
     *
     * @returns {void}
     *
     * @notes
     *   - 会释放摄像头设备，其他应用可重新访问
     *   - 断开WebSocket持久连接释放服务端资源
     *   - 重置FPS显示为"--"
     *   - 停止后自动刷新设备列表
     */
    stop() {
        if (!this.isRunning) return;

        // 断开WebSocket连接
        WSDetectClient.disconnect();

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

        // 解锁下拉框并重新枚举设备（支持热插拔）
        this.selectEl.disabled = false;
        this.enumerateDevices();

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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Play`;
            showToast('Detection paused', 'warning');
        } else {
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
                Pause`;
            showToast('Detection resumed', 'info');
        }
    },

    /**
     * 实时检测主循环
     *
     * 通过requestAnimationFrame驱动，逐帧捕获视频画面并发送检测请求。
     * 使用请求-应答配对模式：发送一帧后等待结果返回再发送下一帧，
     * 确保检测结果与视频帧严格一一对应。
     *
     * @returns {void}
     *
     * @notes
     *   - 检测频率受detectInterval控制，避免过度请求
     *   - 帧率统计每秒更新一次
     *   - 暂停状态下仅更新画面不发送请求
     *   - isDetecting 标志防止前一帧未完成时重复发送（串行化）
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

        // 检测控制：暂停或上一帧未完成时跳过
        if (this.isPaused || this.isDetecting) return;
        if (now - this.lastDetectTime < this.detectInterval) return;

        this.lastDetectTime = now;
        this.isDetecting = true;
        this.detectFrame().finally(() => { this.isDetecting = false; });
    },

    /**
     * Sync canvas overlay position & dimensions to exactly match the video element's rendered area
     *
     * Uses getBoundingClientRect() to measure where the browser actually renders the video
     * within its container (accounting for object-fit: contain, borders, padding, etc.).
     * Then positions the overlay canvas directly on top of the video with identical pixel dimensions.
     *
     * This eliminates all offset/scale calculation mismatches between CSS layout and JS math.
     *
     * @returns {void}
     */
    _syncOverlayToVideo() {
        if (!this.video || !this.canvas || !this._containerEl) return;

        const containerRect = this._containerEl.getBoundingClientRect();
        const videoRect = this.video.getBoundingClientRect();

        // Video position relative to container
        const left = videoRect.left - containerRect.left;
        const top = videoRect.top - containerRect.top;
        const width = videoRect.width;
        const height = videoRect.height;

        // Position canvas exactly over the video element
        this.canvas.style.position = 'absolute';
        this.canvas.style.left = `${left}px`;
        this.canvas.style.top = `${top}px`;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.canvas.style.inset = 'auto'; // Override CSS inset:0

        // Set canvas buffer to match rendered pixels (1:1 with display)
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Scale for HiDPI

        // Cache scale factors for coordinate conversion (video intrinsic → display)
        const vw = this.video.videoWidth || 640;
        const vh = this.video.videoHeight || 480;

        this._displayCache = {
            displayW: width,
            displayH: height,
            scaleX: width / vw,
            scaleY: height / vh
        };
    },

    /**
     * 捕获当前视频帧并通过WebSocket发送，等待检测结果后绘制
     *
     * 使用复用的临时Canvas截图 → JPEG编码为Blob → WebSocket发送 →
     * await等待对应结果 → 内联绘制检测框。全程请求-应答配对，
     * 保证帧与检测结果一一对应。
     *
     * 性能优化：
     *   - 复用 _tempCanvas/_tempCtx（避免每帧 createElement+getContext）
     *   - 缓存显示尺寸计算（避免每帧查询DOM和重复浮点运算）
     *   - JPEG质量0.7（编码更快、体积更小）
     *
     * @returns {Promise<void>}
     */
    async detectFrame() {
        if (!this.video.videoWidth || !this.video.videoHeight) return;

        try {
            // === 1. Reuse temp canvas for screenshot capture ===
            const tc = this._tempCanvas;
            tc.width = this.video.videoWidth;
            tc.height = this.video.videoHeight;
            this._tempCtx.drawImage(this.video, 0, 0);

            // === 2. JPEG encode (quality 0.7: speed priority) ===
            const blob = await new Promise((resolve) => {
                tc.toBlob(resolve, 'image/jpeg', 0.7);
            });
            if (!blob) return;

            // === 3. Send via WebSocket and await corresponding result ===
            const result = await WSDetectClient.sendFrame(blob);

            // === 4. Refresh display cache if stale (syncs overlay to video) ===
            if (!this._displayCache) {
                this._syncOverlayToVideo();
            }
            const dc = this._displayCache;

            // === 5. Clear overlay and draw detection results ===
            this.ctx.clearRect(0, 0, dc.displayW, dc.displayH);

            if (result.faces && result.faces.length > 0) {
                for (let i = 0; i < result.faces.length; i++) {
                    const face = result.faces[i];
                    const [x1, y1, x2, y2] = face.bbox;

                    let sx = x1 * dc.scaleX;
                    let sy = y1 * dc.scaleY;
                    let sw = (x2 - x1) * dc.scaleX;
                    let sh = (y2 - y1) * dc.scaleY;

                    // X-axis mirror flip (video CSS has scaleX(-1))
                    sx = dc.displayW - (sx + sw);

                    this._drawSingleBox(sx, sy, sw, sh, face.confidence, i);
                }
            }

            // Update statistics
            updateStats(result.count, result.inference_time, this.currentFps);
            updateResultsList(result.faces);
        } catch (error) {
            if (!this._hasShownError) {
                this._hasShownError = true;
                showToast(`Detection error: ${error.message}`, 'error', 5000);
                setTimeout(() => { this._hasShownError = false; }, 5000);
            }
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
