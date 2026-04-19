# 1. 基础镜像使用完整版，减少环境折腾
FROM python:3.9

# 2. 优化系统库安装：合并命令并清理缓存
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. 优化依赖安装（核心点）：
# 先拷贝依赖文件，单独安装。只要不增删库，这一层永远被缓存。
# 如果你没有 requirements.txt，可以手动写 pip install 命令
RUN pip install --upgrade pip -i https://pypi.tuna.tsinghua.edu.cn/simple && \
    pip install --no-cache-dir \
    paddlepaddle \
    paddleocr \
    opencv-python-headless \
    fastapi \
    uvicorn \
    python-multipart \
    -i https://pypi.tuna.tsinghua.edu.cn/simple

# 4. 优化模型下载：
# 在代码拷贝之前先下载模型，这样改代码不会重新下模型（模型几百MB，下一次很慢）
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(lang='ch')"

# 5. 最后才拷贝代码：
# 你的业务代码改动最频繁，放在最后，确保前面的层全部命中缓存
COPY . .

# 6. 端口映射
EXPOSE 8002

# 7. 启动
CMD ["python", "ocr_server.py"]