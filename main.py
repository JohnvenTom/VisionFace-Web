"""
FastAPI主服务入口

启动Web人脸检测系统的后端服务，提供图片检测与视频帧检测的API接口，
挂载前端静态资源，配置CORS跨域支持与全局异常处理。
"""

import traceback
import json

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from core.detector import FaceDetector
from core.preprocess import decode_base64_image, decode_binary_image, validate_image
from core.postprocess import parse_results

# ============================================================
# FastAPI应用实例
# ============================================================
app = FastAPI(
    title="YOLOv11人脸检测系统",
    description="基于YOLOv11的Web人脸检测系统API，支持图片上传检测与摄像头实时检测",
    version="1.0.0"
)

# ============================================================
# CORS跨域配置
# ============================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# 全局模型实例（服务启动时加载，常驻内存）
# ============================================================
detector: FaceDetector = None


@app.on_event("startup")
async def startup_event():
    """
    服务启动事件：加载YOLOv11人脸检测模型

    Notes:
        - 模型在服务启动时一次性加载，常驻内存
        - 加载失败会打印详细错误信息但不会阻止服务启动（便于通过 /api/health 查看状态）
    """
    global detector
    try:
        detector = FaceDetector()
        print("=" * 50)
        print("[Startup] YOLOv11人脸检测模型加载成功")
        print(f"[Startup] 推理设备: {detector.device}")
        print(f"[Startup] 模型路径: {detector.model_path}")
        print("[Startup] 访问地址: http://localhost:8000")
        print("=" * 50)
    except FileNotFoundError as e:
        print("=" * 50)
        print("[Startup] [错误] 未找到模型权重文件!")
        print(f"[Startup] {e}")
        print("[Startup] 请下载 YOLOv11n-face 模型并放入 model/ 目录")
        print("[Startup] 下载地址: https://github.com/deepcam-cn/yolov11-face")
        print("[Startup] 当前服务可启动但检测功能不可用 (503)")
        print("=" * 50)
    except Exception as e:
        print(f"[Startup] [错误] 模型加载异常: {e}")
        import traceback
        traceback.print_exc()


# ============================================================
# 请求模型定义
# ============================================================
class DetectRequest(BaseModel):
    """
    人脸检测请求模型

    Attributes:
        image: Base64编码的图像数据
        conf_threshold: 置信度阈值，范围0.1-0.9，默认0.5
        iou_threshold: NMS的IoU阈值，范围0.1-0.9，默认0.45
    """
    image: str = Field(..., description="Base64编码的图像数据")
    conf_threshold: float = Field(default=0.5, ge=0.1, le=0.9, description="置信度阈值")
    iou_threshold: float = Field(default=0.45, ge=0.1, le=0.9, description="NMS IoU阈值")


class HealthResponse(BaseModel):
    """
    Health check response model

    Attributes:
        status: Service status
        model_loaded: Whether model is loaded
        device: Current inference device
        cuda_available: Whether CUDA/GPU is available on this machine
    """
    status: str
    model_loaded: bool
    device: str = "unknown"
    cuda_available: bool = False


class DeviceSwitchRequest(BaseModel):
    """
    Device switch request model

    Attributes:
        device: Target device, 'cpu' or 'cuda'
    """
    device: str = Field(..., description="Target inference device: 'cpu' or 'cuda'")


# ============================================================
# API接口
# ============================================================
@app.get("/api/health", response_model=HealthResponse, summary="Health check")
async def health_check():
    """
    Health check endpoint with device info

    Returns:
        HealthResponse: Service status, model state, current device, CUDA availability
    """
    cuda_avail = False
    try:
        import torch
        cuda_avail = torch.cuda.is_available()
    except ImportError:
        pass

    return HealthResponse(
        status="ok",
        model_loaded=detector is not None,
        device=detector.device if detector else "unknown",
        cuda_available=cuda_avail
    )


@app.post("/api/device", summary="Switch inference device")
async def switch_device(request: DeviceSwitchRequest):
    """
    Switch inference device between CPU and GPU at runtime

    Args:
        request: Device switch request with target device ('cpu' or 'cuda')

    Returns:
        dict: Switch result with success status, current device, and message

    Raises:
        HTTPException: Model not loaded (503), or invalid device (400)
    """
    if detector is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    result = detector.switch_device(request.device)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@app.post("/api/detect/image", summary="图片人脸检测")
async def detect_image(request: DetectRequest):
    """
    图片人脸检测接口

    接收前端上传的Base64图像数据，执行YOLOv11推理检测，返回人脸框坐标、
    置信度、人脸数量及推理耗时。

    Args:
        request: 检测请求，包含Base64图像、置信度阈值和IoU阈值

    Returns:
        dict: 检测结果，包含faces(人脸列表)、count(数量)、
              inference_time(耗时ms)、image_shape(图像尺寸)

    Raises:
        HTTPException: 模型未加载(503)、图像数据无效(400)、推理失败(500)
    """
    if detector is None:
        raise HTTPException(status_code=503, detail="模型未加载，请检查模型文件是否存在")

    try:
        # 解码Base64图像
        image = decode_base64_image(request.image)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"图像数据无效: {e}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"图像解码失败: {e}")

    try:
        # 执行推理
        result = detector.detect(
            image=image,
            conf_threshold=request.conf_threshold,
            iou_threshold=request.iou_threshold
        )
        return parse_results(result)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"推理失败: {e}")


