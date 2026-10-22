# Quy tắc viết SRS theo từng mục

Đọc **toàn bộ** file này trước khi viết. Quy tắc xếp theo mục của template, quy ước chung ở đầu. Bản SRS viết ra có cấu trúc đúng như template `srs-mobile-template.md`: giữ nguyên các mục, mọi cột trong bảng và các đoạn ghi chú người đọc có sẵn (nguyên văn). Không thêm mục, cột hay ghi chú ngoài template.

## Quy ước chung toàn tài liệu

**Cấu trúc ba tầng** (nắm rõ để ghi mỗi loại thông tin vào đúng chỗ):
- §3 LUỒNG TỔNG THỂ — sơ đồ điều hướng toàn tính năng (Mermaid) kèm bảng Journey Rules: từ màn nào đi đâu, với điều kiện gì.
- §4 YÊU CẦU CHỨC NĂNG — trục nghiệp vụ: chức năng làm gì, luồng chính / luồng thay thế / ngoại lệ, tiêu chí chấp nhận. Là căn cứ chốt phạm vi và nghiệm thu.
- §5 THIẾT KẾ MÀN HÌNH — trục UI: màn hình có gì, control, validate, hành vi Back.

**Không bỏ trống ô nào:** không áp dụng ghi "Không áp dụng"; chưa chốt ghi đúng dạng `Chưa chốt — ⚠️ ISS-NNN` (gạch ngang, không bọc ngoặc để tránh ngoặc lồng trong ô bảng). Ký hiệu ○/△/×/— khai báo một lần tại Quy tắc chung §0, không định nghĩa lại ở mục khác.

**Ghi chú/lưu ý người đọc** trong SRS viết dạng đoạn văn thường mở đầu bằng cụm nhãn dẫn in đậm (VD `**Quy tắc chung toàn tài liệu:**`, `**Thứ tự kiểm tra đầu vào chung:**`, `**Chú giải cột "Lớp":**`; không có nhãn tự nhiên thì dùng `**Lưu ý:**`), phần thân chữ thường — KHÔNG dùng tiền tố blockquote `>`, KHÔNG bôi đậm toàn đoạn. Không chép quy tắc viết của skill (quy ước đánh số message, tuyên bố kiến trúc như "bảng chính", "mã kịch bản duy nhất", quy ước cột Độ dài, Textbox nhập/readonly, không-cột-Kiểu-dữ-liệu...) vào SRS — những quy tắc đó chỉ nằm trong skill.

**Chú thích cho đội phát triển** (nguồn giá trị, nhãn nút, điều kiện kích hoạt) đặt *nghiêng trong ngoặc đơn* trong ô bảng — quy ước "phần nghiêng không thuộc chuỗi hiển thị" khai báo một lần tại Quy tắc chung §0, không lặp lại ở mục khác.

**Tham chiếu ISS trong thân tài liệu:** gắn icon cảnh báo ngay trước mã: `⚠️ ISS-NNN`; riêng cột "Mã" trong bảng §8 (nơi định nghĩa) ghi mã trần. Giá trị/điểm chưa chốt viết đủ ngữ cảnh dạng `Chưa chốt — ⚠️ ISS-NNN` — không để mã trần đứng một mình sau dấu hai chấm; các dạng khác giữ từ ngữ cảnh riêng: `(đề xuất — ⚠️ ISS-NNN)`, `(kỳ vọng — ⚠️ ISS-NNN)`.

## §0 Thông tin tài liệu và MỤC LỤC

- Mã tài liệu dạng `[PRJ]-SRS-[YYYY]-[Fxxx]`. Trạng thái "Dự thảo" khi còn ISS mức Cao.
- Heading "Lịch sử sửa đổi" để trần, không kèm ghi chú quy ước tăng phiên bản. Không xóa dòng cũ; sửa lớn +1 số nguyên, sửa nhỏ +0.1.
- MỤC LỤC đứng sau §0, chép nguyên từ template — heading các mục cố định nên link anchor cố định, không cần sinh lại.

## §1 Tổng quan

