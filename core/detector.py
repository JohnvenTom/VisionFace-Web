"""
YOLOv11人脸检测模型推理封装模块

封装Ultralytics YOLOv11人脸检测模型的加载与推理逻辑，
提供统一的检测接口，支持图片和视频帧的推理调用。
"""

import time
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO


def _find_model_file(model_dir: Path) -> Path:
    """
    在模型目录中自动查找可用的YOLOv11权重文件

    按优先级依次匹配：yolov11n-face.pt > *.pt > *.onnx
    若目录为空或无匹配文件则返回None

    Args:
        model_dir: 模型权重所在目录路径

    Returns:
        Path: 找到的模型文件路径，未找到时返回None
    """
    if not model_dir.exists() or not model_dir.is_dir():
        return None

    # 优先匹配标准命名
    for name in ["yolov11n-face.pt", "model.pt"]:
        candidate = model_dir / name
        if candidate.exists():
            return candidate

    # 回退：任意 .pt 文件
    pt_files = list(model_dir.glob("*.pt"))
    if pt_files:
        return pt_files[0]

    # 再回退：.onnx 文件
    onnx_files = list(model_dir.glob("*.onnx"))
    if onnx_files:
        return onnx_files[0]

    return None


class FaceDetector:
    """
    YOLOv11人脸检测器

    封装模型加载、推理、结果返回等核心逻辑，
    服务启动时加载模型常驻内存，避免重复加载耗时。

    Attributes:
        model: Ultralytics YOLO模型实例
        device: 推理设备标识（cpu或cuda）
        model_path: 模型权重文件路径
    """

    # 默认模型权重目录
    DEFAULT_MODEL_DIR = Path(__file__).parent.parent / "model"

    def __init__(self, model_path: str = None):
        """
        初始化人脸检测器，加载YOLOv11模型权重

        Args:
            model_path: 模型权重文件路径，为None时自动在model/目录下查找

        Raises:
            FileNotFoundError: 当模型权重文件不存在时抛出
            RuntimeError: 当模型加载失败时抛出

        Notes:
            - 自动检测并选择GPU/CPU推理设备
            - 未指定路径时按优先级自动查找：yolov11n-face.pt > model.pt > 任意.pt
            - 模型加载后常驻内存，服务运行期间不重复加载
        """
        if model_path:
            self.model_path = Path(model_path)
        else:
            self.model_path = _find_model_file(self.DEFAULT_MODEL_DIR)

        if not self.model_path or not self.model_path.exists():
            # 列出目录中实际存在的文件用于提示
            dir_files = []
            if self.DEFAULT_MODEL_DIR.exists():
                dir_files = [f.name for f in self.DEFAULT_MODEL_DIR.iterdir() if f.is_file()]
            raise FileNotFoundError(
                f"未找到模型权重文件\n"
                f"查找目录: {self.DEFAULT_MODEL_DIR}\n"
                f"目录现有文件: {dir_files if dir_files else '(空)'}\n"
                f"请将 YOLOv11 人脸检测模型(.pt)放入 model/ 目录\n"
                f"支持的文件名: yolov11n-face.pt / model.pt / 任意 .pt 文件"
            )

        try:
            self.model = YOLO(str(self.model_path))
        except Exception as e:
            raise RuntimeError(f"YOLOv11模型加载失败: {e}")

        # 自动检测推理设备
        self.device = self._detect_device()
        print(f"[FaceDetector] 模型加载成功 | 设备: {self.device} | 路径: {self.model_path}")

    def _detect_device(self) -> str:
        """
        Auto-detect available inference device

        Returns:
            str: 'cuda' if GPU available, otherwise 'cpu'
        """
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda"
        except ImportError:
            pass
        return "cpu"

    def switch_device(self, target_device: str) -> dict:
        """
        Switch inference device at runtime (CPU <-> GPU)

        Validates the target device availability before switching.
        Switching to CUDA requires PyTorch with CUDA support installed.

        Args:
            target_device: Target device identifier, 'cuda' or 'cpu'

        Returns:
            dict: Result with keys:
                - success (bool): Whether the switch succeeded
                - device (str): The actual device after switching
                - message (str): Human-readable status message

        Notes:
            - Switching to 'cuda' will fail gracefully if CUDA is unavailable
            - Model weights remain loaded; only the inference device changes
            - Safe to call repeatedly (no-op if already on target device)
        """
        target = target_device.lower().strip()

        if target == self.device:
            return {
                "success": True,
                "device": self.device,
                "message": f"Already running on {self.device.upper()}"
            }

        if target == "cuda":
            try:
                import torch
                if not torch.cuda.is_available():
                    return {
                        "success": False,
                        "device": self.device,
                        "message": "CUDA not available. Install PyTorch with CUDA support."
                    }
            except ImportError:
                return {
                    "success": False,
                    "device": self.device,
                    "message": "PyTorch not installed or CUDA not available."
                }
        elif target != "cpu":
            return {
                "success": False,
                "device": self.device,
                "message": f"Invalid device '{target}'. Use 'cpu' or 'cuda'."
            }

        # Perform the switch
        old_device = self.device
        self.device = target
        print(f"[FaceDetector] Device switched: {old_device} → {self.device}")
        return {
            "success": True,
            "device": self.device,
            "message": f"Switched from {old_device} to {self.device.upper()}"
        }

    def detect(
        self,
        image: np.ndarray,
        conf_threshold: float = 0.5,
        iou_threshold: float = 0.45
    ) -> dict:
        """
        对输入图像执行人脸检测推理

        Args:
            image: OpenCV格式的BGR图像数组，形状为(H, W, 3)
            conf_threshold: 置信度阈值，低于此值的检测结果将被过滤，默认0.5
            iou_threshold: NMS的IoU阈值，用于去除重叠检测框，默认0.45

        Returns:
            dict: 检测结果字典，包含以下字段：
                - faces (list): 人脸信息列表，每项包含bbox(坐标)和confidence(置信度)
                - count (int): 检测到的人脸数量
                - inference_time (float): 推理耗时（毫秒）
                - image_shape (tuple): 原始图像尺寸(H, W)

        Raises:
            ValueError: 当输入图像无效时抛出
            RuntimeError: 当推理过程发生错误时抛出

        Notes:
            - 推理前会自动进行图像格式转换（BGR→RGB）
            - 返回的bbox坐标格式为[x1, y1, x2, y2]，基于原始图像尺寸
        """
        if image is None or image.size == 0:
            raise ValueError("输入图像无效")

        # BGR转RGB
        if len(image.shape) == 3 and image.shape[2] == 3:
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        else:
            image_rgb = image

        start_time = time.time()

        try:
            results = self.model(
                source=image_rgb,
                conf=conf_threshold,
                iou=iou_threshold,
                max_det=300,
                device=self.device,
                verbose=False
            )
        except Exception as e:
            raise RuntimeError(f"模型推理失败: {e}")

        inference_time = (time.time() - start_time) * 1000  # 转换为毫秒

        # 解析检测结果
        faces = []
        if results and len(results) > 0:
            result = results[0]
            if result.boxes is not None and len(result.boxes) > 0:
                boxes = result.boxes
                for i in range(len(boxes)):
                    # 获取边界框坐标（已还原到原始图像尺寸）
                    bbox = boxes.xyxy[i].cpu().numpy().tolist()
                    confidence = float(boxes.conf[i].cpu().numpy())

                    faces.append({
                        "bbox": [round(coord, 2) for coord in bbox],
                        "confidence": round(confidence, 4)
                    })

        return {
            "faces": faces,
            "count": len(faces),
            "inference_time": round(inference_time, 2),
            "image_shape": list(image.shape[:2])
        }

    def detect_frame(
        self,
        frame: np.ndarray,
        conf_threshold: float = 0.5,
        iou_threshold: float = 0.45
    ) -> dict:
        """
        对视频帧执行轻量级人脸检测，专为实时摄像头流优化

        Args:
            frame: 视频帧，OpenCV格式的BGR图像数组
            conf_threshold: 置信度阈值，默认0.5
            iou_threshold: NMS的IoU阈值，默认0.45

        Returns:
            dict: 检测结果字典，格式与detect方法一致

        Notes:
            - 与detect方法功能一致，独立方法便于后续针对视频流优化
            - 可在此方法中添加帧跳跃、分辨率降采样等优化策略
        """
        return self.detect(frame, conf_threshold, iou_threshold)
