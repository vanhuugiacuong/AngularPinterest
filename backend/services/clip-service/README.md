---
title: PinHub CLIP And Moderation Service
emoji: 🖼️
colorFrom: purple
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
---

Backend microservice for PinHub: CLIP image/text embeddings (`/embed/image`, `/embed/text`) and NSFW image moderation (`/moderate/image`), used by the NestJS backend.

## Chạy trên máy dev (Windows)

```
setup.bat     REM chỉ lần đầu — tạo .venv và cài torch/transformers
run.bat       REM khởi động ở cổng 8001
```

Backend đọc địa chỉ từ `CLIP_SERVICE_URL` trong `backend/.env` (mặc định
`http://localhost:8001`).

### Bắt buộc Python 3.12

`torch==2.2.1` **không có gói cho Python 3.13/3.14**. Máy nào cài sẵn 3.14 mà
gọi `py -m venv` sẽ tạo môi trường 3.14, rồi `pip install` chết giữa chừng với
thông báo rất khó lần ra nguyên nhân. `setup.bat` vì vậy tự tìm 3.12 và báo lỗi
rõ ràng nếu không thấy, thay vì cứ thế chạy tiếp.

### Chỗ chứa dữ liệu nặng

`.venv` (~2 GB) và `.hf-cache` (~600 MB, trọng số model) đều nằm **ngay trong
thư mục này**, không rơi vào `C:\Users\...\.cache`. Nhiều máy dev gần hết chỗ ổ
C: nhưng còn nhiều ở ổ chứa repo. Cả hai đã có trong `.gitignore`.

## Không chạy dịch vụ này thì mất gì

| Chức năng | Không có CLIP |
|---|---|
| Tìm theo vùng ảnh (khoanh vùng trong ghim) | **Chết hẳn** — báo lỗi 400 |
| Tìm bằng ảnh tải lên | **Chết hẳn** |
| Kiểm duyệt ảnh khi đăng | Bỏ qua |
| Tìm bằng chữ | Vẫn chạy — khớp chữ là nguồn chính, CLIP chỉ bù thêm |

Ghim đăng trong lúc dịch vụ không chạy sẽ **không có vector**, và ghim không có
vector thì vô hình với hai chức năng đầu bảng. Bật lại dịch vụ rồi bù bằng:

```
node scratch/backfill-clip.cjs            # chạy thử, không ghi gì
node scratch/backfill-clip.cjs --apply    # chạy thật
```