- §1.2 Phạm vi: nghiệp vụ sau giao dịch (giao thẻ, giải tỏa TSBĐ...) đưa vào với phạm vi ×, không đặc tả trong SRS.
- §1.3 Luồng chung: liệt kê các luồng dùng lại (đăng nhập lại, xác thực OTP, chọn địa chỉ...). Tài liệu này KHÔNG đặc tả lại nội dung đã ủy thác — chỉ gọi bằng mã `CF-xxx`.

## §2 Thuật ngữ

Chỉ đưa thuật ngữ mà dev app gặp trong tài liệu này. Dùng thống nhất, không dùng từ đồng nghĩa.

## §3 Luồng tổng thể

- Mermaid v11 `flowchart TD`. Node dùng SCR-ID kèm tên ngắn; mỗi cạnh gắn nhãn JR-id; nhánh variant (vật lý/phi vật lý, thường/đặc biệt...) tách rõ bằng `subgraph`.
- Mọi màn hình ở §5.1 phải xuất hiện trong sơ đồ — không có màn hình "mồ côi".
- Điều kiện chuyển KHÔNG viết trên cạnh mà định nghĩa tại bảng Journey Rules; điều kiện chỉ tham chiếu mã (FN/API/BR/AF), không chép lại nội dung rule.
- Cạnh suy luận (URD không nêu tường minh) phải ghi chú rõ trong cột Điều kiện.

## §4.1 Danh sách chức năng

- Chức năng không có màn hình riêng (kiểm tra điều kiện khi truy cập, submit nền sau xác thực...) vẫn là một dòng — cột Màn hình ghi "(xử lý nền)".
- Cột "Trạng thái": "Xác định" chỉ khi không còn ISS mức Cao trỏ vào FN; ngược lại ghi `Chờ chốt — ⚠️ ISS-NNN` (liệt kê các ISS Cao liên quan, dạng ISS-001/002) — dev nhìn cột này biết FN nào chưa nên code.
- Cột "Nguồn (URD)" là nơi duy nhất ánh xạ từng FN về mục/bước của URD — ghi bằng mã mục/bước của URD, không ghi bằng số mục của SRS; không lập ma trận truy vết riêng.
- Cột "API liên quan" phải khớp hai chiều với cột "Chức năng sử dụng" ở §6.1.

## §4.2 Đặc tả chi tiết từng chức năng

- Mỗi chức năng một mục theo khuôn template; không bỏ trống ô nào. Mỗi FN đủ: bảng khái quát, luồng chính, luồng thay thế/ngoại lệ, BR (hoặc "Không định nghĩa rule riêng"), tiêu chí chấp nhận EARS.
- Luồng chỉ có hai chủ thể: **KH** (người dùng) và **App**; bước gọi server viết đúng dạng "App gọi API-xxx-NN, chờ kết quả" — cấm mô tả server xử lý nội bộ ra sao. Luồng chỉ mô tả *trình tự* và tham chiếu bằng mã (SCR/API/BR/MSG) — không chép lại nội dung.

**Luồng thay thế / ngoại lệ** — bảng gồm đúng 3 cột `Mã | Điều kiện phát sinh | Xử lý`:
- Cột "Mã": nhánh hợp lệ dùng `AF-x`; kịch bản lỗi dùng thẳng mã message `MSG-xxx-0NN` (không có tầng mã lỗi riêng).
- Liệt kê **đủ** từng trường hợp, mỗi trường hợp một dòng; trường hợp giống nhau viết "Như MSG-xxx-0NN" thay vì chép lại; ghi "quay về bước n" khi có.
- Dòng kịch bản lỗi: cột "Xử lý" chỉ ghi lớp lỗi và lời tham chiếu `(hành vi: §5.5)` (kèm ⚠️ ISS nếu có) — KHÔNG chép nội dung cột "Xử lý" §5.5 (ghi ở hai nơi thì khi nghiệp vụ chốt lại sẽ lệch nhau). Dòng AF-x ghi diễn biến đầy đủ vì đây là nơi duy nhất mô tả nó.
- Kịch bản lớp L có BR tương ứng: cột "Điều kiện phát sinh" ghi `Vi phạm BR-xxx — vế nào`, KHÔNG chép ngưỡng/giá trị từ BR (ngưỡng chỉ ghi ở đúng một dòng BR, message dùng {placeholder}; đổi ngưỡng chỉ phải sửa một dòng). Lớp S không có BR — mô tả điều kiện nghiệp vụ ngắn.
- Nếu lớp lỗi chưa chốt, cả §4.2 lẫn §5.5 cùng gắn ⚠️ ISS.

