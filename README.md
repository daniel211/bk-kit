# bk-kit — Beer Kit release channel

**`dist/` is generated. Do not edit it by hand.**

Every commit here is produced by the `/bk-releasekit <version>` skill in the
[beer-kit](https://github.com/daniel211/beer-kit) source repo. One commit + one tag per
released kit version. Anything you change under `dist/` is overwritten by the next release —
fix it in `beer-kit/src/` instead.

This README is the exception: releases do not touch it, so it is the place to keep notes for
whoever installs from here.

## Layout

```
dist/ios/          kit/, kit-manifest.json, META.json, package.json, bin/, commands/, lib/, cli/, templates/
dist/android/      same shape
dist/flutter/      same shape
```

Each `dist/<platform>/` is a complete, standalone npm package. `kit/` is the pre-merged
Claude Code kit (agents, skills, hooks, rules) that `bk-<platform> init` copies into a
project's `.claude/` directory.

## Installing a released version

Each tag also carries the three packed tarballs as GitHub Release assets — that is the
install path, and it works without an npm registry:

```bash
gh release download v0.3.0 --repo daniel211/bk-kit --pattern 'beerkit-bk-ios-*.tgz'
npm install -g ./beerkit-bk-ios-0.3.0.tgz

cd ~/MyApp
bk-ios init
bk-ios doctor
```

Swap `ios` for `android` or `flutter` as needed. `gh` handles authentication for this
private repo; a plain `npm install -g <url>` will not.

To inspect a version instead of installing it:

```bash
git clone --depth 1 --branch v0.3.0 https://github.com/daniel211/bk-kit
```

## Verifying an install

`dist/<platform>/kit-manifest.json` lists every shipped file with its SHA-256 hash, and
`META.json` records the kit version, the source commit it was built from, and the build
timestamp. `bk-<platform> doctor` checks an installed `.claude/` against that manifest.

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
