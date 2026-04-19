import cv2
import re
import os
import sys
import numpy as np
import logging
from paddleocr import PaddleOCR

# 屏蔽日志
logging.getLogger("ppocr").setLevel(logging.ERROR)

# =========================
# 初始化 OCR
# =========================
ocr = PaddleOCR(lang='ch', device='cpu')

def run_ocr(image_path):
    img = cv2.imread(image_path)
    if img is None: return {"success": False, "error": "图片读取失败"}
    result = ocr.predict(img)
    return {"success": True, "result": result}

# =========================
# 关键修复：增加行内 X 坐标排序
# =========================
def group_by_line(result):
    all_elements = []
    for block in result:
        if 'rec_texts' not in block: continue
        texts = block['rec_texts']
        boxes = block['rec_boxes']

        for text, box in zip(texts, boxes):
            box = np.array(box).reshape(-1, 2)
            y = box[:, 1].mean()
            x = box[:, 0].mean() # 增加 X 坐标
            all_elements.append({'y': y, 'x': x, 'text': text})

    # 1. 先按 Y 坐标全局排序
    all_elements.sort(key=lambda e: e['y'])

    grouped = []
    if not all_elements: return grouped

    current_line = [all_elements[0]]
    last_y = all_elements[0]['y']

    for i in range(1, len(all_elements)):
        e = all_elements[i]
        if abs(e['y'] - last_y) < 15: # 缩小阈值，防止把占比和金额混在一行
            current_line.append(e)
        else:
            # 2. 🔥 重要：在每一行内部，按 X 轴坐标从左到右排序
            current_line.sort(key=lambda e: e['x'])
            grouped.append([item['text'] for item in current_line])
            current_line = [e]
        last_y = e['y']

    if current_line:
        current_line.sort(key=lambda e: e['x'])
        grouped.append([item['text'] for item in current_line])

    return grouped

# =========================
# 解析逻辑优化
# =========================
def parse_funds(lines):
    funds = []
    current_fund_name = ""

    for line in lines:
        # 清洗文本
        line_str_for_check = "".join(line).replace(" ", "")
        
        # 1. 识别基金名 (排除干扰项)
        if re.search(r'[\u4e00-\u9fa5]', line_str_for_check):
            exclude = ['收益', '排序', '资产', '全部', '占比', '金额']
            if not any(k in line_str_for_check for k in exclude):
                current_fund_name = line_str_for_check
            continue

        # 2. 识别数据行
        # 我们用空格拼接，保持 X 轴排序后的间距
        joined_line = " ".join(line)
        # 修复数字粘连（-903.75-17694 -> -903.75 -17694）
        joined_line = re.sub(r"(?<=\d)([-+])", r" \1", joined_line)
        
        nums_raw = re.findall(r"[-+]?\d[\d,]*\.?\d*", joined_line)
        nums = []
        for n in nums_raw:
            try:
                # 处理常见的 OCR 逗号/点号误读
                clean_n = n.replace(",", "")
                # 针对 10.266.20 这种格式（实际上是 10,266.20）
                if clean_n.count('.') > 1:
                    parts = clean_n.split('.')
                    clean_n = "".join(parts[:-1]) + "." + parts[-1]
                nums.append(float(clean_n))
            except: continue

        # 3. 匹配 (现在顺序是准的：[资产, 日收益, 持有收益, 累计收益])
        if len(nums) >= 3 and current_fund_name:
            # 经过 X 轴排序后：
            # nums[0] 应该是 资产
            # nums[2] 应该是 持有收益
            funds.append({
                "name": current_fund_name,
                "amount": nums[0],
                "total": nums[2]
            })
            current_fund_name = "" # 配对成功，重置

    return funds

if __name__ == "__main__":
    if len(sys.argv) > 1:
        img_path = sys.argv[1]
    else:
        BASE_DIR = os.path.dirname(__file__)
        img_path = os.path.join(BASE_DIR, "test.png")

    print(f"📸 正在处理图片: {img_path}")
    res = run_ocr(img_path)
    if res["success"]:
        lines = group_by_line(res["result"])
        # 打印调试，看看顺序对不对
        print("--- 排序后的行内容 ---")
        for l in lines: print(l)
        
        parsed = parse_funds(lines)
        print("\n📊 最终提取结果：")
        for item in parsed:
            print(f"[{item['name']}] 资产: {item['amount']} | 持有收益: {item['total']}")