**Quy tắc nghiệp vụ (BR):** chỉ ghi rule mà app thực thi (validate, enable/disable, format, hiển thị). Rule server kiểm tra không ghi thành BR — chúng thể hiện qua kịch bản lỗi tại §5.5 (cột "Mã server"). Rule dùng chung nhiều chức năng: định nghĩa **một** lần ở chức năng đầu tiên dùng nó, nơi khác tham chiếu mã. App không tự tính giá trị nghiệp vụ (hạn mức, phí, lãi...) trừ khi có công thức được chốt bằng văn bản.

**Tiêu chí chấp nhận** — viết dạng EARS, kiểm thử được:
- `WHEN [sự kiện], App SHALL [hành vi].`
- `IF [điều kiện lỗi], App SHALL [hành vi] và SHALL NOT [hành vi cấm].`
- `WHILE [trạng thái], App SHALL [hành vi].`

Ưu tiên nêu cả điều cấm (SHALL NOT) cho ngoại lệ — VD "SHALL NOT gọi API khi validate cục bộ fail", "SHALL NOT hiển thị màn kết quả thành công khi xác thực bị hủy".

## §5.1 Danh sách màn hình

Màn hình biến thể (vật lý/phi vật lý, thường/đặc biệt) là các SCR **riêng** — không gộp thành một SCR "dùng chung".

## §5.2 Hành vi quay lại (Back)

- Định nghĩa cho **từng** màn hình: Android back / iOS swipe-back / nút back trên header.
- Màn hình kết quả giao dịch chặn back, chỉ thoát bằng nút điều hướng; nút thoát khỏi màn kết quả phải "xóa back-stack luồng".

## §5.3 Định nghĩa hạng mục màn hình

- Lập cho từng màn hình, mỗi hạng mục một dòng — không gộp kiểu "1–13" (thứ tự/nhóm hiển thị có thể chờ Figma, mở ISS, nhưng danh mục trường phải đủ vì nguồn/format từng trường khác nhau).
- Đầu §5.3 giữ đúng hai ghi chú người đọc có sẵn trong template (chú giải cột "Nguồn" và đoạn "Thứ tự kiểm tra đầu vào chung") — nguyên văn, không thêm ghi chú khác.
- Bảng gồm đúng 9 cột `No | Tên hạng mục | Control | Bắt buộc | Độ dài | Nguồn | Giá trị mặc định | Kiểm tra đầu vào | Ghi chú` (theo JP-style, không có cột Thao tác riêng — Control ghi kèm dạng khi cần phân biệt: `Textbox (nhập)` / `Textbox (readonly)`).
- KHÔNG lập cột "Kiểu dữ liệu" riêng — ràng buộc kiểu ký tự nhận vào ghi ngay đầu cột "Kiểm tra đầu vào" theo văn phong JP-style (VD: `Chỉ nhận số; định dạng SĐT VN`), tiếp đó là rule định dạng và tham chiếu BR.
- Ba cột cuối tách riêng, ô không áp dụng ghi "—" — không để trống. Control nhập liệu (Textbox nhập, Dropdown, Checkbox, Radio) bắt buộc có "Giá trị mặc định" tường minh (kể cả "Rỗng"/"Disabled") và "Kiểm tra đầu vào" ghi ràng buộc kiểu ký tự / định dạng / tham chiếu BR, hoặc "—" có chủ đích.
- Cột "Độ dài" chỉ ghi giá trị trần, không tiền tố (`15`, KHÔNG ghi `Max 15`); độ dài trong khoảng ghi dạng min–max (`10–11`); không áp dụng ghi "—".
- Cột "Nguồn" — bắt buộc điền cho **mọi** trường theo bộ giá trị chuẩn (⚠️ = nguồn chưa chốt, phải có ISS):

