/**
 * 图片上传检测模块
 *
 * 负责图片上传交互、拖拽上传、图片检测请求发送、
 * Canvas绘制检测结果等图片检测相关业务逻辑。
 */

/**
 * 图片检测器对象
 *
 * 封装图片上传检测的全部状态与方法，包括文件选择、拖拽上传、
 * API请求、Canvas绘制等功能。
 *
 * @namespace ImageDetector
 */
const ImageDetector = {
    /** @type {HTMLCanvasElement} 图片检测画布元素 */
    canvas: null,
    /** @type {CanvasRenderingContext2D} 画布2D渲染上下文 */
    ctx: null,
    /** @type {HTMLImageElement|null} 当前加载的图片对象 */
    currentImage: null,
    /** @type {boolean} 是否正在检测中 */
    isDetecting: false,

    /**
     * 初始化图片检测模块
     *
     * 绑定文件选择、拖拽上传等事件监听器，初始化Canvas上下文。
     *
     * @returns {void}
     *
     * @notes
     *   - 必须在DOM加载完成后调用
     *   - 拖拽上传支持dragover/drop事件
     */
    init() {
        this.canvas = document.getElementById('imageCanvas');
        this.ctx = this.canvas.getContext('2d');

        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');

        // 点击上传
        uploadZone.addEventListener('click', () => fileInput.click());

        // 文件选择
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.handleFile(e.target.files[0]);
            }
        });

        // 拖拽上传
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.handleFile(e.dataTransfer.files[0]);
            }
        });
    },

    /**
     * 处理用户选择的图片文件
     *
     * 验证文件类型、读取图片、发送检测请求并绘制结果。
     *
     * @param {File} file - 用户选择的图片文件
     * @returns {Promise<void>}
     *
     * @throws 当文件类型不支持或检测请求失败时通过Toast提示用户
     *
     * @notes
     *   - 仅支持jpg、png、jpeg格式
     *   - 检测过程中显示加载遮罩
     *   - 检测完成后自动绘制人脸框和统计信息
     */
    async handleFile(file) {
        // 验证文件类型
        const validTypes = ['image/jpg', 'image/jpeg', 'image/png'];
        if (!validTypes.includes(file.type)) {
            showToast('仅支持 JPG/PNG 格式图片', 'error');
            return;
        }

        if (this.isDetecting) return;
        this.isDetecting = true;

        try {
            // 显示加载状态
            document.getElementById('loadingOverlay').classList.remove('hidden');
            document.getElementById('scanLine').classList.remove('hidden');

            // 转换为Base64
            const base64 = await fileToBase64(file);

            // 加载图片到Image对象
            const img = await this.loadImage(base64);
            this.currentImage = img;

            // 获取当前参数
            const conf = parseFloat(document.getElementById('confSlider').value);
            const iou = parseFloat(document.getElementById('iouSlider').value);

            // 发送检测请求（Base64去掉前缀）
            const result = await detectRequest(
                '/api/detect/image',
                base64,
                conf,
                iou
            );

            // 绘制结果
            this.drawResult(img, result);

            // 更新统计
            updateStats(result.count, result.inference_time);
            updateResultsList(result.faces);

            showToast(`检测完成：发现 ${result.count} 张人脸`, 'success');
        } catch (error) {
            showToast(`检测失败：${error.message}`, 'error');
        } finally {
            this.isDetecting = false;
            document.getElementById('loadingOverlay').classList.add('hidden');
            document.getElementById('scanLine').classList.add('hidden');
        }
    },

    /**
     * 加载图片为Image对象
     *
     * @param {string} src - 图片源地址或Base64字符串
     * @returns {Promise<HTMLImageElement>} 加载完成的Image对象
     * @throws {Error} 当图片加载失败时抛出异常
     */
    loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = src;
        });
    },

    /**
     * 在Canvas上绘制图片及检测结果
     *
     * @param {HTMLImageElement} img - 原始图片对象
     * @param {Object} result - API返回的检测结果对象
     * @param {Array} result.faces - 人脸信息列表
     * @param {number} result.count - 人脸数量
     * @param {number} result.inference_time - 推理耗时
     * @returns {void}
     *
     * @notes
     *   - Canvas尺寸适配容器，保持图片宽高比
     *   - 检测框坐标根据缩放比例映射到Canvas显示尺寸
     */
    drawResult(img, result) {
        const container = document.getElementById('canvasContainer');
        const maxW = container.clientWidth - 20;
        const maxH = container.clientHeight - 20;

        // 计算适配尺寸
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const displayW = Math.floor(img.width * scale);
        const displayH = Math.floor(img.height * scale);

        this.canvas.width = displayW;
        this.canvas.height = displayH;

        // 绘制图片
        this.ctx.drawImage(img, 0, 0, displayW, displayH);

        // 绘制检测框
        if (result.faces && result.faces.length > 0) {
            drawFaceBoxes(this.ctx, result.faces, scale, scale);
        }

        // 显示画布
        this.canvas.classList.remove('hidden');
        document.getElementById('emptyState').classList.add('hidden');
    },

    /**
     * 重置图片检测状态
     *
     * 清空画布、隐藏Canvas、重置统计信息。
     *
     * @returns {void}
     */
    reset() {
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        this.canvas.classList.add('hidden');
        this.currentImage = null;
        this.isDetecting = false;
        document.getElementById('fileInput').value = '';
    }
};
