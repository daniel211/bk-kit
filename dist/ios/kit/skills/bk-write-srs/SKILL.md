---
name: bk-write-srs
argument-hint: "[đường dẫn tài liệu nguồn hoặc thư mục mk/dev/<id>/requirements] [id tính năng nếu muốn chỉ định]"
description: |
  Viết, cập nhật hoặc review SRS (đặc tả tính năng) cho mobile app, đầu vào
  thường là URD — dùng cả khi user chỉ đưa URD và nói "viết SRS cho cái này".
  KHÔNG dùng cho: viết URD/PRD, user story + AC riêng lẻ, đặc tả API backend.
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

Ghi SRS vào `mk/dev/<id>/srs/srs-mobile.md`, trong đó `<id>` là một trong:

- Mã ticket Jira (VD `mk/dev/APP-1234/srs/srs-mobile.md`)
- Mã GitHub issue, tiền tố `gh-` (VD `mk/dev/gh-4567/srs/srs-mobile.md`)
- Tên tính năng ngắn dạng kebab-case (VD `mk/dev/phat-hanh-the-tin-dung-cam-co/srs/srs-mobile.md`)

`mk/dev/` chỉ chứa các thư mục đặt tên theo `<id>` làm con trực tiếp — không tạo thư mục con theo tên người viết. Nếu user có ticket/issue thì dùng mã đó; nếu không, hỏi user tên tính năng để đặt thư mục. Chỉ tạo ticket/issue mới khi user yêu cầu tường minh.

```
mk/dev/<id>/
├── requirements/   # tài liệu nguồn: URD, PRD, SRS server, techspec, catalog mã lỗi...
└── srs/            # đầu ra: srs-mobile.md
```

## Workflow

### Bước 1: Xác định mode

- **Mode A — Viết mới**: có URD hoặc mô tả tính năng, chưa có SRS.
- **Mode B — Cập nhật**: đã có `mk/dev/<id>/srs/srs-mobile.md`. Đọc bản hiện tại, sửa đúng chỗ, **tăng phiên bản** (sửa lớn +1 số nguyên, sửa nhỏ +0.1) và thêm dòng vào Lịch sử sửa đổi — không xóa dòng cũ.
- **Mode C — Review**: chạy `references/checklist.md` trên SRS có sẵn, báo cáo từng điểm đạt/không đạt, không tự sửa trừ khi user yêu cầu.

Nếu user đưa nội dung rõ ràng thì tự suy luận mode và xác nhận lại một lần.

### Bước 2: Thu thập đầu vào

Bắt buộc trước khi viết — thiếu thì hỏi user, **không tự bịa**:

1. **`<id>`** cho thư mục output (ticket / issue / tên kebab-case).
2. **Tài liệu nguồn**: đường dẫn URD (hoặc mô tả tính năng), thường tại `mk/dev/<id>/requirements/`. Đọc **toàn bộ** trước khi viết; nếu thư mục có thêm PRD / SRS server / techspec thì đọc để lấy MID, mã lỗi, ràng buộc — và đối chiếu mâu thuẫn giữa các tài liệu (thành ISS).
3. **Mã tính năng** `F-xxx` và **tên app / mã dự án** (cho mã tài liệu `[PRJ]-SRS-[YYYY]-[Fxxx]`).

Nên hỏi thêm — nếu chưa có thì ghi "Chưa chốt" và mở ISS, không vì thế mà dừng viết:

4. Link Figma / thiết kế UI.
5. Tài liệu đặc tả API, tài liệu các luồng chung (OTP, đăng nhập lại...).

### Bước 3: Phân rã URD trước khi viết

Đọc URD và lập danh mục nháp (làm trong đầu hoặc scratchpad, không đưa vào SRS):

- **Màn hình** → cấp mã `SCR-001, 002...` theo thứ tự xuất hiện trong luồng; màn hình biến thể (vật lý/phi vật lý, thường/đặc biệt) là các SCR **riêng**, viết dạng delta ở §5.3.
- **Chức năng** → chọn [nhóm] nghiệp vụ (VD: CARD, TAXI) rồi cấp mã `FN-[nhóm]-001...`; mỗi bước luồng chính của URD gom về một FN; xử lý không có màn hình riêng (kiểm tra điều kiện truy cập, submit nền) vẫn là một FN với màn hình ghi "(xử lý nền)".
- **API** → mỗi lần app gọi server là một `API-[nhóm]-NN`.
- **Mâu thuẫn / khoảng trống trong URD** → ghi lại để thành ISS (xem quy tắc bên dưới).

### Bước 4: Viết theo template, đúng thứ tự mục

Đọc toàn bộ `templates/srs-mobile-template.md` và `references/writing-rules.md`, rồi viết lần lượt §0 → §8. Thứ tự viết hiệu quả: §1 Tổng quan → §4.1 danh sách FN → §5.1 danh sách SCR → §3 Luồng tổng thể → §4.2 chi tiết FN → §5.2–5.4 → §5.5 (viết sau khi chốt ngoại lệ §4.2) → §6 → §7 → §2 → §8.

### Bước 5: Tự kiểm tra rồi mới giao

Chạy `references/checklist.md`. Sau khi ghi file, báo cho user: đường dẫn file, số lượng FN/SCR/API/MSG, và **danh sách ISS mức Cao** (những điểm chặn code, cần nghiệp vụ chốt sớm).

## Quy tắc đánh mã

| Loại | Định dạng | Ghi chú |
|---|---|---|
| Chức năng | `FN-[nhóm]-NNN` | Nhóm = nhóm chức năng nghiệp vụ viết tắt không dấu, 3–5 ký tự (VD: AUTH, CARD, TAXI — theo JP-style); tính năng nhỏ thường dùng một nhóm chung. Mã đã cấp không tái sử dụng, kể cả khi chức năng bị hủy |
| Màn hình | `SCR-NNN` | Mọi màn hình ở §5.1 phải xuất hiện trong sơ đồ §3 |
| Cạnh chuyển màn hình | `JR-NN` | Chỉ định nghĩa tại bảng Journey Rules §3 |
| API | `API-[nhóm]-NN` | Cùng [nhóm] với FN — tránh trùng mã giữa các tài liệu trong `mk/dev/` |
| Luồng chung | `CF-xxx` | Chỉ gọi, không đặc tả lại nội dung đã ủy thác |
| Quy tắc nghiệp vụ | `BR-[nhóm]-NNN` | Cùng [nhóm] với FN. Định nghĩa **một** lần ở chức năng đầu tiên dùng nó, nơi khác tham chiếu mã |
| Nhánh hợp lệ | `AF-x` | Chỉ xuất hiện trong bảng ngoại lệ §4.2 |
| Message | `MSG-[nhóm]-NNN` | Mã kịch bản duy nhất để tham chiếu toàn tài liệu. 001–099 = kịch bản lỗi (098/099 = fallback); từ 101 = thông báo không gắn lỗi. KHÔNG encode loại E/W/C/I vào mã (chi tiết xem writing-rules.md, mục §5.5) |
| Danh mục giá trị | `CD-NN` | Enum trên màn hình: §5.4 |
| Vấn đề tồn đọng | `ISS-NNN` | Không tái sử dụng mã. Tham chiếu trong thân tài liệu gắn ⚠️ trước mã (chi tiết xem writing-rules.md, mục Quy ước chung) |

## Quy tắc cốt lõi

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

## Anti-patterns — KHÔNG làm

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
