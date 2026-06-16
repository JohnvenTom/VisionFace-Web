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
