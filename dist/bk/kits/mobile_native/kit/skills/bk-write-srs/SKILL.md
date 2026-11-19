---
name: bk-write-srs
user-invocable: true
argument-hint: "[đường dẫn tài liệu nguồn hoặc thư mục bk/dev/<id>/requirements] [id tính năng nếu muốn chỉ định]"
description: "Viết, cập nhật hoặc review SRS (đặc tả tính năng) mobile app từ URD. KHÔNG dùng cho URD/PRD, user story + AC, hay đặc tả API backend."
metadata:
  version: "3.0.6"
---

# bk-write-srs — Viết SRS tính năng Mobile App

Viết một tài liệu SRS hoàn chỉnh cho **một tính năng ở phía ứng dụng mobile**, đủ chi tiết để đội app code và QA viết test case mà không phải hỏi lại — mọi điểm chưa rõ đều được ghi thành ISS thay vì bỏ trống hoặc bịa.

## Tài nguyên của skill

| File | Vai trò | Khi nào đọc |
|---|---|---|
| `templates/srs-mobile-template.md` | Khung tài liệu bắt buộc tuân thủ. Bản SRS viết ra có cấu trúc đúng như template: đủ mục §0 → MỤC LỤC → §1–§8, đủ các cột trong bảng, các ghi chú người đọc giữ nguyên văn; không thêm/bớt mục, cột hay ghi chú | Trước khi viết (toàn bộ) |
| `references/writing-rules.md` | Quy tắc viết chi tiết theo từng mục §0–§8 (chỗ ghi từng loại thông tin, định dạng cột, văn phong) | Trước khi viết (toàn bộ) |
| `references/examples.md` | Ví dụ chuẩn về mức chi tiết và văn phong — đối chiếu khi phân vân | Khi viết §3–§5, §8 |
| `references/checklist.md` | Checklist chất lượng | Bước 5 và Mode Review |

## Vị trí output

Ghi SRS vào `bk/dev/<id>/srs/srs-mobile.md`; `<id>` = mã ticket Jira (`APP-1234`), mã GitHub issue
tiền tố `gh-` (`gh-4567`), hoặc tên tính năng kebab-case. `bk/dev/` chỉ chứa thư mục `<id>` làm con
trực tiếp — không tạo thư mục con theo tên người viết. Không có ticket/issue thì hỏi user tên tính
năng; chỉ tạo ticket/issue mới khi user yêu cầu tường minh.

```
bk/dev/<id>/
├── requirements/   # tài liệu nguồn: URD, PRD, SRS server, techspec, catalog mã lỗi...
└── srs/            # đầu ra: srs-mobile.md
```

## Workflow

### Bước 1: Xác định mode

- **Mode A — Viết mới**: có URD hoặc mô tả tính năng, chưa có SRS.
- **Mode B — Cập nhật**: đã có `bk/dev/<id>/srs/srs-mobile.md`. Đọc bản hiện tại, sửa đúng chỗ, **tăng phiên bản** (sửa lớn +1 số nguyên, sửa nhỏ +0.1) và thêm dòng vào Lịch sử sửa đổi — không xóa dòng cũ.
- **Mode C — Review**: chạy `references/checklist.md` trên SRS có sẵn, báo cáo từng điểm đạt/không đạt, không tự sửa trừ khi user yêu cầu.

Nếu user đưa nội dung rõ ràng thì tự suy luận mode và xác nhận lại một lần.

### Bước 2: Thu thập đầu vào

Bắt buộc trước khi viết — thiếu thì hỏi user, **không tự bịa**:

1. **`<id>`** cho thư mục output (ticket / issue / tên kebab-case).
2. **Tài liệu nguồn**: đường dẫn URD (hoặc mô tả tính năng), thường tại `bk/dev/<id>/requirements/`. Đọc **toàn bộ** trước khi viết; nếu thư mục có thêm PRD / SRS server / techspec thì đọc để lấy MID, mã lỗi, ràng buộc — và đối chiếu mâu thuẫn giữa các tài liệu (thành ISS).
3. **Mã tính năng** `F-xxx` và **tên app / mã dự án** (cho mã tài liệu `[PRJ]-SRS-[YYYY]-[Fxxx]`).

