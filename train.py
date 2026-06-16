"""
YOLO 人脸检测模型训练脚本

提供完整的训练流程，包括数据集准备、模型训练、验证评估和导出部署。
支持从预训练模型开始训练（迁移学习）或从头训练。

使用方式:
    # 基础训练（使用YOLOv8n预训练模型）
    python train.py

    # 指定训练轮数和批次大小
    python train.py --epochs 100 --batch 16

    # 使用YOLOv11模型
    python train.py --model yolo11n.pt --epochs 150

    # 使用GPU训练
    python train.py --device 0
"""

import argparse
import sys
from pathlib import Path


def parse_args():
    """
    解析命令行参数

    Returns:
        argparse.Namespace: 解析后的参数对象
    """
    parser = argparse.ArgumentParser(
        description="YOLO 人脸检测模型训练脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python train.py                          # 默认参数训练
  python train.py --epochs 100 --batch 16   # 自定义训练参数
  python train.py --model yolo11n.pt        # 使用YOLOv11
  python train.py --device 0                # 指定GPU训练
        """
    )

    # ---------- 模型相关 ----------
    parser.add_argument(
        "--model", type=str, default="yolo11m.pt",
        help="基础模型权重 (默认: yolo11m.pt)，可选: yolov8n.pt, yolov8s.pt, yolov8m.pt, yolov8l.pt, "
             "yolo11n.pt, yolo11s.pt, yolo11l.pt 等，或自定义 .pt 文件路径"
    )
    parser.add_argument(
        "--data", type=str, default="data.yaml",
        help="数据集配置文件路径 (默认: data.yaml)"
    )

    # ---------- 训练超参数 ----------
    parser.add_argument(
        "--epochs", type=int, default=100,
        help="训练轮数 (默认: 100)"
    )
    parser.add_argument(
        "--batch", type=int, default=16,
        help="批次大小 (默认: 16)，显存不足时减小此值"
    )
    parser.add_argument(
        "--imgsz", type=int, default=640,
        help="输入图像尺寸 (默认: 640)"
    )
    parser.add_argument(
        "--patience", type=int, default=50,
        help="早停耐心值，连续多少轮无改善则停止 (默认: 50)"
    )

    # ---------- 设备与优化 ----------
    parser.add_argument(
        "--device", type=str, default="",
        help="训练设备 (默认: 自动检测)，例如: 'cpu', '0'(GPU0), '0,1'(多GPU)"
    )
    parser.add_argument(
        "--workers", type=int, default=4,
        help="数据加载线程数 (默认: 4)"
    )
    parser.add_argument(
        "--optimizer", type=str, default="auto",
        help="优化器 (默认: auto自动选择)，可选: SGD, Adam, AdamW"
    )
    parser.add_argument(
        "--lr0", type=float, default=0.01,
        help="初始学习率 (默认: 0.01)"
    )
    parser.add_argument(
        "--lrf", type=float, default=0.01,
        help="最终学习率因子 (默认: 0.01)，最终lr = lr0 * lrf"
    )

    # ---------- 数据增强 ----------
    parser.add_argument(
        "--hsv_h", type=float, default=0.015,
        help="色调增强幅度 (默认: 0.015)"
    )
    parser.add_argument(
        "--hsv_s", type=float, default=0.7,
        help="饱和度增强幅度 (默认: 0.7)"
    )
    parser.add_argument(
        "--hsv_v", type=float, default=0.4,
        help="亮度增强幅度 (默认: 0.4)"
    )
    parser.add_argument(
        "--degrees", type=float, default=0.0,
        help="旋转角度范围 (默认: 0.0)，人脸检测建议不旋转或小角度"
    )
    parser.add_argument(
        "--translate", type=float, default=0.1,
        help="平移比例 (默认: 0.1)"
    )
    parser.add_argument(
        "--scale", type=float, default=0.5,
        help="缩放比例范围 (默认: 0.5)"
    )
    parser.add_argument(
        "--mosaic", type=float, default=1.0,
        help="Mosaic增强概率 (默认: 1.0)，设为0关闭"
    )
    parser.add_argument(
        "--mixup", type=float, default=0.0,
        help="MixUp增强概率 (默认: 0.0)"
    )

    # ---------- 输出与保存 ----------
    parser.add_argument(
        "--project", type=str, default="runs/train",
        help="训练结果保存目录 (默认: runs/train)"
    )
    parser.add_argument(
        "--name", type=str, default="face_detect",
        help="实验名称 (默认: face_detect)"
    )
    parser.add_argument(
        "--exist-ok", action="store_true",
        help="允许覆盖已存在的实验目录"
    )
    parser.add_argument(
        "--pretrained", action="store_true", default=True,
        help="使用ImageNet预训练权重 (默认开启)"
    )
    parser.add_argument(
        "--no-pretrained", dest="pretrained", action="store_false",
        help="禁用预训练权重，从头开始训练"
    )

    return parser.parse_args()


def check_dataset(args):
    """
    检查数据集是否就绪

    Args:
        args: 命令行参数

    Raises:
        SystemExit: 当数据集未准备好时退出程序
    """
    data_path = Path(args.data)
    if not data_path.exists():
        print("=" * 60)
        print("[错误] 未找到数据集配置文件!")
        print(f"配置文件路径: {data_path.absolute()}")
        print("")
        print("请按以下步骤准备数据集:")
        print("  1. 将人脸图片放入 datasets/images/train/ 目录")
        print("  2. 将验证图片放入 datasets/images/val/ 目录")
        print("  3. 对应的标注文件放入 datasets/labels/train/ 和 labels/val/")
        print("  4. 标注格式为YOLO格式: class_id x_center y_center width height")
        print("       (坐标为归一化值 0~1)")
        print("")
        print("推荐标注工具:")
        print("  - LabelImg (pip install labelimg)")
        print("  - Roboflow (在线标注 + 自动格式转换)")
        print("  - CVAT (开源标注平台)")
        print("=" * 60)
        sys.exit(1)

    # 检查训练集目录是否有内容
    train_img_dir = Path("datasets/images/train")
    val_img_dir = Path("datasets/images/val")

    train_count = len(list(train_img_dir.glob("*"))) if train_img_dir.exists() else 0
    val_count = len(list(val_img_dir.glob("*"))) if val_img_dir.exists() else 0

    if train_count == 0:
        print("[警告] 训练集目录为空! 请添加训练图片到 datasets/images/train/")
    else:
        print(f"[信息] 训练集图片数量: {train_count}")

    if val_count == 0:
        print("[警告] 验证集目录为空! 请添加验证图片到 datasets/images/val/")
    else:
        print(f"[信息] 验证集图片数量: {val_count}")

    if train_count == 0 and val_count == 0:
        print("")
        print("提示: 可以使用以下方式获取人脸数据集:")
        print("  - WIDER FACE (公开人脸检测数据集)")
        print("  - FDDB (人脸检测基准数据集)")
        print("  - 自己收集图片并使用LabelImg标注")
        sys.exit(1)


def main():
    """
    主函数：执行YOLO模型训练流程

    流程:
        1. 解析命令行参数
        2. 检查数据集是否就绪
        3. 加载模型
        4. 开始训练
        5. 输出训练结果信息
    """
    args = parse_args()

    print("=" * 60)
    print("YOLO 人脸检测模型训练")
    print("=" * 60)
    print(f"  基础模型: {args.model}")
    print(f"  训练轮数: {args.epochs}")
    print(f"  批次大小: {args.batch}")
    print(f"  图像尺寸: {args.imgsz}")
    print(f"  学习率: {args.lr0} -> {args.lr0 * args.lrf}")
    print(f"  设备: {args.device if args.device else '自动检测'}")
    print("=" * 60)

    # 检查数据集
    check_dataset(args)

    try:
        from ultralytics import YOLO
    except ImportError:
        print("[错误] 未安装 ultralytics 库!")
        print("请运行: pip install ultralytics")
        sys.exit(1)

    # 加载模型
    print(f"\n[加载模型] {args.model} ...")
    model = YOLO(args.model)

    # 开始训练
    print("\n[开始训练]")
    results = model.train(
        data=args.data,
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        patience=args.patience,
        device=args.device or None,
        workers=args.workers,
        optimizer=args.optimizer,
        lr0=args.lr0,
        lrf=args.lrf,
        # 数据增强参数
        hsv_h=args.hsv_h,
        hsv_s=args.hsv_s,
        hsv_v=args.hsv_v,
        degrees=args.degrees,
        translate=args.translate,
        scale=args.scale,
        mosaic=args.mosaic,
        mixup=args.mixup,
        # 输出设置
        project=args.project,
        name=args.name,
        exist_ok=args.exist_ok,
        pretrained=args.pretrained,
        verbose=True,
    )

    # 训练完成
    print("\n" + "=" * 60)
    print("[训练完成!]")
    print("=" * 60)

    # 获取最佳模型路径
    best_model_path = Path(args.project) / args.name / "weights" / "best.pt"
    last_model_path = Path(args.project) / args.name / "weights" / "last.pt"

    print(f"\n最佳模型: {best_model_path.absolute()}")
    print(f"最新模型: {last_model_path.absolute()}")
    print(f"\n训练结果保存在: {Path(args.project) / args.name}")

    print("""
使用训练好的模型:

  方法1 - 复制到项目model目录:
    copy {best} model\\yolov8n-face.pt
    然后启动服务: python main.py

  方法2 - 直接指定模型路径:
    修改 core/detector.py 中的模型路径
    或在 FaceDetector 初始化时传入 model_path 参数

  方法3 - 验证模型效果:
    yolo detect predict model={best} source=test_image.jpg
""".format(best=best_model_path))


if __name__ == "__main__":
    main()
