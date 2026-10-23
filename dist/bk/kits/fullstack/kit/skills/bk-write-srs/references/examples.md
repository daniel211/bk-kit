# Ví dụ chuẩn về mức chi tiết

Các ví dụ dưới đây thể hiện mức chi tiết và văn phong cần đạt ở những chỗ dễ viết sai nhất. Khi phân vân, đối chiếu với các ví dụ này.

## Journey Rule — điều kiện chỉ tham chiếu mã; cạnh suy luận ghi chú tường minh

| ID | Màn hiện tại | Điều kiện | Màn kế tiếp |
|---|---|---|---|
| JR-05 | SCR-003 | Nhấn "Tiếp tục"; validate cục bộ OK + API-CARD-03 thành công (FN-CARD-003) | SCR-005 |
| JR-04 | SCR-004 | Đổi "Hình thức phát hành" = Vật lý (AF-01 chiều ngược — URD không nêu tường minh, suy luận đối xứng) | SCR-003 |

## Bước luồng chính — chỉ trình tự + tham chiếu mã, đúng ranh giới app/server

| Bước | Chủ thể | Xử lý |
|---|---|---|
| 1 | KH | Nhập/chọn các thông tin (chi tiết control: SCR-003 §5.3) |
| 2 | App | Validate cục bộ theo BR-CARD-002, BR-CARD-003; gọi API-CARD-03, loading, chống double-tap (BR-CARD-010) |
| 3 | App | Thành công → chuyển SCR-005 (JR-05), mang theo dữ liệu form + phí gửi thẻ từ response |

## Ngoại lệ — mỗi trường hợp một dòng; lớp L tham chiếu BR không chép ngưỡng; trường hợp lặp viết "Như MSG-…"

| Mã | Điều kiện phát sinh | Xử lý |
|---|---|---|
| MSG-CARD-011 | Vi phạm BR-CARD-002 — dưới hạn mức tối thiểu | Lỗi validate cục bộ, lớp L (hành vi: §5.5) |
| MSG-CARD-012 | Vi phạm BR-CARD-002 — vượt hạn mức tối đa theo FD đang chọn | Như MSG-CARD-011 |

## Hàng §5.3 với 9 cột — mặc định/kiểm tra tách riêng, ràng buộc kiểu ký tự ghi đầu cột Kiểm tra đầu vào, nguồn chưa chốt gắn ⚠️ + ISS ngay trong ô

| No | Tên hạng mục | Control | Bắt buộc | Độ dài | Nguồn | Giá trị mặc định | Kiểm tra đầu vào | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| 4 | Hạn mức thẻ | Textbox (nhập) | ○ | 15 | Nhập | Theo API-CARD-02 trả về theo FD (kỳ vọng — ⚠️ ISS-002) | Chỉ nhận số; validate BR-CARD-002; format nghìn khi nhập (BR-CARD-004) | Bàn phím số; nhãn phụ (Hardcode): "Nhập số tròn triệu, từ [min] đến [max] VND" |

## Màn hình delta

`### SCR-004: Đăng ký phát hành thẻ (phi vật lý)` → "Giống **SCR-003** ngoại trừ:" + bảng liệt kê từng khác biệt (bỏ mục nào, mục nào đổi giá trị, nút thành công đi đâu).

## ISS từ mâu thuẫn URD — chọn tạm, nêu ảnh hưởng cụ thể tới app

| Mã | Nội dung vấn đề | Ảnh hưởng tới app | Mức độ |
|---|---|---|---|
| ISS-001 | URD mâu thuẫn hạn mức tối thiểu: nhãn màn hình ghi 1.000.000, validate ghi 5.000.000. SRS tạm lấy 5.000.000 | Hằng số validate MSG-CARD-011 và nhãn phụ trường Hạn mức | Cao |

## Văn phong message — lớp S nói lý do + hướng xử lý; lớp T tuyệt đối không nói "thất bại"

- Lớp S: "Giấy tờ tùy thân (CCCD/Căn cước) của quý khách đã hết hạn sử dụng. Vui lòng cập nhật thông tin tại quầy trước khi tiếp tục."
- Lớp T: "Giao dịch mở thẻ đang được xử lý do phản hồi chậm từ hệ thống. Quý khách vui lòng kiểm tra lại trạng thái thẻ sau ít phút hoặc liên hệ tổng đài để được hỗ trợ."
