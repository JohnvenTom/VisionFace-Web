"""
检测结果后处理与可视化模块

负责解析YOLOv11模型输出结果、在图像上绘制人脸检测框与置信度标注，
以及生成前端所需的标准化JSON响应数据。
"""

import cv2
import numpy as np


def parse_results(detection_result: dict) -> dict:
    """
    解析检测结果，生成前端展示所需的标准JSON响应格式

    Args:
        detection_result: FaceDetector.detect()返回的原始检测结果字典

    Returns:
        dict: 标准化的API响应数据，包含以下字段：
            - faces (list): 人脸信息列表，每项包含bbox和confidence
            - count (int): 人脸总数
            - inference_time (float): 推理耗时（毫秒）
            - image_shape (list): 图像尺寸[H, W]

    Notes:
        - 此方法当前为透传，预留后续格式转换、数据增强等扩展
    """
    return {
        "faces": detection_result.get("faces", []),
        "count": detection_result.get("count", 0),
        "inference_time": detection_result.get("inference_time", 0),
        "image_shape": detection_result.get("image_shape", [0, 0])
    }


def draw_detections(
    image: np.ndarray,
    faces: list,
    color: tuple = (0, 255, 0),
    thickness: int = 2,
    font_scale: float = 0.6,
    show_confidence: bool = True
) -> np.ndarray:
    """
    在图像上绘制人脸检测框与置信度标注

    Args:
        image: 原始图像，OpenCV格式的BGR数组
        faces: 人脸信息列表，每项包含bbox([x1,y1,x2,y2])和confidence
        color: 检测框颜色，BGR格式，默认绿色(0,255,0)
        thickness: 检测框线宽，默认2
        font_scale: 置信度文字大小，默认0.6
        show_confidence: 是否显示置信度文字，默认True

    Returns:
        np.ndarray: 绘制了检测标注的图像副本

    Notes:
        - 不会修改原始图像，返回绘制后的副本
        - 置信度文字背景添加半透明底色以提高可读性
        - 当人脸列表为空时返回原图副本
    """
    annotated = image.copy()

    for face in faces:
        bbox = face.get("bbox", [])
        confidence = face.get("confidence", 0)

        if len(bbox) != 4:
            continue

        x1, y1, x2, y2 = [int(coord) for coord in bbox]

        # 绘制检测框
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, thickness)

        # 绘制置信度文字
        if show_confidence:
            label = f"{confidence:.2f}"
            font = cv2.FONT_HERSHEY_SIMPLEX
            (text_w, text_h), baseline = cv2.getTextSize(
                label, font, font_scale, 1
            )

            # 文字背景
            cv2.rectangle(
                annotated,
                (x1, y1 - text_h - baseline - 6),
                (x1 + text_w, y1),
                color,
                -1
            )

            # 文字
            cv2.putText(
                annotated,
                label,
                (x1, y1 - baseline - 3),
                font,
                font_scale,
                (0, 0, 0),
                1,
                cv2.LINE_AA
            )

    return annotated


def encode_image_to_base64(image: np.ndarray, format: str = ".jpg") -> str:
    """
    将OpenCV图像编码为Base64字符串，用于前端展示

    Args:
        image: OpenCV格式的BGR图像数组
        format: 编码格式，支持'.jpg'、'.png'，默认'.jpg'

    Returns:
        str: Base64编码的图像字符串，包含data URI前缀

    Raises:
        ValueError: 当图像为空或编码失败时抛出

    Notes:
        - 返回的字符串可直接用于HTML img标签的src属性
        - JPEG格式体积更小适合网络传输，PNG格式无损适合精确展示
    """
    if image is None or image.size == 0:
        raise ValueError("输入图像为空")

    success, buffer = cv2.imencode(format, image)
    if not success:
        raise ValueError("图像编码失败")

    import base64
    encoded = base64.b64encode(buffer).decode("utf-8")

    mime_type = "image/jpeg" if format == ".jpg" else "image/png"
    return f"data:{mime_type};base64,{encoded}"