Nên hỏi thêm — nếu chưa có thì ghi "Chưa chốt" và mở ISS, không vì thế mà dừng viết:

4. Link Figma / thiết kế UI.
5. Tài liệu đặc tả API, tài liệu các luồng chung (OTP, đăng nhập lại...).

### Bước 3: Phân rã URD trước khi viết

Lập danh mục nháp (scratchpad, không đưa vào SRS): **màn hình** → `SCR-NNN` theo thứ tự xuất hiện
(màn biến thể là SCR riêng, viết delta ở §5.3); **chức năng** → chọn [nhóm] nghiệp vụ rồi cấp
`FN-[nhóm]-NNN`, mỗi bước luồng chính của URD gom về một FN (xử lý không có màn hình riêng vẫn là
một FN, màn hình ghi "(xử lý nền)"); **API** → mỗi lần app gọi server là một `API-[nhóm]-NN`;
**mâu thuẫn / khoảng trống** → ghi lại để thành ISS.

### Bước 4: Viết theo template, đúng thứ tự mục

Đọc toàn bộ `templates/srs-mobile-template.md` và `references/writing-rules.md`, rồi viết lần lượt §0 → §8. Thứ tự viết hiệu quả: §1 Tổng quan → §4.1 danh sách FN → §5.1 danh sách SCR → §3 Luồng tổng thể → §4.2 chi tiết FN → §5.2–5.4 → §5.5 (viết sau khi chốt ngoại lệ §4.2) → §6 → §7 → §2 → §8.

### Bước 5: Tự kiểm tra rồi mới giao

Chạy `references/checklist.md`. Sau khi ghi file, báo cho user: đường dẫn file, số lượng FN/SCR/API/MSG, và **danh sách ISS mức Cao** (những điểm chặn code, cần nghiệp vụ chốt sớm).

## Quy tắc bắt buộc (chi tiết ở references)

- **Quy tắc đánh mã** — `FN-[nhóm]-NNN`, `SCR-NNN`, `JR-NN`, `API-[nhóm]-NN`, `CF-xxx`,
  `BR-[nhóm]-NNN`, `AF-x`, `MSG-[nhóm]-NNN`, `CD-NN`, `ISS-NNN`. Mã đã cấp KHÔNG tái sử dụng.
  Load: `references/id-rules.md`
- **Chống trùng lặp** — mỗi loại thông tin chỉ ghi ở đúng một chỗ; luồng §4.2 chỉ mô tả trình tự
  và tham chiếu bằng mã, không chép nội dung. Bảng "thông tin → nơi duy nhất":
  `references/core-rules.md`
- **Phạm vi chỉ phía app** — luồng chỉ có KH và App; **cấm** mô tả server xử lý nội bộ; app không
  tự tính giá trị nghiệp vụ khi chưa có công thức chốt bằng văn bản.
- **An toàn giao dịch** — API giao dịch KHÔNG tự retry khi timeout (message "đang xử lý", lớp T);
  mọi nút gọi API chống double-tap. Chi tiết: `references/core-rules.md`
- **Không bỏ trống ô nào** — không áp dụng ghi "Không áp dụng"; chưa chốt ghi `Chưa chốt — ⚠️ ISS-NNN`.
- **Mâu thuẫn / khoảng trống URD → ISS, không tự đoán** — mức Cao = chặn code hoặc sai nghiệp vụ
  nếu đoán sai. Quy trình xử lý 4 bước + quy tắc phân mức: `references/core-rules.md`
- **Anti-patterns** (những lỗi thường gặp, đọc trước khi viết §3–§5):
  `references/anti-patterns.md`