| Giá trị | Ý nghĩa |
|---|---|
| `API-xxx-NN` | Server trả về (kèm tên field khi có hợp đồng API) |
| `Nhập` | Người dùng nhập/chọn — dropdown ghi kèm nguồn danh sách: `Nhập (DS: API-xxx-NN)` hoặc `Nhập (CD-xx)` |
| `Hardcode` | Fix cứng tại client (label, nút, helptext) |
| `Màn trước` | Truyền từ màn hình trước |
| `Tính` | App tự tính — bắt buộc kèm công thức đã chốt bằng văn bản |

- **Màn hình biến thể** viết dạng delta: `Giống SCR-xxx ngoại trừ...` với điều kiện chỉ đích danh màn hình gốc; bảng delta liệt kê từng khác biệt (bỏ mục nào, mục nào đổi giá trị, nút thành công đi đâu).

## §5.4 Danh mục mã và giá trị

Mọi danh sách giá trị cố định (enum) xuất hiện trên màn hình: nguồn từ đâu (hardcode app / API / remote config), giá trị mặc định nào. Mã `CD-NN`.

## §5.5 Danh sách thông báo & xử lý

Bảng trung tâm của thông báo và xử lý lỗi — một mình bảng này phải đủ thông tin để dev viết trình xử lý lỗi. Mã message là mã kịch bản duy nhất để tham chiếu toàn tài liệu (§4.2/§7/ISS tham chiếu thẳng mã MSG).

- Bảng gồm đúng 6 cột `Mã message | Mã server | Phân loại | Lớp | Nội dung hiển thị | Xử lý` — KHÔNG có cột "Màn hình sử dụng" (màn hình suy từ FN chứa kịch bản ở §4.2 và chỗ dùng ở §5.2/§5.3). KHÔNG lập bảng phân lớp riêng.
- Đầu §5.5 giữ đúng **một** ghi chú người đọc có sẵn trong template (`**Chú giải cột "Lớp":**`) — quy ước đánh số message không chép vào SRS.
- Đánh số: 001–099 = kịch bản lỗi theo thứ tự xuất hiện (098/099 dành cho fallback); từ 101 = thông báo không gắn lỗi (xác nhận, thông tin, toast) — cột Lớp, Mã server và Xử lý ghi "—". KHÔNG encode loại E/W/C/I vào mã — loại chỉ ghi ở cột Phân loại (JP-style).
- Cột "Mã server" — tự đủ trong ô, KHÔNG lập chú giải riêng: chưa có hợp đồng API ghi `⚠️ ISS-NNN` ngay trong ô (có hợp đồng thì điền từng kịch bản — nhiều mã thì liệt kê trong ô); app tự phát hiện ghi "Không áp dụng (validate cục bộ)" / "Không áp dụng (timeout client)"; dòng fallback ghi "Mã ngoài danh sách"; message không gắn lỗi ghi "—". Catalog mã lỗi chi tiết thuộc tài liệu Đặc tả API.
- Cột "Lớp": L = validate cục bộ (app tự phát hiện, không gọi API); S = lỗi nghiệp vụ server; T = timeout/chưa rõ kết quả — API giao dịch: không hiển thị "thất bại", không tự gửi lại; API truy vấn: cho KH thao tác lại. Timeout phải có kịch bản cho **từng** API, kể cả API truy vấn (hành vi khác hẳn API giao dịch).
- Cột "Xử lý" (hành vi sau khi đóng popup) là quyết định nghiệp vụ (về đâu, giữ dữ liệu không) — nghiệp vụ review cột này khi duyệt; hành vi ghi theo từng dòng; trùng tên với cột "Xử lý" của bảng ngoại lệ §4.2 nhưng vai trò khác nhau: §4.2 chỉ ghi lớp và tham chiếu, §5.5 mới là nơi ghi hành vi. §5.5 không được viết chắc chắn hơn những gì đã chốt: điểm chưa chốt (phân lớp, hành vi) gắn ⚠️ ISS ngay trong ô.
- **Kịch bản fallback (bắt buộc):** 098 = API thường, 099 = API giao dịch (xử lý như chưa rõ kết quả — tuyệt đối không map sang "thất bại"). Điều kiện kích hoạt ghi thành chú thích nghiêng **ngay trong** ô "Nội dung hiển thị" của hai dòng 098/099: server trả mã ngoài danh sách HOẶC lỗi kỹ thuật không có response nghiệp vụ hợp lệ (HTTP 4xx/5xx, response không đọc được, đứt kết nối sau khi gửi).
- Popup lỗi mặc định một nút "Đóng" — đặt thành một BR áp dụng "Toàn luồng" (cùng chỗ với BR chống double-tap), KHÔNG ghi thành ghi chú §5.5; nhãn nút khác ghi kèm trong nội dung.
- Mọi dialog xác nhận, toast, hướng dẫn quyền xuất hiện trong §4–§5 đều có mã MSG (kể cả loại C và I, kèm nhãn nút cho dialog).

