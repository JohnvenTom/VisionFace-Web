"""
图像预处理模块

负责将前端传输的Base64图像数据解码、格式转换及尺寸调整，
为YOLOv11模型推理提供标准化的输入图像。
"""

import base64
import io

import cv2
import numpy as np
from PIL import Image


def decode_base64_image(base64_str: str) -> np.ndarray:
    """
    将Base64编码的图像字符串解码为OpenCV格式的BGR图像数组

    Args:
        base64_str: Base64编码的图像字符串，可包含data:image前缀

    Returns:
        np.ndarray: OpenCV格式的BGR图像数组，形状为(H, W, 3)

    Raises:
        ValueError: 当Base64字符串为空或解码失败时抛出
        RuntimeError: 当图像解码后无法转换为有效数组时抛出

    Notes:
        - 自动移除data:image/xxx;base64,前缀
        - 输出图像始终为3通道BGR格式
    """
    if not base64_str:
        raise ValueError("Base64图像数据为空")

    # 移除可能存在的data URI前缀
    if "," in base64_str:
        base64_str = base64_str.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(base64_str)
    except Exception as e:
        raise ValueError(f"Base64解码失败: {e}")

    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        raise RuntimeError(f"图像解码失败: {e}")

    if img is None:
        raise ValueError("解码后的图像数据无效，无法生成有效图像")

    return img


def preprocess_image(image: np.ndarray, target_size: int = 640) -> np.ndarray:
    """
    对输入图像进行预处理，调整尺寸以适配YOLOv11模型输入要求

    Args:
        image: OpenCV格式的BGR图像数组，形状为(H, W, 3)
        target_size: 目标输入尺寸（正方形边长），默认640

    Returns:
        np.ndarray: 预处理后的图像数组，保持原始色彩空间

    Notes:
        - YOLOv11内部会自动进行letterbox缩放和归一化
        - 此函数主要确保图像格式正确，实际缩放由Ultralytics框架处理
        - 输入图像会被转换为RGB格式供Ultralytics使用
    """
    if image is None or image.size == 0:
        raise ValueError("输入图像为空")

    # 确保图像为3通道
    if len(image.shape) == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    elif image.shape[2] == 4:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)

    # 转换为RGB格式供Ultralytics使用
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    return image_rgb


def validate_image(image: np.ndarray) -> bool:
    """
    验证图像数据是否有效，可用于推理

    Args:
        image: 待验证的图像数组

    Returns:
        bool: 图像有效返回True，否则返回False

    Notes:
        - 检查图像是否为None、是否为空数组、通道数是否正确
    """
    if image is None:
        return False
    if not isinstance(image, np.ndarray):
        return False
    if image.size == 0:
        return False
    if len(image.shape) not in [2, 3]:
        return False
    if len(image.shape) == 3 and image.shape[2] not in [1, 3, 4]:
        return False
    return True


def decode_binary_image(binary_data: bytes) -> np.ndarray:
    """
    将二进制JPEG/PNG图像数据直接解码为OpenCV格式的BGR图像数组

    专为WebSocket二进制帧传输设计，跳过Base64编解码步骤，
    减少约33%的数据膨胀和CPU开销。

    Args:
        binary_data: 原始图像字节流（JPEG/PNG等格式）

    Returns:
        np.ndarray: OpenCV格式的BGR图像数组，形状为(H, W, 3)

    Raises:
        ValueError: 当输入数据为空或解码失败时抛出

    Notes:
        - 与decode_base64_image功能一致，但省去Base64中间步骤
        - 前端通过canvas.toBlob()获取的二进制数据可直接传入
        - 支持OpenCV能解码的所有图像格式（JPEG/PNG/BMP/WebP等）
    """
    if not binary_data or len(binary_data) == 0:
        raise ValueError("二进制图像数据为空")

    try:
        nparr = np.frombuffer(binary_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        raise RuntimeError(f"二进制图像解码失败: {e}")

    if img is None:
        raise ValueError("二进制数据无法解码为有效图像，请检查格式是否为JPEG/PNG")

    return img
