# Quy tắc cốt lõi (bk-write-srs)

**Chống trùng lặp — mỗi loại thông tin chỉ ghi ở đúng một chỗ:**

| Thông tin | Nơi duy nhất |
|---|---|
| Cạnh chuyển màn hình và điều kiện chuyển | Journey Rules §3 |
| Chi tiết control, validate từng trường | §5.3 |
| Nội dung quy tắc nghiệp vụ | Bảng BR trong §4.2 |
| Ngưỡng/giá trị/format của rule | Bảng BR §4.2 — kịch bản chỉ ghi "Vi phạm BR-xxx — vế nào", message dùng {placeholder} |
| Điều kiện phát sinh chi tiết của lỗi | Bảng ngoại lệ §4.2 của FN |
| Nội dung message và hành vi sau khi đóng popup | §5.5 |
| Nguồn dữ liệu hiển thị của từng hạng mục | Cột "Nguồn" §5.3 |
| Ánh xạ FN → mục/bước URD | Cột "Nguồn (URD)" §4.1 |

Luồng trong §4.2 chỉ mô tả *trình tự* và tham chiếu bằng mã (SCR/API/BR/MSG) — không chép lại nội dung.

**Phạm vi chỉ phía app:**
- Luồng chỉ có hai chủ thể: **KH** (người dùng) và **App**. Bước gọi server viết đúng dạng "App gọi API-[nhóm]-NN, chờ kết quả" — **cấm** mô tả server xử lý nội bộ ra sao.
- Rule server kiểm tra không viết thành BR — chúng thể hiện qua kịch bản lỗi ở §5.5 (cột "Mã server"; catalog mã lỗi chi tiết thuộc tài liệu Đặc tả API).
- App không tự tính giá trị nghiệp vụ (hạn mức, phí, lãi...) trừ khi có công thức được chốt bằng văn bản; nguồn `Tính` ở §5.3 bắt buộc kèm công thức.

**An toàn giao dịch:**
- API thực hiện giao dịch (tạo/ghi/chuyển tiền) KHÔNG tự động retry khi timeout — hiển thị message "đang xử lý" (lớp T), tuyệt đối không hiển thị "thất bại" khi chưa xác định kết quả. Quy tắc này thể hiện bằng một BR riêng kèm kịch bản timeout lớp T ở §5.5, không ghi ở §6.1.
- Mọi nút gọi API chống double-tap (disable ngay sau lần nhấn đầu — đặt thành một BR áp dụng "Toàn luồng", cùng chỗ với BR "popup lỗi mặc định một nút Đóng").

**Không bỏ trống ô nào:** không áp dụng ghi "Không áp dụng"; chưa chốt ghi đúng dạng `Chưa chốt — ⚠️ ISS-NNN`. Định dạng ghi chú người đọc và cách tham chiếu ISS xem writing-rules.md, mục Quy ước chung.

## Xử lý mâu thuẫn và khoảng trống trong URD

Đây là phần giá trị nhất của SRS: mọi mâu thuẫn hay khoảng trống của URD phải được ghi nhận qua ISS, không tự đoán rồi điền cho xong.

1. **URD mâu thuẫn nội bộ** (hai chỗ ghi hai giá trị khác nhau): chọn tạm một phương án hợp lý để tài liệu code được, ghi rõ "SRS tạm lấy X" và mở **ISS mức Cao**.
2. **URD thiếu thông tin app cần** (công thức tính, hành vi Back, nguồn dữ liệu, danh sách enum...): đưa **đề xuất của đội app**, đánh dấu tường minh "(đề xuất — ⚠️ ISS-NNN)" tại chỗ dùng, mở ISS chờ nghiệp vụ chốt.
3. **Suy luận từ tính đối xứng** (VD chiều ngược của một thao tác chuyển đổi): được phép, nhưng phải ghi chú "URD không nêu tường minh, suy luận" tại Journey Rules / luồng.
4. Mỗi ISS ghi đủ: ngày phát sinh (DD/MM/YYYY), nội dung vấn đề, **ảnh hưởng tới app** (chặn code phần nào), mức độ Cao/Trung/Thấp. Mức Cao = chặn code hoặc sai nghiệp vụ nếu đoán sai.

Quy tắc mức độ ISS: chặn hằng số validate / công thức / luồng chính → **Cao**; ảnh hưởng layout, nguồn danh mục, tài liệu phụ thuộc chưa có → **Trung**; câu chữ, format → **Thấp**.
