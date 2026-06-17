/**
 * 应用主控制器
 *
 * 负责全局状态管理、模块初始化、模式切换、参数调节、
 * 重置操作、服务状态检查等核心控制逻辑。
 */

/**
 * 应用主控制器对象
 *
 * 统一管理图片检测和摄像头检测模块，协调模式切换、
 * 参数变更、重置操作等全局交互行为。
 *
 * @namespace App
 */
const App = {
    /** @type {'image'|'camera'} 当前检测模式 */
    currentMode: 'image',

    /**
     * 应用初始化入口
     *
     * 初始化所有子模块，绑定全局事件监听器，检查服务状态。
     * 在DOM加载完成后自动调用。
     *
     * @returns {void}
     *
     * @notes
     *   - 初始化顺序：子模块 → 事件绑定 → 服务状态检查
     *   - 服务状态检查失败不影响页面基本功能
     */
    init() {
        // Initialize sub-modules
        ImageDetector.init();
        CameraDetector.init();

        // Bind global events
        this.bindModeSwitch();
        this.bindParamSliders();
        this.bindResetButton();
        this.bindDeviceSwitch();

        // Check server status (immediately + every 30s)
        this.checkServerStatus();
        setInterval(() => this.checkServerStatus(), 30000);
    },

    /**
     * 绑定检测模式切换事件
     *
     * 在图片检测和摄像头检测模式之间切换，
     * 控制对应面板区域的显示/隐藏。
     *
     * @returns {void}
     *
     * @notes
     *   - 切换模式时会自动停止当前模式的检测
     *   - 图片模式显示上传区域，摄像头模式显示控制按钮
     */
    bindModeSwitch() {
        const btnImage = document.getElementById('btnImageMode');
        const btnCamera = document.getElementById('btnCameraMode');
        const imageSection = document.getElementById('imageUploadSection');
        const cameraSection = document.getElementById('cameraControlSection');

        btnImage.addEventListener('click', () => {
            if (this.currentMode === 'image') return;

            // 停止摄像头
            CameraDetector.stop();

            this.currentMode = 'image';
            btnImage.classList.add('active');
            btnCamera.classList.remove('active');
            imageSection.classList.remove('hidden');
            cameraSection.classList.add('hidden');

            // 切换画布显示
            document.getElementById('imageCanvas').classList.remove('hidden');
            document.getElementById('cameraVideo').classList.add('hidden');
            document.getElementById('cameraCanvas').classList.add('hidden');

            // 如果没有图片，显示空状态
            if (!ImageDetector.currentImage) {
                document.getElementById('imageCanvas').classList.add('hidden');
                document.getElementById('emptyState').classList.remove('hidden');
            }
        });

        btnCamera.addEventListener('click', () => {
            if (this.currentMode === 'camera') return;

            // 隐藏图片画布
            ImageDetector.reset();

            this.currentMode = 'camera';
            btnCamera.classList.add('active');
            btnImage.classList.remove('active');
            cameraSection.classList.remove('hidden');
            imageSection.classList.add('hidden');

            // 隐藏图片画布
            document.getElementById('imageCanvas').classList.add('hidden');
        });
    },

    /**
     * 绑定参数滑块事件
     *
     * 监听置信度和IoU阈值滑块的值变化，实时更新显示值。
     *
     * @returns {void}
     *
     * @notes
     *   - 参数修改实时生效，无需重启服务
     *   - 下次检测请求将自动使用新参数值
     */
    bindParamSliders() {
        const confSlider = document.getElementById('confSlider');
        const iouSlider = document.getElementById('iouSlider');
        const confValue = document.getElementById('confValue');
        const iouValue = document.getElementById('iouValue');

        confSlider.addEventListener('input', () => {
            confValue.textContent = parseFloat(confSlider.value).toFixed(2);
        });

        iouSlider.addEventListener('input', () => {
            iouValue.textContent = parseFloat(iouSlider.value).toFixed(2);
        });
    },

    /**
     * 绑定重置按钮事件
     *
     * 一键清空画面、重置检测状态、恢复默认参数。
     *
     * @returns {void}
     *
     * @notes
     *   - 重置后参数恢复默认值（conf=0.5, iou=0.45）
     *   - 统计信息清零
     *   - 检测结果列表清空
     */
    bindResetButton() {
        document.getElementById('btnReset').addEventListener('click', () => {
            // 重置当前模式
            if (this.currentMode === 'image') {
                ImageDetector.reset();
            } else {
                CameraDetector.reset();
            }

            // 显示空状态
            document.getElementById('emptyState').classList.remove('hidden');
            document.getElementById('scanLine').classList.add('hidden');

            // 重置参数
            document.getElementById('confSlider').value = 0.5;
            document.getElementById('iouSlider').value = 0.45;
            document.getElementById('confValue').textContent = '0.50';
            document.getElementById('iouValue').textContent = '0.45';

            // 重置统计
            updateStats(0, 0, null);
            document.getElementById('fpsValue').textContent = '-- FPS';
            updateResultsList([]);

            showToast('已重置', 'info');
        });
    },

    /**
     * 检查后端服务状态
     *
     * 请求健康检查接口，更新顶部状态指示器。
     *
     * @returns {Promise<void>}
     *
     * @notes
     *   - 服务可用时显示绿色在线状态
     *   - 服务不可达时显示红色离线状态
     *   - 模型未加载时显示黄色警告状态
     *   - 每30秒自动刷新一次状态
     */
    /**
     * Bind device switch (CPU/GPU) click events
     *
     * Sends a POST request to /api/device to switch inference device.
     * Updates chip active state, status pill, and hint text accordingly.
     *
     * @returns {void}
     */
    bindDeviceSwitch() {
        const btnCpu = document.getElementById('btnDeviceCpu');
        const btnGpu = document.getElementById('btnDeviceGpu');
        const hint   = document.getElementById('deviceHint');

        const switchTo = async (targetDevice) => {
            // Prevent double-click on already-active
            if ((targetDevice === 'cpu' && btnCpu.classList.contains('active')) ||
                (targetDevice === 'cuda' && btnGpu.classList.contains('active'))) {
                return;
            }

            try {
                hint.textContent = 'Switching...';
                const res = await fetch('/api/device', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ device: targetDevice })
                });
                const data = await res.json();

                if (!res.ok) {
                    hint.textContent = data.detail || 'Switch failed';
                    showToast(data.detail || 'Device switch failed', 'error');
                    return;
                }

                // Update chip states
                btnCpu.classList.toggle('active', targetDevice === 'cpu');
                btnGpu.classList.toggle('active', targetDevice === 'cuda');

                // Update status pill
                this._updateDevicePill(targetDevice);

                hint.textContent = data.message || `Now on ${targetDevice.toUpperCase()}`;
                showToast(`Device: ${data.message || targetDevice.toUpperCase()}`, 'success');
            } catch (err) {
                hint.textContent = 'Request failed';
                showToast(`Device switch error: ${err.message}`, 'error');
            }
        };

        btnCpu.addEventListener('click', () => switchTo('cpu'));
        btnGpu.addEventListener('click', () => switchTo('cuda'));
    },

    /**
     * Update the Device status pill color and label
     *
     * @param {string} device - Current device identifier ('cpu' or 'cuda')
     * @returns {void}
     */
    _updateDevicePill(device) {
        const devicePill = document.getElementById('deviceStatus');
        const deviceLabel = devicePill.querySelector('span:last-child');
        deviceLabel.textContent = device === 'cuda' ? 'GPU' : 'CPU';
        // Color is handled by checkServerStatus via health.device
    },

    async checkServerStatus() {
        const serverPill = document.getElementById('serverStatus');
        const modelPill  = document.getElementById('modelStatus');
        const devicePill = document.getElementById('deviceStatus');
        const serverDot = serverPill.querySelector('.dot');
        const modelDot  = modelPill.querySelector('.dot');
        const deviceLabel = devicePill.querySelector('span:last-child');

        // Device switcher elements
        const btnCpu = document.getElementById('btnDeviceCpu');
        const btnGpu = document.getElementById('btnDeviceGpu');
        const hint   = document.getElementById('deviceHint');

        try {
            const health = await checkHealth();

            // Server online — green
            serverPill.className = 'status-pill ok';
            serverDot.className = 'dot';

            // Model status
            if (health.model_loaded) {
                modelPill.className = 'status-pill ok';
                modelDot.className = 'dot';
            } else {
                modelPill.className = 'status-pill warn';
                modelDot.className = 'dot';
            }

            // Device info — update pill label + sync switcher chips
            const currentDevice = health.device || 'cpu';
            deviceLabel.textContent = currentDevice === 'cuda' ? 'GPU' : 'CPU';

            // Sync device switcher chips with actual backend state
            if (btnCpu && btnGpu) {
                btnCpu.classList.toggle('active', currentDevice === 'cpu');
                btnGpu.classList.toggle('active', currentDevice === 'cuda');

                // Enable/disable GPU button based on CUDA availability
                if (health.cuda_available) {
                    btnGpu.disabled = false;
                    if (!hint.textContent || hint.textContent.includes('not available')) {
                        hint.textContent = '';
                    }
                } else {
                    btnGpu.disabled = true;
                    hint.textContent = 'GPU unavailable (no CUDA)';
                }
            }
        } catch (error) {
            serverPill.className = 'status-pill err';
            serverDot.className = 'dot';
            modelPill.className = 'status-pill err';
            modelDot.className = 'dot';
            deviceLabel.textContent = 'Offline';
        }
    }
};

// DOM加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
