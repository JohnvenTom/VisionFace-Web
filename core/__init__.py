"""
YOLOv11人脸检测推理核心模块

提供图像预处理、模型推理、结果后处理等核心功能，
供FastAPI服务层调用，实现人脸检测的完整推理流程。
"""

from core.preprocess import preprocess_image
from core.detector import FaceDetector
from core.postprocess import parse_results, draw_detections

__all__ = ["preprocess_image", "FaceDetector", "parse_results", "draw_detections"]
