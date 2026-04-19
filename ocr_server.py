from fastapi import FastAPI, Form,HTTPException
from pydantic import BaseModel
import cv2
import re
import os
import numpy as np
import logging
import json
from paddleocr import PaddleOCR

# 屏蔽无用日志
logging.getLogger("ppocr").setLevel(logging.ERROR)

app = FastAPI(title="Stock OCR API")

# --- 全局初始化 OCR ---
# 放在外面确保模型只加载一次，常驻内存，提升响应速度
ocr = PaddleOCR(lang='ch', device='cpu', use_angle_cls=True)

# 定义请求参数模型
class OCRRequest(BaseModel):
    image_path: str

# --- 原有的解析逻辑保持不变，但封装成内部函数 ---

def group_by_line(result):
    all_elements = []
    for block in result:
        if 'rec_texts' not in block: continue
        texts = block['rec_texts']
        boxes = block['rec_boxes']
        for text, box in zip(texts, boxes):
            box = np.array(box).reshape(-1, 2)
            y = box[:, 1].mean()
            x = box[:, 0].mean()
            all_elements.append({'y': y, 'x': x, 'text': text})

    if not all_elements: return []
    all_elements.sort(key=lambda e: e['y'])

    grouped = []
    current_line = [all_elements[0]]
    last_y = all_elements[0]['y']

    for i in range(1, len(all_elements)):
        e = all_elements[i]
        if abs(e['y'] - last_y) < 15:
            current_line.append(e)
        else:
            current_line.sort(key=lambda e: e['x'])
            grouped.append([item['text'] for item in current_line])
            current_line = [e]
        last_y = e['y']

    if current_line:
        current_line.sort(key=lambda e: e['x'])
        grouped.append([item['text'] for item in current_line])
    return grouped

def parse_funds(lines):
    funds = []
    current_fund_name = ""
    for line in lines:
        line_str_for_check = "".join(line).replace(" ", "")
        if re.search(r'[\u4e00-\u9fa5]', line_str_for_check):
            exclude = ['收益', '排序', '资产', '全部', '占比', '金额', 'A股']
            if not any(k in line_str_for_check for k in exclude):
                current_fund_name = line_str_for_check
            continue

        joined_line = " ".join(line)
        joined_line = re.sub(r"(?<=\d)([-+])", r" \1", joined_line)
        nums_raw = re.findall(r"[-+]?\d[\d,]*\.?\d*", joined_line)
        nums = []
        for n in nums_raw:
            try:
                clean_n = n.replace(",", "")
                if clean_n.count('.') > 1:
                    parts = clean_n.split('.')
                    clean_n = "".join(parts[:-1]) + "." + parts[-1]
                nums.append(float(clean_n))
            except: continue

        if len(nums) >= 3 and current_fund_name:
            funds.append({
                "name": current_fund_name,
                "amount": nums[0],
                "total": nums[2]
            })
            current_fund_name = ""
    return funds

# --- API 路由定义 ---

@app.post("/predict")
async def predict(image_path: str = Form(...)):
    # 直接使用 image_path 变量，不再需要 request.image_path
    print(f"📥 收到识别请求，路径为: {image_path}")

    # 1. 检查文件路径
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail=f"找不到文件: {image_path}")
    # 1. 读取图片
    img = cv2.imread(image_path)
    if img is None:
        raise HTTPException(status_code=400, detail="图片解码失败")

    # 2. 执行 OCR
    try:
        result = ocr.predict(img)
        # 3. 解析逻辑
        lines = group_by_line(result)
        funds_data = parse_funds(lines)
        
        return {
            "success": True,
            "data": funds_data,
            "raw_lines": lines  # 也可以返回原始行方便调试
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"识别过程出错: {str(e)}")

@app.get("/health")
async def health():
    return {"status": "ok2"}

if __name__ == "__main__":
    import uvicorn
    # 启动服务，端口 8000
    uvicorn.run(app, host="0.0.0.0", port=8002)