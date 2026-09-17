# Anti-patterns — KHÔNG làm (bk-write-srs)

- ❌ Mô tả server xử lý nội bộ ("server kiểm tra CIC rồi tạo hợp đồng trên Core...") → ✅ "App gọi API-CARD-03, chờ kết quả"; điều kiện server thể hiện qua kịch bản lỗi §5.5.
- ❌ Chép nội dung message / BR / điều kiện chuyển màn vào luồng §4.2 → ✅ chỉ tham chiếu mã.
- ❌ Bỏ trống ô vì "chưa biết" → ✅ `Chưa chốt — ⚠️ ISS-NNN`, hoặc "Không áp dụng".
- ❌ Tự bịa giá trị nghiệp vụ (hạn mức tối thiểu, biểu phí, số lần thử OTP...) → ✅ `Chưa chốt — ⚠️ ISS-NNN`, hoặc ghi rõ "(đề xuất — ⚠️ ISS-NNN)".
- ❌ Viết điều kiện chuyển màn hình trên cạnh Mermaid → ✅ nhãn cạnh chỉ là JR-id, điều kiện ở bảng Journey Rules.
- ❌ Tiêu chí chấp nhận mơ hồ ("app xử lý mượt mà", "hiển thị hợp lý") → ✅ EARS đo lường được.
- ❌ Màn hình có trong §5.1 nhưng không có trong sơ đồ §3 (màn hình "mồ côi").
- ❌ Gộp hai màn hình biến thể thành một SCR "dùng chung" → ✅ hai SCR, màn biến thể viết delta.
- ❌ Gộp nhiều hạng mục hiển thị vào một dòng §5.3 kiểu "1–13" → ✅ mỗi hạng mục một dòng.
- ❌ SRS mô tả cả nghiệp vụ sau giao dịch (giao thẻ, giải tỏa TSBĐ...) → ✅ đưa vào §1.2 với phạm vi ×.
- ❌ Chép quy tắc viết của skill (quy ước đánh số, tuyên bố kiến trúc, ghi chú `>`) vào SRS → ✅ SRS chỉ giữ đúng các ghi chú người đọc có sẵn trong template.
