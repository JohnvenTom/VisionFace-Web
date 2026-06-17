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
        // 初始化子模块
        ImageDetector.init();
        CameraDetector.init();

        // 绑定全局事件
        this.bindModeSwitch();
        this.bindParamSliders();
        this.bindResetButton();

        // 检查服务状态（立即执行一次，之后每30秒轮询）
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
    async checkServerStatus() {
        const serverDot = document.querySelector('#serverStatus .status-dot');
        const modelDot = document.querySelector('#modelStatus .status-dot');
        const deviceLabel = document.querySelector('#deviceStatus .status-label');

        try {
            const health = await checkHealth();

            // 服务器在线
            serverDot.className = 'status-dot online';

            // 模型状态
            if (health.model_loaded) {
                modelDot.className = 'status-dot online';
            } else {
                modelDot.className = 'status-dot loading';
            }

            // 设备信息
            deviceLabel.textContent = health.device === 'cuda' ? 'GPU加速' : 'CPU推理';
        } catch (error) {
            serverDot.className = 'status-dot offline';
            modelDot.className = 'status-dot offline';
            deviceLabel.textContent = '服务离线';
        }
    }
};

// DOM加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
