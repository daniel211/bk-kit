# Quy tắc đánh mã (bk-write-srs)

| Loại | Định dạng | Ghi chú |
|---|---|---|
| Chức năng | `FN-[nhóm]-NNN` | Nhóm = nhóm chức năng nghiệp vụ viết tắt không dấu, 3–5 ký tự (VD: AUTH, CARD, TAXI — theo JP-style); tính năng nhỏ thường dùng một nhóm chung. Mã đã cấp không tái sử dụng, kể cả khi chức năng bị hủy |
| Màn hình | `SCR-NNN` | Mọi màn hình ở §5.1 phải xuất hiện trong sơ đồ §3 |
| Cạnh chuyển màn hình | `JR-NN` | Chỉ định nghĩa tại bảng Journey Rules §3 |
| API | `API-[nhóm]-NN` | Cùng [nhóm] với FN — tránh trùng mã giữa các tài liệu trong `bk/dev/` |
| Luồng chung | `CF-xxx` | Chỉ gọi, không đặc tả lại nội dung đã ủy thác |
| Quy tắc nghiệp vụ | `BR-[nhóm]-NNN` | Cùng [nhóm] với FN. Định nghĩa **một** lần ở chức năng đầu tiên dùng nó, nơi khác tham chiếu mã |
| Nhánh hợp lệ | `AF-x` | Chỉ xuất hiện trong bảng ngoại lệ §4.2 |
| Message | `MSG-[nhóm]-NNN` | Mã kịch bản duy nhất để tham chiếu toàn tài liệu. 001–099 = kịch bản lỗi (098/099 = fallback); từ 101 = thông báo không gắn lỗi. KHÔNG encode loại E/W/C/I vào mã (chi tiết xem writing-rules.md, mục §5.5) |
| Danh mục giá trị | `CD-NN` | Enum trên màn hình: §5.4 |
| Vấn đề tồn đọng | `ISS-NNN` | Không tái sử dụng mã. Tham chiếu trong thân tài liệu gắn ⚠️ trước mã (chi tiết xem writing-rules.md, mục Quy ước chung) |
