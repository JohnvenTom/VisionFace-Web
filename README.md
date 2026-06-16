# VisionFace-Web

<p align="center">
  <strong>基于 YOLOv11 的轻量级 Web 人脸检测系统</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#技术栈">技术栈</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#使用说明">使用说明</a> •
  <a href="#api-接口文档">API 文档</a> •
  <a href="#项目结构">项目结构</a>
</p>

---

## 项目简介

VisionFace-Web 是一套**轻量、易用、可演示、可拓展**的 Web 人脸检测系统，基于 **YOLOv11n-face** 预训练模型构建，支持浏览器端直接使用，无需安装任何客户端软件。

系统采用前后端分离架构，具备以下核心能力：

- 图片上传人脸检测（支持 JPG/PNG/JPEG）
- 本地摄像头实时人脸检测
- 检测参数实时可调（置信度阈值、NMS 阈值）
- 可视化检测结果展示（人脸框标注、置信度显示、统计信息）

适用于课程设计、毕业设计、技术演示及二次开发。

## 功能特性

| 功能 | 描述 |
|------|------|
| 图片检测 | 支持本地图片上传，自动检测并标注所有人脸位置 |
| 实时检测 | 调用本地摄像头，逐帧推理实现实时人脸追踪 |
| 参数调节 | 置信度阈值（0.1–0.9）、NMS IoU 阈值（0.1–0.9）实时可调 |
| 结果可视化 | Canvas 绘制人脸矩形框 + 置信度文本 + 统计面板 |
| 多人脸支持 | 支持同时检测多人脸、侧脸、轻度遮挡人脸 |
| 跨平台 | 支持 Windows / macOS / Linux，Chrome / Edge 主流浏览器 |

## 技术栈

