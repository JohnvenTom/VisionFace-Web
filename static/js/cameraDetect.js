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
    /** @type {Array<Object>} Tracked face states for smooth animation (persists across frames) */
    _trackedFaces: [],
    /** @type {Array<string>} Color palette for multi-face detection boxes */
    _faceColors: [
        '#f0a030', // amber (primary)
        '#30c0f0', // cyan
        '#e05080', // rose
        '#70d060', // green
        '#b070f0', // purple
        '#f0c030', // gold
        '#30f0b0', // teal
        '#f07040', // orange-red
    ],

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
        this._trackedFaces = [];
        this._lastRenderTime = null;

        // Cache container DOM reference
        this._containerEl = document.getElementById('canvasContainer');

        // Create reusable temp canvas for screenshot capture
        this._tempCanvas = document.createElement('canvas');
        this._tempCtx = this._tempCanvas.getContext('2d');

        // Update UI state: show video + canvas FIRST (so browser can lay them out)
        this.video.classList.remove('hidden');
        this.canvas.classList.remove('hidden');
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('scanLine').classList.remove('hidden');
        document.getElementById('btnStartCamera').disabled = true;
        document.getElementById('btnStopCamera').disabled = false;
        document.getElementById('btnPauseDetect').disabled = false;

        // Lock select dropdown while running
        this.selectEl.disabled = true;

        // Sync canvas overlay AFTER video is visible (double-RAF ensures layout is settled)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this._syncOverlayToVideo();
                this.detectLoop();
            });
        });
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

        // Reset state
        this.isRunning = false;
        this.isPaused = false;
        this.isDetecting = false;
        this._hasShownError = false;
        this._trackedFaces = [];
        this._lastRenderTime = null;

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

        showToast('Camera stopped', 'info');
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

        // FPS calculation
        this.frameCount++;
        const now = performance.now();
        if (now - this.fpsIntervalStart >= this.fpsInterval) {
            this.currentFps = Math.round(
                (this.frameCount * 1000) / (now - this.fpsIntervalStart)
            );
            this.frameCount = 0;
            this.fpsIntervalStart = now;
        }

        // === Render tracked faces every frame for smooth animation ===
        this._renderTrackedFaces(now);

        // === Send detection request at controlled interval ===
        if (this.isPaused || this.isDetecting) return;
        if (now - this.lastDetectTime < this.detectInterval) return;

        this.lastDetectTime = now;
        this.isDetecting = true;
        this.detectFrame().finally(() => { this.isDetecting = false; });
    },

    /**
     * Render all tracked faces with animated opacity, called every animation frame
     *
     * Each tracked face has an opacity value that smoothly animates:
     *   - New faces: fade in from 0 to 1 over ~250ms
     *   - Lost faces: fade out from 1 to 0 over ~300ms, then removed
     *   - Active faces: stay at full opacity
     *
     * @param {number} now - Current timestamp from performance.now()
     * @returns {void}
     */
    _renderTrackedFaces(now) {
        if (!this._displayCache || !this.ctx) return;
        const dc = this._displayCache;

        // Clear overlay
        this.ctx.clearRect(0, 0, dc.displayW, dc.displayH);

        if (this._trackedFaces.length === 0) return;

        const FADE_IN_MS = 250;
        const FADE_OUT_MS = 300;
        const dt = now - (this._lastRenderTime || now);
        this._lastRenderTime = now;

        // Animate and draw each tracked face
        const stillAlive = [];
        for (let i = 0; i < this._trackedFaces.length; i++) {
            const face = this._trackedFaces[i];

            if (face.state === 'entering') {
                face.opacity = Math.min(1, face.opacity + dt / FADE_IN_MS);
                if (face.opacity >= 1) { face.opacity = 1; face.state = 'active'; }
            } else if (face.state === 'leaving') {
                face.opacity = Math.max(0, face.opacity - dt / FADE_OUT_MS);
                if (face.opacity <= 0) continue; // Remove fully faded
            }

            stillAlive.push(face);

            this._drawSingleBox(
                face.sx, face.sy, face.sw, face.sh,
                face.confidence, face.index,
                face.color, face.opacity
            );
        }

        this._trackedFaces = stillAlive;
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

        // Guard: skip if video has zero dimensions (hidden/not laid out yet)
        if (videoRect.width < 1 || videoRect.height < 1) {
            this._displayCache = null;
            return;
        }

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

            // === 4. Refresh display cache if stale ===
            if (!this._displayCache) {
                this._syncOverlayToVideo();
            }
            const dc = this._displayCache;

            // === 5. Match new detections to tracked faces (smooth animation) ===
            this._matchDetectionsToTracked(result.faces || [], dc);

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
     * Match new detection results to existing tracked faces for smooth transitions
     *
     * Uses IoU-based matching to associate new detections with previously tracked faces:
     *   - Matched faces: update position/confidence, stay active
     *   - Unmatched new faces: enter with fade-in animation
     *   - Orphaned old faces: begin fade-out animation
     *
     * @param {Array<Object>} newFaces - Fresh detection results from backend
     * @param {Object} dc - Display cache with scale factors
     * @returns {void}
     */
    _matchDetectionsToTracked(newFaces, dc) {
        const MATCH_IOU_THRESHOLD = 0.2; // Minimum IoU to consider a match

        // Convert new detections to display coordinates
        const newDisplayFaces = [];
        for (let i = 0; i < newFaces.length; i++) {
            const f = newFaces[i];
            const [x1, y1, x2, y2] = f.bbox;
            let sx = x1 * dc.scaleX;
            let sy = y1 * dc.scaleY;
            let sw = (x2 - x1) * dc.scaleX;
            let sh = (y2 - y1) * dc.scaleY;
            // X-axis mirror flip
            sx = dc.displayW - (sx + sw);

            newDisplayFaces.push({
                sx, sy, sw, sh,
                confidence: f.confidence,
                rawIndex: i,
                color: this._faceColors[i % this._faceColors.length]
            });
        }

        // Greedy IoU matching: new detections → existing tracked faces
        const usedNew = new Set();
        const usedOld = new Set();

        for (let ti = 0; ti < this._trackedFaces.length; ti++) {
            if (usedOld.has(ti)) continue;
            const tracked = this._trackedFaces[ti];
            if (tracked.state === 'leaving') continue;

            let bestNi = -1;
            let bestIou = 0;

            for (let ni = 0; ni < newDisplayFaces.length; ni++) {
                if (usedNew.has(ni)) continue;
                const iou = this._calcIoU(tracked, newDisplayFaces[ni]);
                if (iou > bestIou) { bestIou = iou; bestNi = ni; }
            }

            if (bestNi >= 0 && bestIou >= MATCH_IOU_THRESHOLD) {
                // Match found: update tracked face position smoothly
                const nf = newDisplayFaces[bestNi];
                tracked.sx = nf.sx; tracked.sy = nf.sy;
                tracked.sw = nf.sw; tracked.sh = nf.sh;
                tracked.confidence = nf.confidence;
                tracked.index = nf.rawIndex;
                tracked.color = nf.color;
                tracked.state = 'active';
                tracked.opacity = 1;
                usedNew.add(bestNi);
                usedOld.add(ti);
            }
        }

        // Unmatched old tracked faces → start fading out
        for (let ti = 0; ti < this._trackedFaces.length; ti++) {
            if (!usedOld.has(ti) && this._trackedFaces[ti].state !== 'leaving') {
                this._trackedFaces[ti].state = 'leaving';
            }
        }

        // Unmatched new detections → add as entering (fade in)
        for (let ni = 0; ni < newDisplayFaces.length; ni++) {
            if (!usedNew.has(ni)) {
                const nf = newDisplayFaces[ni];
                this._trackedFaces.push({
                    sx: nf.sx, sy: nf.sy, sw: nf.sw, sh: nf.sh,
                    confidence: nf.confidence,
                    index: nf.rawIndex,
                    color: nf.color,
                    opacity: 0,
                    state: 'entering'
                });
            }
        }
    },

    /**
     * Calculate Intersection over Union (IoU) between two face bounding boxes
     *
     * Used for matching detected faces across frames to maintain identity.
     *
     * @param {Object} a - First box with sx, sy, sw, sh properties
     * @param {Object} b - Second box with sx, sy, sw, sh properties
     * @returns {number} IoU value between 0 (no overlap) and 1 (identical)
     */
    _calcIoU(a, b) {
        const ax1 = a.sx, ay1 = a.sy, ax2 = a.sx + a.sw, ay2 = a.sy + a.sh;
        const bx1 = b.sx, by1 = b.sy, bx2 = b.sx + b.sw, by2 = b.sy + b.sh;

        const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
        const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);

        const interW = Math.max(0, ix2 - ix1);
        const interH = Math.max(0, iy2 - iy1);
        const interArea = interW * interH;

        const areaA = a.sw * a.sh;
        const areaB = b.sw * b.sh;
        const unionArea = areaA + areaB - interArea;

        return unionArea > 0 ? interArea / unionArea : 0;
    },

    /**
     * Draw a single face detection box on the overlay canvas (camera mode)
     *
     * Uses pre-converted screen coordinates, supports per-face colors and
     * opacity animation for smooth appear/disappear transitions.
     *
     * @param {number} x - Box left X (mirrored + scaled)
     * @param {number} y - Box top Y (scaled)
     * @param {number} w - Box width
     * @param {number} h - Box height
     * @param {number} confidence - Confidence score (0-1)
     * @param {number} index - Face sequence number
     * @param {string} [color='#f0a030'] - Box color from palette
     * @param {number} [opacity=1] - Opacity for fade animation (0-1)
     * @returns {void}
     */
    _drawSingleBox(x, y, w, h, confidence, index, color, opacity) {
        const ctx = this.ctx;
        const c = color || '#f0a030';
        const alpha = opacity !== undefined ? opacity : 1;

        ctx.globalAlpha = alpha;

        // Glow effect
        ctx.shadowColor = c;
        ctx.shadowBlur = 10;

        // Detection box border
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // Corner decorations
        const cornerLen = Math.min(15, w * 0.2, h * 0.2);
        ctx.lineWidth = 3;
        ctx.beginPath();
        // Top-left
        ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y);
        // Top-right
        ctx.moveTo(x + w - cornerLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLen);
        // Bottom-right
        ctx.moveTo(x + w, y + h - cornerLen); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - cornerLen, y + h);
        // Bottom-left
        ctx.moveTo(x + cornerLen, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - cornerLen);
        ctx.stroke();

        // Reset shadow
        ctx.shadowBlur = 0;

        // Confidence label
        const label = `Face ${index + 1}: ${(confidence * 100).toFixed(1)}%`;
        ctx.font = '600 12px "Space Grotesk", "DM Sans", sans-serif';
        const textMetrics = ctx.measureText(label);
        const textW = textMetrics.width + 12;
        const textH = 20;

        // Label background with matching color
        ctx.fillStyle = this._hexToRgba(c, 0.85 * alpha);
        ctx.fillRect(x, y - textH - 2, textW, textH);

        // Label text
        ctx.fillStyle = this._hexToRgba('#0d1117', alpha);
        ctx.fillText(label, x + 6, y - 7);

        ctx.globalAlpha = 1; // Restore
    },

    /**
     * Convert hex color string to rgba() format with given alpha
     *
     * @param {string} hex - Hex color like '#f0a030'
     * @param {number} alpha - Alpha value between 0 and 1
     * @returns {string} CSS rgba() color string
     */
    _hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
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
