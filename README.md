# Beer Kit (`bk`)

**Bộ công cụ multi-agent cho Claude Code: mobile (iOS, Android, Flutter), backend Python, frontend web và repo fullstack.**

Beer Kit biến Claude Code từ một trợ lý chung chung thành một đội phát triển có quy trình:
có người lập kế hoạch, người code, người review, người test, người debug. Mỗi người đều biết rõ
nền tảng bạn đang làm (Swift/SwiftUI, Kotlin/Compose, Dart/BLoC, Python với FastAPI hoặc Django,
TypeScript/React với Next.js hoặc Vite — `bk init` tự nhận framework). Toàn bộ chạy trong
`.claude/` của dự án, nên kit đi cùng repo và cả team dùng chung một bộ luật.

<!-- auto:release-stats -->
| | |
|---|---|
| **26** agents | planner, developer theo nền tảng, 3 reviewer, debugger, security auditor, test architect, git manager... |
| **43** skills | `/bk-plan`, `/bk-code`, `/bk-debug`, `/bk-test`, `/bk-team`, `/bk-autopilot`... |
| **65** hooks | chặn đọc file nhạy cảm, quét secret, giới hạn context, ép phân vai, đo chi phí... |
| **33** rules | chuẩn code từng nền tảng, giao thức điều phối, cổng phê duyệt |
| **6** kit | iOS · Android · Flutter · Python (backend) · Web (frontend) · Fullstack (Python + web), trong **một** package `@beerkit/bk` và **một** lệnh `bk` |
<!-- /auto:release-stats -->

---

## Quy trình làm việc

```
 /bk-bootstrap        quét dự án, sinh tài liệu nền (kiến trúc, quy ước, lệnh build/test)
      │
      ▼
 /bk-plan "..."       kế hoạch theo phase, có phụ thuộc và phân quyền file
      │
      ▼  (bạn duyệt)
 /bk-code plan.md     code → 3 reviewer song song → test → sửa lỗi → commit
      │
      ▼
 /bk-debug "..."      phân loại độ phức tạp, điều đúng đội cho đúng lỗi
```

Muốn đi một mạch từ ý tưởng đến code: `/bk-autopilot "Đăng nhập bằng sinh trắc học"`
(plan, cổng duyệt, rồi code).

```bash
/bk-bootstrap                            # lần đầu: sinh foundation docs
/bk-plan "Màn hình đăng nhập sinh trắc học"
/bk-code bk/dev/<feature>/plan.md
/bk-debug "Build lỗi trên iOS 15"
```

## Điểm mạnh

**1. Một lệnh, sáu kit.** `bk init --kit ios|android|flutter|python|web|fullstack`, hoặc bỏ `--kit` để
kit tự nhận từ `pubspec.yaml`, `*.xcodeproj`, `build.gradle*`, `pyproject.toml` / `requirements.txt`,
hoặc `package.json` + `tsconfig.json` — ở thư mục gốc hoặc một thư mục con như `backend/`. Agent, rule
và lệnh build/test được dựng riêng cho từng nền tảng, không phải prompt chung; lệnh chạy qua trình quản
lý của project (`uv`, `poetry`, `pnpm`, `yarn`, `npm`).

**Fullstack trong một repo.** Có cả BE Python và FE web (cùng thư mục gốc hoặc `backend/` + `frontend/`)
thì kit `fullstack` giao việc BE cho `bk-python-developer`, FE cho `bk-web-developer`, chạy song song,
mỗi bên lint và test trong thư mục của mình; đổi API thì sửa BE trước, FE dùng type sinh từ OpenAPI.

**2. Chia vai thật sự, không phải một agent làm tất cả.** Người điều phối giao việc cho agent
chuyên trách. Agent chỉ-đọc (reviewer, security auditor) bị chặn quyền ghi ngay lúc giao việc và
được kiểm tra lại sau khi xong. Điều phối viên không được tự code thay developer.

**3. Review và test nằm trong luồng, không phải bước tùy chọn.** `/bk-code` chạy 3 reviewer song
song (kiến trúc, bảo mật, đúng yêu cầu), viết và chạy test, giao lỗi cho debugger, rồi commit theo
conventional format.

**4. Song song khi an toàn.** Plan tự phát hiện các phase độc lập (≥3 màn hình, không trùng file)
và `/bk-code` chạy nhiều developer cùng lúc. Việc nặng hơn dùng `/bk-team` (dev, debug hoặc review
với context riêng, có đối chất giả thuyết).