### 后端
- **Python 3.9+**
- [FastAPI](https://fastapi.tiangolo.com/) - 高性能 Web 框架
- [Ultralytics](https://docs.ultralytics.com/) - YOLOv11 推理引擎
- OpenCV-Python / PIL - 图像处理
- NumPy - 数值计算
- Uvicorn - ASGI 服务器

### 前端
- HTML5 + CSS3 + JavaScript（原生，零框架依赖）
- Navigator.mediaDevices API - 摄像头调用
- Canvas API - 检测结果可视化绘制

### AI 模型
- **YOLOv11n-face** - 轻量级预训练人脸检测模型
  - 参数量少，CPU 推理速度快（< 100ms/张）
  - 小目标人脸检测精度高
  - 遮挡鲁棒性强

## 快速开始

### 环境要求

- Python >= 3.9
- 操作系统：Windows 10/11、Ubuntu 18+、macOS 10.15+
- 浏览器：Chrome 90+ 或 Edge 90+

### 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/your-username/VisionFace-Web.git
cd VisionFace-Web

# 2. 创建虚拟环境（推荐）
python -m venv venv

# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

# 3. 安装依赖
pip install -r requirements.txt

# 4. 下载模型权重（如未包含在仓库中）
# 将 yolov11n-face.pt 放入 model/ 目录
```

### 启动服务

```bash
python main.py
```

服务启动后：
- 后端 API 地址：`http://localhost:8000`
- 前端页面地址：`http://localhost:8000`
- API 文档（Swagger UI）：`http://localhost:8000/docs`
- 健康检查接口：`http://localhost:8000/api/health`

## 使用说明

### 图片上传检测

1. 打开浏览器访问 `http://localhost:8000`
2. 选择「图片检测」模式
3. 点击上传区域选择本地图片（JPG/PNG/JPEG）
4. 系统自动完成检测并在图片上标注人脸框
5. 右侧面板显示检测结果统计（人脸数量、推理耗时）

### 实时摄像头检测

1. 切换到「摄像头检测」模式
2. 点击「开启摄像头」按钮（需授权摄像头权限）
3. 系统自动进行实时人脸检测
4. 可随时调节置信度和 NMS 阈值优化检测效果
5. 点击「关闭摄像头」结束检测

### 参数说明

| 参数 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| 置信度阈值 (conf) | 0.50 | 0.1 – 0.9 | 越高越严格，减少误检但可能漏检 |
| NMS IoU 阈值 (iou) | 0.45 | 0.1 – 0.9 | 越低去重越激进，避免重复框 |

## API 接口文档

### 健康检查

```
GET /api/health
```

响应示例：
```json
{
  "status": "ok",
  "model_loaded": true,
  "device": "cpu"
}
```

### 图片人脸检测

```
POST /api/detect/image
Content-Type: application/json
```

请求体：
```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQ...",
  "conf_threshold": 0.5,
  "iou_threshold": 0.45
}
```

响应示例：
```json
{
  "faces": [
    {
      "bbox": [x1, y1, x2, y2],
      "confidence": 0.98,
      "class_id": 0,
      "class_name": "face"
    }
  ],
  "count": 3,
  "inference_time": 45.2,
  "image_shape": [640, 480]
}
```

### 视频帧人脸检测

```
POST /api/detect/frame
Content-Type: application/json
```

请求与响应格式同图片检测接口，专为实时帧流优化。

### 错误码说明

| HTTP 状态码 | 含义 |
|-------------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误（图像数据无效等） |
| 500 | 服务器内部错误（推理失败） |
| 503 | 模型未加载 |

## 项目结构

```
VisionFace-Web/
├── core/                      # 推理核心模块
│   ├── __init__.py
│   ├── detector.py            # YOLOv11 模型推理封装
│   ├── preprocess.py          # 图像预处理（Base64解码、验证）
│   └── postprocess.py         # 结果解析与格式化
├── model/                     # 模型权重目录
│   └── model.pt               # YOLOv11n-face 预训练权重
├── static/                    # 前端静态资源
│   ├── index.html             # 主页面
│   ├── css/
│   │   └── style.css          # 样式文件
│   └── js/
│       ├── app.js             # 应用主逻辑
│       ├── cameraDetect.js    # 摄像头检测模块
│       ├── imageDetect.js     # 图片检测模块
│       └── utils.js           # 工具函数
├── main.py                    # FastAPI 服务入口
├── requirements.txt           # Python 依赖清单
├── .gitignore                 # Git 忽略规则
└── README.md                  # 项目说明文档
```

## 性能指标

| 指标 | 数值 |
|------|------|
| 单张图片推理耗时 | < 100ms（CPU） |
| 摄像头实时检测帧率 | 15 – 25 FPS |
| 支持最大人脸数 | 无硬性限制 |
| 内存占用 | ~500MB（含模型） |

## 开发指南

### 添加新功能

系统采用模块化设计，各层解耦清晰：

- **新增检测模式**：在 `core/detector.py` 添加方法，`main.py` 注册路由，前端对应 JS 模块调用
- **修改预处理逻辑**：编辑 `core/preprocess.py`
- **调整结果输出格式**：编辑 `core/postprocess.py`
- **更新界面样式**：编辑 `static/css/style.css`

### 扩展方向（可选）

- [ ] 人脸裁剪保存功能
- [ ] 检测结果图片下载导出
- [ ] 人脸关键点（5点/68点）可视化
- [ ] 批量图片检测与对比
- [ ] 人脸识别集成（基于 embedding 相似度）
- [ ] 视频文件批量检测

## 常见问题

**Q: 启动时报错 "model file not found"**
A: 请确保 `model/model.pt` 文件存在。可从 [Ultralytics 官方](https://docs.ultralytics.com/tasks/detect/) 获取 YOLOv11n-face 权重。

**Q: 摄像头无法打开**
A: 请确认浏览器已授予摄像头权限，且未被其他应用占用。

**Q: 检测速度较慢**
A: 默认使用 CPU 推理。如有 NVIDIA GPU 并安装了 CUDA，系统会自动切换到 GPU 加速。

**Q: 跨域请求被拒绝**
A: 后端已配置全局 CORS，确保前后端端口一致即可。

## License

MIT License

## 致谢

- [Ultralytics YOLOv11](https://github.com/ultralytics/ultralytics) - 开源目标检测框架
- [FastAPI](https://github.com/tiangolo/fastapi) - 现代 Python Web 框架