**Văn phong message:** Phân loại ghi dạng "Lỗi (E)" / "Cảnh báo (W)" / "Xác nhận (C)" / "Thông tin (I)"; message lớp T dùng W, nói "đang xử lý / kiểm tra lại sau", KHÔNG nói "thất bại". Văn phong thống nhất, xưng hô thống nhất một đại từ (VD: "quý khách"); không dùng thuật ngữ kỹ thuật với người dùng cuối (tên hệ thống core, thao tác kỹ thuật); giá trị động (hạn mức min/max, phí...) dùng placeholder {x} thay vì hardcode. Nội dung message phải khớp hành vi sau đóng popup cùng dòng: message gợi ý "sửa tại chỗ" thì không được điều hướng về đầu luồng xóa form — lỗi KH sửa được và lỗi hệ thống tách nhóm hành vi.

## §6 Giao tiếp API

- §6 chỉ có **một** mục con: §6.1 Danh sách API. KHÔNG lập mục "Dữ liệu hiển thị từ API" (nguồn dữ liệu đặc tả duy nhất tại cột "Nguồn" §5.3) và KHÔNG lập mục "Bảng/Ánh xạ mã lỗi" (mapping mã server nằm ở cột "Mã server" §5.5) — lập bảng thứ hai cho cùng một thông tin thì theo thời gian hai bảng chắc chắn lệch nhau.
- Bảng gồm đúng 5 cột `Mã API | MID/Endpoint | Mô tả | Chức năng sử dụng | Gọi khi` — không tự thêm cột Timeout/Retry/Thành công (điều hướng sau thành công chỉ ở Journey Rules §3; hành vi timeout chỉ ở §5.5; cấm retry đặt thành BR).
- §6.1 chỉ ghi định danh (MID/Endpoint) và ánh xạ chức năng; schema request/response thuộc tài liệu Đặc tả API. Cột "MID/Endpoint" ghi mã dịch vụ (MID) hoặc method và đường dẫn endpoint theo hợp đồng API — chưa có hợp đồng thì ghi ⚠️ kèm mã ISS.
- Cột "Chức năng sử dụng" ghi mã FN, phải khớp hai chiều với cột "API liên quan" ở §4.1.

## §7 Yêu cầu phi chức năng

- Chỉ ghi delta so với chuẩn chung của ứng dụng; mục nào không có yêu cầu riêng ghi "Theo chuẩn chung".
- §7.3 Quyền: chỉ quyền mà tính năng này dùng; xin quyền tại thời điểm cần, không xin gộp.
- §7.4 Vòng đời: bắt buộc trả lời đủ 6+ tình huống trong template (mất mạng trước/sau khi gọi API giao dịch, background/kill, session hết hạn, cuộc gọi đến, double-tap) — đây là nơi hay bị bỏ sót nhất.

## §8 Quản lý vấn đề tồn đọng

- Mỗi ISS ghi đủ: ngày phát sinh (DD/MM/YYYY), nội dung vấn đề, **ảnh hưởng tới app** (chặn code phần nào), mức độ Cao/Trung/Thấp.
- Mã ISS không tái sử dụng. Mọi "Chưa chốt" và ⚠️ trong tài liệu phải có một dòng ISS tương ứng.