@app.post("/api/detect/frame", summary="视频帧人脸检测")
async def detect_frame(request: DetectRequest):
    """
    视频帧人脸检测接口

    适配摄像头实时帧流，轻量快速推理，接口格式与图片检测一致。

    Args:
        request: 检测请求，包含Base64帧数据、置信度阈值和IoU阈值

    Returns:
        dict: 检测结果，格式与图片检测接口一致

    Raises:
        HTTPException: 模型未加载(503)、帧数据无效(400)、推理失败(500)

    Notes:
        - 与图片检测接口分离，便于后续针对视频流做优化
        - 可添加帧率控制、分辨率降采样等策略
    """
    if detector is None:
        raise HTTPException(status_code=503, detail="模型未加载，请检查模型文件是否存在")

    try:
        image = decode_base64_image(request.image)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"帧数据无效: {e}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"帧解码失败: {e}")

    try:
        result = detector.detect_frame(
            frame=image,
            conf_threshold=request.conf_threshold,
            iou_threshold=request.iou_threshold
        )
        return parse_results(result)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"推理失败: {e}")


@app.websocket("/ws/detect")
async def websocket_detect(websocket: WebSocket):
    """
    WebSocket实时人脸检测端点

    通过持久WebSocket连接接收前端发送的二进制图像帧，
    执行YOLOv11推理后以JSON格式推送检测结果。

    通信协议：
      - 客户端 → 服务端：二进制帧（JPEG/PNG图像字节）
      - 服务端 → 客户端：JSON文本帧（检测结果）
      - 配置消息：客户端首次连接或参数变更时发送JSON文本帧
          {"type": "config", "conf_threshold": 0.5, "iou_threshold": 0.45}
      - 错误响应：服务端发送JSON文本帧
          {"type": "error", "detail": "错误信息"}

    Args:
        websocket: FastAPI WebSocket连接实例

    Raises:
        WebSocketDisconnect: 当客户端主动断开连接时抛出

    Notes:
        - 替代原有的HTTP POST /api/detect/frame轮询模式
        - 二进制传输消除Base64编解码开销，延迟降低约30-50%
        - 持久连接避免TCP/TLS重复握手开销
        - 单连接独占，适合摄像头实时检测场景
    """
    if detector is None:
        await websocket.close(code=1013, reason="模型未加载")
        return

    await websocket.accept()

    # 默认检测阈值（可通过配置消息动态调整）
    conf_threshold = 0.5
    iou_threshold = 0.45

    async def safe_send(data):
        """
        安全发送WebSocket消息，客户端断连时静默处理

        Args:
            data: 待发送的数据（dict会被转为JSON文本帧）

        Returns:
            bool: 发送成功返回True，客户端已断连返回False
        """
        try:
            await websocket.send_json(data)
            return True
        except (WebSocketDisconnect, Exception):
            return False

    try:
        while True:
            # 接收消息（可能是二进制帧数据或文本配置消息）
            data = await websocket.receive()

            # 处理文本类型的配置消息
            if data.get("text"):
                try:
                    config = json.loads(data["text"])
                    if config.get("type") == "config":
                        conf_threshold = config.get("conf_threshold", conf_threshold)
                        iou_threshold = config.get("iou_threshold", iou_threshold)
                        await safe_send({
                            "type": "config_ack",
                            "conf_threshold": conf_threshold,
                            "iou_threshold": iou_threshold
                        })
                    elif config.get("type") == "device":
                        # Handle device switch via WebSocket
                        target = config.get("device", "")
                        result = detector.switch_device(target)
                        await safe_send({
                            "type": "device_ack",
                            **result
                        })
                except (json.JSONDecodeError, TypeError):
                    await safe_send({"type": "error", "detail": "Invalid message format"})
                continue

            # 处理二进制帧数据
            binary_data = data.get("bytes")
            if not binary_data:
                continue

            try:
                # 直接解码二进制图像（无需Base64解码）
                image = decode_binary_image(binary_data)
            except ValueError as e:
                await safe_send({"type": "error", "detail": f"Invalid frame data: {e}"})
                continue
            except Exception as e:
                await safe_send({"type": "error", "detail": f"Frame decode failed: {e}"})
                continue

            try:
                # 执行推理
                result = detector.detect_frame(
                    frame=image,
                    conf_threshold=conf_threshold,
                    iou_threshold=iou_threshold
                )
                # 推送检测结果（JSON文本帧）
                await safe_send(parse_results(result))
            except Exception as e:
                traceback.print_exc()
                await safe_send({"type": "error", "detail": f"Inference failed: {e}"})

    except WebSocketDisconnect:
        print("[WS] Client disconnected")
    except RuntimeError as e:
        # 客户端断连后 receive() 会抛出此异常，属于正常情况
        msg_lower = str(e).lower()
        if "disconnect" in msg_lower or "receive" in msg_lower or "send" in msg_lower:
            print("[WS] Connection closed by client")
        else:
            print(f"[WS] Runtime error: {e}")
    except Exception as e:
        print(f"[WS] Unexpected error: {e}")
        try:
            await websocket.close(code=1011, reason=f"Server internal error: {e}")
        except Exception:
            pass


# ============================================================
# 全局异常处理
# ============================================================
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """
    全局异常处理器

    Args:
        request: 请求对象
        exc: 异常实例

    Returns:
        JSONResponse: 包含错误详情的JSON响应，状态码500

    Notes:
        - 捕获所有未处理的异常，返回友好的错误信息
        - 避免向前端暴露内部堆栈信息
    """
    return JSONResponse(
        status_code=500,
        content={"detail": f"服务器内部错误: {str(exc)}"}
    )


# ============================================================
# 静态资源挂载（必须放在所有路由之后）
# ============================================================
app.mount("/", StaticFiles(directory="static", html=True), name="static")


# ============================================================
# 服务启动入口
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