**5. Debug có phân tầng.** `/bk-debug` chấm độ phức tạp: lỗi nhỏ sửa thẳng, lỗi vừa chạy
debugger → dev → test → review, lỗi phức tạp thêm brainstorm, research, bảo mật, hiệu năng.

**6. Hàng rào an toàn dựng sẵn.**

| Hook | Làm gì |
|------|--------|
| Privacy block | Chặn `.env`, keystore, `.mobileprovision`, chứng chỉ; hỏi bạn trước khi đọc |
| Security check | Quét secret (AWS, GitHub token, private key...) trước khi ghi file, chặn nếu phát hiện |
| Scout block | Không để agent lục `Pods/`, `.gradle/`, `DerivedData/`, `node_modules/` |
| Context safety | Cảnh báo ở 70% context, chặn giao việc mới ở 85% |
| Cổng chặn vòng lặp | Dừng khi quy trình có dấu hiệu kẹt (lặp một phase, agent chạy mãi không tiến triển) |

**7. Chuyển từ Figma sang code có kiểm chứng.** Trích xuất từng màn hình Figma thành spec có token,
rồi `/bk-visual-verify` so ảnh thiết kế với ảnh app và chấm điểm lệch layout, màu, khoảng cách,
chữ. Phần này cần công cụ ngoài (xem *Lưu ý*).

**8. Agent nhớ dự án.** Mỗi agent giữ memory trong `.claude/agent-memory/` (lệnh build, mẫu kiến
trúc, lỗi hay gặp, quy ước review), đọc lúc bắt đầu và ghi lại điều mới học lúc kết thúc, nên
không phải khám phá lại từ đầu mỗi phiên.

**9. Biết mình tốn bao nhiêu.** Mỗi lần giao việc đều được ghi chi phí theo agent và theo model.
`insights.md` tổng hợp *Cost by model* và các lỗ hổng test; kit nói rõ "chưa đủ dữ liệu" khi mẫu
quá ít thay vì đoán.

**10. Chủ động tiết kiệm token.** Subagent của kit khởi động ở chế độ gọn: chỉ nạp bản tóm tắt rule
theo vai trò, `CLAUDE.md` của dự án và memory index, thay vì ~14k token rule dành cho điều phối
viên. Cần ngữ cảnh đầy đủ thì bật `subagents.fullContext`.

**11. Cập nhật không phá chỉnh sửa của bạn.** `bk update` merge 3 chiều: file bạn chưa đụng thì tự
cập nhật, file mới tự thêm, file bạn xóa vẫn bị xóa, file cả hai cùng sửa thì hỏi (Keep / Take /
Skip). `bk doctor` đối chiếu hash từng file với manifest nên mọi chỉnh sửa cục bộ đều hiện ra.

**12. Làm việc trên nhiều máy / nhiều người.** Plan và `.plan-state.json` commit được; muốn làm
tiếp ở máy khác chỉ cần `git pull` rồi `/bk-code bk/dev/<feature>/plan.md` để chạy tiếp từ bước
đang dở.

---

## Cài đặt

