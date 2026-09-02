# Checklist chất lượng trước khi giao

Chạy toàn bộ trước khi giao (Bước 5) và khi Mode Review — báo cáo từng điểm đạt/không đạt.

## Cấu trúc & tham chiếu chéo

- [ ] Đủ mục §0–§8 theo template; không thêm/bớt mục, cột; không ô nào bỏ trống.
- [ ] Các ghi chú người đọc có sẵn trong template (Quy tắc chung §0, chú giải cột "Nguồn" và "Thứ tự kiểm tra đầu vào chung" §5.3, chú giải cột "Lớp" §5.5, câu lưu ý đầu §8) giữ nguyên văn; mọi ghi chú/lưu ý người đọc khác viết dạng đoạn văn thường mở đầu bằng nhãn dẫn in đậm (không có nhãn tự nhiên dùng **Lưu ý:**) — không dùng tiền tố `>`, không bôi đậm toàn đoạn.
- [ ] MỤC LỤC đứng sau §0, đủ 8 link anchor tới §1–§8 (chép nguyên từ template).
- [ ] Mọi SCR ở §5.1 có mặt trong sơ đồ §3; mọi cạnh trong sơ đồ có dòng Journey Rules.
- [ ] Mọi FN ở §4.1 có mục chi tiết ở §4.2; mọi API ở §4.2 có dòng ở §6.1.
- [ ] Mọi mã message kịch bản lỗi xuất hiện ở §4.2 có dòng tại §5.5; mọi BR được tham chiếu đều tồn tại.
- [ ] Mọi "Chưa chốt" và ⚠️ trong tài liệu có một dòng ISS ở §8; cột "Ngày phát sinh" ghi ngày hiện tại định dạng DD/MM/YYYY.
- [ ] Mọi tham chiếu mã ISS trong thân tài liệu (ngoài cột "Mã" của bảng §8) có ⚠️ đứng ngay trước mã; giá trị/điểm chưa chốt viết dạng gạch ngang `Chưa chốt — ⚠️ ISS-NNN` — không dùng dạng ngoặc `Chưa chốt (⚠️ ISS-NNN)` (gây ngoặc lồng) và không để mã trần sau dấu hai chấm.
- [ ] Mọi hạng mục hiển thị được nhắc tại BR hoặc §5.5 có dòng tương ứng trong bảng §5.3 của màn hình liên quan (không có hạng mục được nhắc ở nhiều nơi nhưng không nơi nào đặc tả); §6 không có mục "Dữ liệu hiển thị từ API".
- [ ] Cột "Nguồn (URD)" tại §4.1 điền đủ cho mọi FN — map về mục/bước URD nguồn.

## Nội dung

- [ ] Không có câu nào mô tả xử lý nội bộ phía server.
- [ ] Mỗi FN có đủ: bảng khái quát, luồng chính, luồng thay thế/ngoại lệ, BR (hoặc "Không định nghĩa rule riêng"), tiêu chí chấp nhận EARS.
- [ ] Ngoại lệ bao phủ: validate cục bộ (L), lỗi nghiệp vụ server (S), timeout (T) cho TỪNG API — kể cả API truy vấn (timeout API truy vấn: ở lại màn, giữ dữ liệu, cho thao tác lại — khác API giao dịch); §7.4 có tình huống mất mạng/timeout sau khi gọi cho cả API truy vấn lẫn API giao dịch.
- [ ] Cột "Xử lý" các dòng kịch bản lỗi ở §4.2 chỉ ghi lớp lỗi và tham chiếu §5.5, không chép hành vi sau đóng popup; §5.5 không viết chắc chắn hơn những gì đã chốt (API nào xử lý, phân lớp L/S chưa chốt → gắn ⚠️ ISS ngay trong dòng).
- [ ] Cột "Trạng thái" §4.1 khớp với §8: FN còn ISS mức Cao không được ghi "Xác định".
- [ ] API giao dịch có BR cấm retry và message lớp T "đang xử lý".
- [ ] §6.1 đủ 5 cột chuẩn; cột "Chức năng sử dụng" khớp hai chiều với cột "API liên quan" §4.1; MID/Endpoint chưa chốt gắn ⚠️ kèm mã ISS.
- [ ] §5.5 có kịch bản fallback 098 (API thường) / 099 (API giao dịch — xử lý như chưa rõ kết quả) với điều kiện kích hoạt ghi thành chú thích nghiêng trong ô Nội dung, bao cả lỗi kỹ thuật không có response nghiệp vụ hợp lệ (HTTP 4xx/5xx, response không đọc được, đứt kết nối sau khi gửi); popup lỗi mặc định là một BR "Toàn luồng".
- [ ] Kịch bản lớp L không chép ngưỡng/giá trị từ BR — điều kiện ghi "Vi phạm BR-xxx — vế nào"; ngưỡng chỉ ghi ở đúng một dòng BR, message dùng {placeholder}.
- [ ] Giao dịch sau timeout có "lối ra": KH kiểm tra trạng thái ở đâu, vào lại luồng khi còn giao dịch treo thì API đầu luồng trả gì — chưa rõ thì mở ISS.
- [ ] Điểm xác thực (OTP/PIN) rõ ràng: verify thuộc luồng chung hay gửi kèm API giao dịch — vì "cho nhập lại" mâu thuẫn với "cấm gửi lại API giao dịch".
- [ ] Trường có giá trị phụ thuộc lựa chọn khác (đổi dropdown cha): định nghĩa rõ ghi đè về mặc định hay giữ input của KH và re-validate.
- [ ] BR "giữ dữ liệu trường chung" khi chuyển biến thể: có danh sách trường tường minh hoặc quy tắc loại trừ.
- [ ] Rule format tiền tệ/số chốt ký tự phân tách nghìn (URD hay dùng lẫn "." và ",").
- [ ] Nội dung message khớp hành vi sau đóng popup cùng dòng §5.5: message gợi ý "sửa tại chỗ" thì không được điều hướng về đầu luồng xóa form — lỗi KH sửa được và lỗi hệ thống phải tách nhóm hành vi.
- [ ] Mọi dialog xác nhận, toast, hướng dẫn quyền xuất hiện trong §4–§5 đều có mã MSG tại §5.5 (kể cả loại C và I, kèm nhãn nút cho dialog).
- [ ] Message không chứa thuật ngữ kỹ thuật nội bộ (tên hệ thống core, thao tác kỹ thuật); giá trị động (hạn mức min/max, phí...) dùng placeholder {x} thay vì hardcode; xưng hô thống nhất một đại từ.
- [ ] §5.2 định nghĩa Back cho từng màn hình; màn kết quả chặn back.
- [ ] §5.3 đúng 9 cột (không có cột "Kiểu dữ liệu" riêng); mọi trường có cột Nguồn (trường `Tính` có công thức); ba cột cuối không ô nào để trống (dùng "—"); mọi control nhập liệu có "Giá trị mặc định" tường minh và "Kiểm tra đầu vào" ghi đủ ràng buộc kiểu ký tự nhận vào (VD "Chỉ nhận số") kèm định dạng/tham chiếu BR.
- [ ] §7.4 trả lời đủ các tình huống vòng đời.
- [ ] Lịch sử sửa đổi có dòng cho phiên bản này; heading "Lịch sử sửa đổi" để trần, không kèm ghi chú quy ước tăng phiên bản; trạng thái tài liệu đúng (Dự thảo khi còn ISS Cao).
