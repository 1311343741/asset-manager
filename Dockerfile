# 通用容器化部署（Railway / Fly.io / Render Docker / 任意云服务器均可）
# 只依赖 Python 标准库，镜像很小
FROM python:3.11-slim

WORKDIR /app
COPY static/ static/
COPY server.py .

ENV BIND=0.0.0.0
ENV PORT=8765
ENV PYTHONUNBUFFERED=1

EXPOSE 8765

# 平台会通过 PORT 环境变量指定端口；未指定时用 8765
CMD ["python", "-u", "server.py"]