**Yêu cầu:** Node.js ≥ 18, Claude Code CLI đã đăng nhập, [GitHub CLI `gh`](https://cli.github.com)
đã `gh auth login` (repo này private nên `npm install` trực tiếp từ URL sẽ không dùng được), và
một dự án iOS / Android / Flutter.

```bash
# Tải bản mới nhất, rồi cài toàn cục
gh release download --repo daniel211/bk-kit --pattern 'beerkit-bk-*.tgz' --clobber
npm install -g ./beerkit-bk-*.tgz
```

```bash
# Gắn vào dự án của bạn
cd ~/MyProject
bk init --kit ios          # hoặc android / flutter / python / web / fullstack
bk doctor                  # kiểm tra cài đặt
```

Mở dự án trong Claude Code rồi chạy `/bk-bootstrap`.

Cài một phiên bản cụ thể: truyền tag vào lệnh tải, ví dụ
<!-- auto:release-version -->`gh release download v0.16.0 --repo daniel211/bk-kit --pattern 'beerkit-bk-*.tgz'`<!-- /auto:release-version -->.

### Cập nhật

```bash
gh release download --repo daniel211/bk-kit --pattern 'beerkit-bk-*.tgz' --clobber
npm install -g ./beerkit-bk-*.tgz
bk update                  # trong thư mục dự án
```

### Lệnh `bk`

| Lệnh | Việc |
|------|------|
| `bk init` | Cài kit vào `.claude/`, tạo `.bk-version.json`, cập nhật `.gitignore` |
| `bk doctor` | Kiểm tra file thiếu, file bị sửa, cấu hình model, chế độ subagent |
| `bk update` | Nâng kit lên bản mới bằng merge 3 chiều |
| `bk docs` | Quản lý tài liệu dự án sinh bởi kit |
| `bk metrics` | Xem số liệu quy trình và chi phí |
| `bk models` | Xem và đổi model/effort của từng agent: `list`, `set`, `preset`, `reset` |

---

## Cấu hình nhanh

File `.claude/.bk.json` (theo dự án) hoặc `~/.claude/.bk.json` (toàn cục):

```json
{
  "hooks": { "scout-block": false },
  "models": {
    "bk-planner": { "model": "sonnet", "effort": "high" }
  },
  "subagents": { "fullContext": false },
  "doctorIgnore": ["platform-context.json"]
}
```

- **Tắt một hook:** `"hooks": { "<tên-hook>": false }`.
- **Đổi model/effort cho từng agent:** dùng `bk models`, không cần chạy thêm `bk update`.
  `model` nhận `opus`, `sonnet`, `haiku` hoặc model id đầy đủ; `effort` nhận `low`…`max`.
  Sửa tay khóa `models` trong `.bk.json` rồi `bk update` vẫn dùng được.
- **Chọn model theo preset:** `bk init --models <preset>` hoặc `bk models preset <preset>`.
  `quality` chạy mọi agent bằng `opus`; `balanced` (mặc định) giữ nguyên cấu hình của kit;
  `economy` hạ một bậc (`opus`→`sonnet`, `sonnet`→`haiku`), trừ `bk-planner`,
  `bk-security-auditor`, `bk-debugger`. Chạy `bk init` trong terminal tương tác sẽ hỏi chọn;
  thêm `--yes` để bỏ qua câu hỏi. `bk models preset` hiện các mục sẽ thay đổi/bị bỏ trước khi ghi.
  Ví dụ: `bk models set bk-ios-developer sonnet --effort high`, `bk models reset`.
- **Giữ chỉnh sửa có chủ đích:** liệt kê file trong `doctorIgnore` để `bk doctor` không cảnh báo.
- **Lệnh build/test/lint** nằm ở `.claude/platform-context.json`; sai thì chạy
  `/bk-bootstrap --refresh` hoặc sửa tay.

---

## Lưu ý khi sử dụng

**Chi phí và thời gian**
- Đây là hệ thống nhiều agent nên tốn token hơn chat thường. Với việc nhỏ hãy dùng `--fast`
  (`/bk-plan --fast`, `/bk-code --fast`); với tính năng rủi ro cao dùng `--deep`.
- `--fast` của `/bk-code` bỏ qua review và test. Chỉ dùng cho hotfix hoặc thay đổi tầm thường.
- Theo dõi % context ở statusline, chạy `/compact` trước khi tới 70%. Ở 85% kit sẽ chặn giao việc
  mới.

**Yêu cầu phiên bản và công cụ ngoài**
- Chế độ subagent gọn (`omitClaudeMd`) cần **Claude Code ≥ 2.1.271**. Bản thấp hơn nạp đầy đủ rule
  như bình thường nhưng tốn token hơn.
- `/bk-team` cần bật **Agent Teams** trong Claude Code.
- Trích xuất Figma và `/bk-visual-verify` dùng Antigravity CLI (`agy`) hoặc Gemini API; không có
  thì kit vẫn chạy đầy đủ bằng engine `claude`. Hướng dẫn `agy` nằm ở phần cuối trang này.

**Làm việc với git**
- Commit `.claude/` (trừ `hooks/.logs/`), `.bk-version.json` và `bk/dev/<feature>/`.
- **Không commit** `bk/dev/shared/.workflow-state.json`, `checkpoints/`, `.bk-metrics/`,
  `.claude/hooks/.logs/`. Đây là trạng thái phiên của riêng từng máy và sẽ gây xung đột.
  `bk init` / `bk update` ghi sẵn `.gitignore` cho các mục này; `bk doctor` báo nếu thiếu hoặc nếu
  chúng đã bị track.
- File **mới** do kit thêm có thể bị `.gitignore` của dự án che; kiểm tra `git status` sau
  `bk init` / `bk update` rồi `git add -f` nếu cần.

**Khi sửa kit đã cài**
- Sửa file trong `.claude/` là được, nhưng `bk update` sẽ hỏi khi cả bạn và kit cùng đổi một file.
  Gặp xung đột, chọn `Keep` rồi hợp nhất tay phần mới của kit; chọn `Take` sẽ mất chỉnh sửa của
  bạn.
- `.claude/.bk.json` là file cấu hình của bạn, không bao giờ bị ghi đè.

**Khi hệ thống "đứng"**
- Kit chủ động dừng một quy trình có vẻ kẹt (`global_halt` / `workflow_paused`). Xem lý do bằng
  `node .claude/cli/bk-health/index.cjs --dashboard`, gỡ bằng `--resume`. Đừng xóa
  `.workflow-state.json` bằng tay; kit sẽ khôi phục lại từ bản backup.
- Muốn làm tiếp một tính năng đã commit, mở lại bằng
  `bk-health --set-phase coding|testing --field reopen_reason="<lý do>"` (tối đa 3 lần).

**Bảo mật**
- Kit chặn đọc file nhạy cảm và quét secret, nhưng đó là lớp phòng hộ, không thay thế việc không
  để secret trong repo. Hãy giữ khóa API trong biến môi trường hoặc vault.
- Hook là code chạy trên máy bạn. Đọc thay đổi trong `.claude/hooks/` khi review bản cập nhật như
  với bất kỳ code nào khác.

**Về bản phát hành này**
- Repo này là **kênh phát hành**: thư mục `dist/` được sinh tự động, mỗi phiên bản là một commit
  và một tag. Đừng sửa tay trong `dist/` vì bản phát hành kế tiếp sẽ ghi đè. Cần kiểm tra trước
  khi cài: `git clone --depth 1 --branch <tag> https://github.com/daniel211/bk-kit`.
- Mỗi gói đi kèm `kit-manifest.json` (SHA-256 từng file) và `META.json` (phiên bản, commit nguồn,
  thời điểm build) để xác minh nguồn gốc.
- Số phiên bản 0.x: bản **minor** tăng có thể chứa thay đổi không tương thích; đọc ghi chú phát
  hành trước khi nâng.

---

## Giấy phép

MIT

---

<!-- auto:agy-guide -->

# Dùng Antigravity CLI (agy) — hướng dẫn cho team

Bản gốc là `docs/antigravity-cli-guide.md` trong repo nguồn `beer-kit`, chép sang đây tự
động mỗi lần release để người cài từ repo này đọc được mà không cần quyền vào repo nguồn.
**Đừng sửa trực tiếp ở đây** — sửa bản gốc, lần release sau sẽ ghi đè.

Hướng dẫn cho thành viên trong team. Áp dụng từ **kit v0.3.0**; engine `auto` (§3) có từ
**v0.5.0**.

Viết bằng tiếng Việt vì đây là tài liệu thao tác cho team; các tài liệu kiến trúc khác trong
`docs/` vẫn giữ tiếng Anh.

> **agy vẫn là TÙY CHỌN — nhưng không còn phải gõ flag.** Không cài agy thì toàn bộ kit chạy
> đầy đủ bằng engine `claude`, y hệt trước đây. Cài agy và thêm **một** allow-rule cho project
> (§2.3) thì kit tự nhận ra và tự dùng agy cho design extraction: mặc định từ v0.5.0 là
> `auto` — dùng agy khi máy này chạy được, dùng claude khi không, và không kêu ca gì cả.
> Đọc §1 để biết có cần hay không trước khi mất công cài.

---

## 1. agy thêm được gì

| Tính năng | Không có agy | Có agy |
|---|---|---|
| `/bk-review` | `bk-code-reviewer` (Claude) | thêm `--engine gemini` — model khác review code Claude viết, và `--engine dual` chạy cả hai |
| `/bk-spec --design` | trio `design-validator` + `design-spec-writer` + `design-asset-exporter` | mặc định `auto` **tự dùng agy** khi máy đủ điều kiện — Gemini viết spec; `--engine dual` để đối chiếu hai bản |
| `/bk-visual-verify` | cần `GEMINI_API_KEY` | tự dùng agy, không cần API key riêng |

Giá trị chính là **cross-model**: một model khác kiểm lại thứ Claude làm ra. Nếu bạn không cần
điều đó thì bỏ qua toàn bộ tài liệu này.

**Lưu ý tên flag không đồng nhất** — `/bk-review` dùng `--engine gemini`, còn `/bk-spec --design`
dùng `--engine agy`. Hai skill được viết ở hai thời điểm khác nhau; giá trị `claude` và `dual`
thì giống nhau ở cả hai.

---

## 2. Điều kiện tiên quyết

### 2.1 Figma token — bắt buộc nếu làm design, không liên quan agy

Từ v0.3.0, **cả hai engine đều đọc Figma qua REST API**, không qua MCP server nào. Không có
token thì không engine nào chạy được `/bk-spec --design`.

Tạo Personal Access Token tại https://www.figma.com/developers/api#access-tokens rồi:

```bash
mkdir -p ~/.config/beer-kit && chmod 700 ~/.config/beer-kit && read -rs "?Figma API key: " k && printf 'FIGMA_API_KEY=%s\n' "$k" > ~/.config/beer-kit/figma.env && chmod 600 ~/.config/beer-kit/figma.env && unset k && echo ok
```

`read -rs` để token **không hiện lên màn hình và không vào shell history**. Đừng gõ
`FIGMA_API_KEY=figd_... node ...` trực tiếp trên dòng lệnh — nó sẽ nằm lại trong history và
buffer terminal.

Kit tìm token theo thứ tự: biến môi trường → `~/.config/beer-kit/figma.env` → `.env` của
project (đi ngược lên 5 tầng). Ba tên đều được chấp nhận: `FIGMA_API_KEY`,
`FIGMA_ACCESS_TOKEN`, `FIGMA_TOKEN`.

### 2.2 Cài agy

```bash
# macOS
brew install --cask antigravity-cli
# Linux / macOS
curl -fsSL https://antigravity.google/cli/install.sh | bash
# Windows: xem https://antigravity.google/docs/cli/install/
```

Rồi chạy `agy` một lần để đăng nhập.

### 2.3 Allow-rules — bước hay bị bỏ sót nhất

agy chạy headless **không hỏi được quyền**, nên mọi tool chưa được cấp phép sẽ bị *auto-deny*:
tiến trình trả về `status: SUCCESS` với response rỗng và **không làm gì cả**. Triệu chứng là
"chạy xong mà không có file nào".

Thêm vào `~/.gemini/antigravity-cli/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "read_file(*)",
      "write_file(/duong/dan/tuyet/doi/toi/project/bk/**)"
    ]
  }
}
```

Không phải tự gõ đường dẫn — lệnh này in ra đúng snippet cho project bạn đang đứng:

```bash
bk doctor --design-engine
```

Ba điều quan trọng:

**Phải là đường dẫn tuyệt đối.** agy so khớp quyền theo đường dẫn tuyệt đối mà nó tự resolve —
và nó resolve đường dẫn tương đối theo **workspace của chính nó**, không theo thư mục bạn đang
đứng. Một rule tương đối sẽ không khớp gì cả, và không báo lỗi gì.

**Mỗi project một rule** — không phải mỗi feature. Trước đây rule trỏ thẳng vào thư mục flow
(`bk/dev/<feature>/design/**`), nghĩa là mỗi feature mới lại phải mở file settings ra thêm một
dòng. Một rule mà cứ mỗi feature phải thêm lại là một rule không ai bật — mà không ai bật thì
mặc định `auto` chẳng có nghĩa lý gì, vì không máy nào qua được cổng kiểm tra. Nên scope nâng
lên cả cây `bk/` của repo: thêm **một lần**, dùng cho mọi feature về sau. Vẫn hẹp — đúng thư
mục output của kit, không bao giờ có `command(*)`.

Rule kiểu cũ (per-flow) **vẫn được chấp nhận**: máy nào đã cấu hình theo hướng dẫn trước không
phải sửa gì. Windows cũng khớp bình thường (`C:\repo\bk\**` hay `C:/repo/bk/**` đều được).

**Kit không bao giờ tự sửa file này**, và không bao giờ dùng `--dangerously-skip-permissions`.
Cờ đó auto-approve *mọi* tool kể cả shell command trên repo của bạn. Nếu không cấp được quyền
thì kit tự rơi về engine `claude` chứ không nới quyền.

---

## 3. Cách dùng

```bash
# Review cross-model
/bk-review --engine gemini
/bk-review --engine dual          # cả Gemini và Claude, hai report riêng

# Design extraction: không cần flag, mặc định auto tự chọn engine
/bk-spec --design
/bk-spec --design --engine agy    # cố ý đòi agy: không chạy được thì nói rõ vì sao
/bk-spec --design --engine claude # ép claude, không đụng tới agy
/bk-spec --design --engine dual   # hai bản spec + báo cáo khác biệt

# Visual verify: tự dùng agy nếu có, không cần flag
/bk-visual-verify design.png screenshot.png
```

Chọn engine cho design, theo thứ tự ưu tiên:

```
--engine flag  →  BK_DESIGN_ENGINE env  →  platform-context.json:designEngine  →  auto
```

Bốn giá trị:

| Giá trị | Nghĩa |
|---|---|
| `auto` (mặc định) | Preflight một lần cho cả flow. Đạt → chạy agy. Không đạt → chạy claude, **im lặng**, chỉ một dòng info |
| `claude` | Ép claude, không đụng tới agy |
| `agy` | Cố ý đòi agy. Không đạt → vẫn tự rơi về claude, nhưng **in đủ** lý do + cách sửa + snippet allow-rule |
| `dual` | claude là bản chính + agy soát chéo, xem bên dưới |

`auto` và `agy` chạy **giống hệt nhau**; khác duy nhất ở âm lượng khi preflight không đạt.

**Chốt cho cả team:** đặt `"designEngine"` trong `.claude/platform-context.json` của project —
file này giờ ship sẵn `"auto"`. Đổi thành `"claude"` nếu team muốn mọi máy chạy như nhau bất kể
ai đã cài agy.

**Ép claude cho một lần chạy:** `--engine claude`, hoặc `BK_DESIGN_ENGINE=claude` cho cả phiên.

### `--engine dual` làm gì

Chạy cả hai engine rồi **so sánh**, không gộp và không tự chọn bên nào. Bản của Claude vẫn là
bản chính (`design.md`), bản của agy ghi riêng (`design.agy.md`), khác biệt vào
`raw/engine-diff-{slug}.md` theo ba mức:

- **CRITICAL** — node id lệch, thiếu section → code sinh ra sẽ trỏ sai chỗ, phải xử lý
- **WARN** — tên token khác, số đo lệch > 2px → vẫn build được, nên xem
- **INFO** — cách diễn đạt khác nhau → bỏ qua

Dual tốn gấp đôi thời gian và quota. Chỉ dùng khi cần đối chiếu thật.

---

## 4. Cài mới

> **Ba package cũ đã gộp thành một.** `@beerkit/bk-ios`, `@beerkit/bk-android`,
> `@beerkit/bk-flutter` không còn nữa; thay bằng **một** package `@beerkit/bk` với **một** lệnh
> `bk`, chứa sẵn cả ba kit. Nền tảng giờ là tham số `--kit`, không phải tên lệnh. Nếu máy bạn
> từng cài bản cũ, gỡ trước khi cài bản mới — nếu không, lệnh `bk-flutter` cũ vẫn nằm lại trên
> PATH và bạn sẽ tưởng mình đang chạy kit mới:
>
> ```bash
> npm uninstall -g @beerkit/bk-ios @beerkit/bk-android @beerkit/bk-flutter
> ```

```bash
gh release download --repo daniel211/bk-kit --pattern 'beerkit-bk-*.tgz' --clobber
npm install -g ./beerkit-bk-*.tgz
cd <project> && bk init --kit flutter
bk doctor
```

Không có tag thì `gh release download` lấy release mới nhất — khỏi phải sửa tài liệu mỗi lần ra
bản mới. Muốn nhìn thấy số phiên bản thì:

```bash
VER=$(gh release view --repo daniel211/bk-kit --json tagName -q .tagName)
echo "$VER"
```

Đổi `flutter` thành `ios` hoặc `android` tuỳ nền tảng — **lệnh y hệt nhau cho cả ba**, chỉ khác
giá trị `--kit`. Không truyền `--kit` thì `bk` tự đoán theo file mốc trong thư mục project
(`pubspec.yaml` → flutter, `*.xcodeproj` / `*.xcworkspace` / `Package.swift` → ios,
`build.gradle*` / `settings.gradle*` → android); đoán không ra thì nó dừng và bảo bạn truyền
`--kit`. Sau đó làm §2 nếu cần agy.

`doctor` phải báo `✓ Figma token available` — nếu là `⚠` thì quay lại §2.1. Muốn biết engine
design sẽ chạy là engine nào thì `bk doctor --design-engine` (§6).

---

## 5. Update từ 0.2.2

> **Cài CLI mới TRƯỚC, rồi mới update.** CLI 0.2.2 có lỗi: khi gặp conflict mà không có ai trả
> lời (chạy trong script, CI, hoặc agent), nó **chết giữa chừng** — một phần file đã ghi, phần
> còn lại chưa, `.bk-version.json` vẫn ghi phiên bản cũ, và không báo lỗi gì. Bản 0.3.0 sửa
> lỗi này, nhưng chỉ có tác dụng nếu bạn dùng nó để update.

```bash
# 1. Gỡ ba package cũ (xem §4) rồi cài CLI mới trước
npm uninstall -g @beerkit/bk-ios @beerkit/bk-android @beerkit/bk-flutter
gh release download --repo daniel211/bk-kit --pattern 'beerkit-bk-*.tgz' --clobber
npm install -g ./beerkit-bk-*.tgz

# 2. Rồi mới update project
cd <project>
bk update --kit flutter                      # hỏi từng conflict
bk update --kit flutter --conflict keep      # giữ hết bản của mình, không hỏi
```

**Project cũ không phải làm gì thêm.** Định dạng `.claude/` và `.bk-version.json` không đổi, nên
`bk update --kit <platform>` chạy thẳng trên project đã `init` bằng CLI đời cũ. Đổi chỉ nằm ở
CLI toàn cục, không nằm trong project. Nếu `.bk-version.json` đã ghi sẵn nền tảng thì `bk update`
lấy theo đó, khỏi cần `--kit`.

### Ba việc cần làm tay sau khi update

**`platform-context.json` gần như chắc chắn conflict.** File này thường đã được customise cho
project (state management, DI, build commands, thư mục riêng). **Giữ bản của bạn**, rồi sửa tay
hai chỗ:

- Xoá entry `"figma"` trong `mcpServers` — package `npx figma-mcp` mà nó trỏ tới chỉ có tool
  comment, không extract được gì. Từ 0.3.0 Figma đọc qua REST.
- Thêm khối mô tả nguồn Figma (tuỳ chọn, chỉ để tài liệu hoá):

```json
"externalServices": {
  "figma": {
    "type": "rest",
    "script": "scripts/figma-cli.mjs",
    "env": ["FIGMA_API_KEY"],
    "tokenFile": "~/.config/beer-kit/figma.env"
  }
}
```

**Xoá `.claude/skills/bk-design/references/mcp-tools-guide.md`.** File này đã bị thay bằng
`figma-data-guide.md`. `update` giữ lại bản local khi package gỡ một file, nên nó sẽ nằm lại và
mâu thuẫn với tài liệu mới.

**Nếu MCP `figma` từng được đăng ký với Claude Code** (`claude mcp add figma ...`), gỡ đi —
không còn dùng nữa.

### Bộ đếm dispatch tích luỹ từ trước

Nếu bạn từng dùng kit trước 0.3.0, `bk/dev/shared/.workflow-state.json` có thể đang giữ bộ đếm
dispatch cũ khiến agent bị chặn oan ("AGENT DISPATCH CAP EXCEEDED"). Bản 0.3.0 bỏ qua shape cũ
nên tự khỏi, nhưng muốn dọn sạch:

```bash
node .claude/cli/bk-health/index.cjs --reset-counts --force
```

---

## 6. Kiểm tra

### Engine design sẽ chạy là engine nào

```bash
bk doctor --design-engine
```

Allow-rule nằm ngoài repo, thuộc về máy, và không ai nhớ mình đã thêm hay chưa — đây là lệnh
nói thẳng ra. Chạy được **không cần** `.claude/` hợp lệ, và **luôn exit 0**: máy sẽ dùng claude
là máy đang chạy tốt, không phải máy hỏng.

Máy thiếu allow-rule:

```
Design engine readiness in <project>:

  ✓ agy binary on PATH — /Users/you/.local/bin/agy
  ✗ allow-rules cover <project>/bk — not covered
  ~ agy sign-in — likely
  Design engine "auto" would use: claude — ~/.gemini/antigravity-cli/settings.json has no allow-rule covering <project>/bk. Headless agy cannot ask for approval, so every write would be auto-denied.
  Add these rules to ~/.gemini/antigravity-cli/settings.json (the kit does not edit that file for you — it is shared with every other agy session on this machine).
    {
      "permissions": {
        "allow": [
          "read_file(*)",
          "write_file(<project>/bk/**)"
        ]
      }
    }
  Nothing is broken: the claude engine produces the same output from the same data.

Note: this is information, not a broken install.
```

Copy nguyên khối JSON đó vào `~/.gemini/antigravity-cli/settings.json` rồi chạy lại:

```
  ✓ agy binary on PATH — /Users/you/.local/bin/agy
  ✓ allow-rules cover <project>/bk — 2 rule(s) in ~/.gemini/antigravity-cli/settings.json
  ~ agy sign-in — unknown
  Design engine "auto" would use: agy.
```

`✓` là cổng cứng đã đạt, `✗` là cổng cứng chưa đạt, `~` là tín hiệu mềm — dòng `agy sign-in`
**không bao giờ chặn** (xem §8).

### Sức khoẻ cài đặt nói chung

```bash
bk doctor
```

Ba dòng liên quan tới tài liệu này:

```
✓ agy CLI available (code review, optional)
✓ Figma token available (design extraction, optional)
✓ design engine readiness (agy vs claude)
```

`⚠` ở dòng nào thì đọc gợi ý ngay dưới nó. `doctor` chỉ báo token **có hay không**, không bao
giờ đọc hay in ra giá trị.

Hai dòng cuối là `⚠` khi chưa có token Figma / chưa thêm allow-rule. Cả hai đều **không phải
lỗi cài đặt**: dự án không dùng Figma thì bỏ qua dòng giữa, và máy chưa cấp quyền cho agy thì
vẫn chạy trọn vẹn bằng engine `claude`.

Thử nhanh đường Figma mà không cần chạy cả workflow:

```bash
node .claude/scripts/figma-cli.mjs discover --url "<figma-url>"
```

---

## 7. Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Đã cài agy, đã đăng nhập, nhưng kit vẫn chạy engine `claude` | Thiếu allow-rule — `auto` im lặng rơi về claude đúng như thiết kế | `bk doctor --design-engine` (§6): nó chỉ đúng cổng nào trượt và in sẵn snippet |
| agy chạy xong, response rỗng, không có file | Tool bị auto-deny | Thêm allow-rule §2.3. Runner in sẵn dòng cần thêm |
| Đã thêm allow-rule vẫn bị deny | Rule dùng đường dẫn tương đối, hoặc trỏ vào thư mục flow của feature cũ | Dùng scope repo `write_file(<repo>/bk/**)` với đường dẫn tuyệt đối — lấy nguyên văn từ `doctor --design-engine` |
| `variables.json` bị skip, 403 | Figma Variables API cần scope `file_variables:read` **và gói Enterprise** | Bình thường, không phải bug. Design token lấy từ style name + giá trị thô. Ghi rõ điều này trong spec thay vì bịa tên token |
| `No Figma token` | Chưa làm §2.1 | Tạo `~/.config/beer-kit/figma.env` |
| Slug màn hình dạng `11-desktop-373-40736` | Cố ý | Nhiều frame trùng tên nên node id được gắn kèm. Đổi tên frame trong Figma là cách sửa gốc |
| `AGENT DISPATCH CAP EXCEEDED` | Agent gọi quá số lần cho phép **trong một feature** | Đổi agent, decompose, hoặc `--reset-counts` (§5) |
| `update` dừng giữa chừng | Đang dùng CLI 0.2.2 | Cài CLI 0.3.0 trước (§5) |

---

## 8. Giới hạn đã biết

- **Variables API cần Figma Enterprise.** Không có thì không lấy được design token dạng
  variable với mode Light/Dark.
- **Asset export luôn chạy bằng engine `claude`**, kể cả khi chọn `--engine agy` hay khi `auto`
  đã chọn agy. Export ra binary (PDF/SVG/PNG) nên không verify được bằng cách đọc text; sẽ mở
  cho agy ở phase sau.
- **Dòng `agy sign-in` chỉ là tín hiệu mềm.** Nó suy ra từ sự tồn tại của file credential trong
  `~/.gemini/` — layout nội bộ của agy, có thể đổi bất cứ lúc nào. Nên nó **không bao giờ chặn**
  gì cả, và có thể hiện `unknown` trên một máy đang đăng nhập bình thường. Sai theo hướng đó rẻ
  hơn: một false negative mà chặn thật sẽ từ chối một máy đang chạy tốt. Nếu đăng nhập hỏng thật
  thì fallback lúc chạy bắt được ngay ở màn đầu tiên.
- **`node.json` bị giới hạn độ sâu 6 tầng.** Một màn thật serialize đầy đủ là 3.1 MB, không
  model nào đọc nổi. Asset nằm dưới ngưỡng đó nên có file riêng `asset-candidates.json` quét
  toàn cây. Cần sâu hơn ở một nhánh thì
  `node .claude/scripts/figma-cli.mjs nodes --ids {id} --depth 3`.
- **`--engine dual` chưa dùng chung cho asset export**, chỉ so sánh phần spec.

---

## Liên quan

| Tài liệu | Ở đâu |
|---|---|
| `figma-data-guide.md` — lệnh `figma-cli` + tham chiếu field | trong kit đã cài: `.claude/skills/bk-design/references/` |
| Vì sao chuyển từ `gemini` CLI sang `agy` | `docs/antigravity-cli-migration.md` (repo beer-kit) |
| Thiết kế engine design + bài học kỹ thuật | `docs/kit-dev/plan-design-engine-agy.md` (repo beer-kit) |

Hai dòng cuối nằm trong repo nguồn; nếu bạn không có quyền truy cập thì không cần — mọi thứ
để cài và dùng đều nằm trong tài liệu này.

<!-- /auto:agy-guide -->

## Related

| Repo | Role |
|---|---|
| [beer-kit](https://github.com/daniel211/beer-kit) | Source kit — agents, skills, hooks, rules, build pipeline |
| **bk-kit** (this repo) | Release channel — built output, one tag per version |
