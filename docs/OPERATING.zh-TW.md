# Live Web 操作手冊

給你自己用的。對外的說明在 `README.md`（英文）。

---

## 0. 兩個網站，別搞混

| | 位置 | 有「Ask your own」 | 需要 GPU |
|---|---|---|---|
| **公開站台** | https://chungenyu6.github.io/video-harness-demo/ | ✗ | ✗ |
| **Live Web** | 這台機器的 port **8080** | ✓ | ✓ |

Live Web 同時包含錄製回放**和**即時提問，所以你平常只需要它。

> `npm run dev`（port 5173）只有靜態畫面、**沒有 API**，所以不會出現「Ask your own」。
> 那是給改前端用的，不是給你日常用的。

---

## 1. 連線

```bash
# 在你的筆電上
ssh -L 8080:172.17.0.2:8080 <帳號>@<server-host>
```

然後瀏覽器開 **http://localhost:8080/**

`-L` 的目標寫 container IP（`172.17.0.2`），SSH 會一次完成
「筆電 → host → container」兩跳，你不需要自己分兩段。

---

## 2. 啟動

連進來之後：

```bash
cd /home/video-code-harness/video-harness-demo
LIVE_HOST=0.0.0.0 bash scripts.live.sh
```

**`LIVE_HOST=0.0.0.0` 不能省。** 預設只綁 container 內部的 `127.0.0.1`，
你的 `ssh -L` 會通到一個沒有服務在聽的介面 —— 看起來就像「server 掛了」。

想在背景跑（關掉 terminal 也不會停）：

```bash
cd /home/video-code-harness/video-harness-demo
setsid env LIVE_HOST=0.0.0.0 bash scripts.live.sh > /tmp/live.log 2>&1 &
```

---

## 3. 關掉

```bash
# 前景執行的：Ctrl+C

# 背景執行的：
pkill -f "uvicorn live.app"

# 確認真的關了（應該沒有輸出）
curl -s -m 3 http://127.0.0.1:8080/api/status
```

### `address already in use` 是什麼意思

**不是錯誤，是它已經在跑了。** 直接開瀏覽器就好。
真要重啟就先 `pkill -f "uvicorn live.app"` 再啟動。

---

## 4. GPU 上的模型

Live Web 需要**兩個** vLLM 服務。它們不屬於這個 repo，在 phase-0 那邊：

```bash
cd /home/video-code-harness/video-agent-harness-phase0
source scripts/env.sh

bash scripts/start_coder_server.sh    # GPU 0,1 → port 8001（Qwen3-Coder，控制器）
bash scripts/start_vlm_server.sh      # GPU 2,3 → port 8002（Qwen3-VL，看影片的）
```

各要 3–5 分鐘載入權重。確認方式：

```bash
curl -s http://127.0.0.1:8001/v1/models   # coder
curl -s http://127.0.0.1:8002/v1/models   # vlm
nvidia-smi                                 # GPU 0–3 應該各佔約 40 GB
```

**忘記啟動會怎樣：** Live Web 會在最上面顯示紅色警告，寫出哪一個沒起來、
要跑哪個指令，而且「run it」按鈕會變成不能按。每 20 秒自動重測，
模型起來後警告會自己消失，不用重整頁面。

> 這兩個服務吃 GPU 0–3。GPU 4 和 6 是別人的，不要動。

---

## 5. 日常流程

```bash
# 1. 筆電
ssh -L 8080:172.17.0.2:8080 <帳號>@<server-host>

# 2. 確認模型在（沒在就啟動，等 3–5 分鐘）
curl -s http://127.0.0.1:8001/v1/models >/dev/null && echo coder OK
curl -s http://127.0.0.1:8002/v1/models >/dev/null && echo vlm OK

# 3. 啟動 Live Web
cd /home/video-code-harness/video-harness-demo
setsid env LIVE_HOST=0.0.0.0 bash scripts.live.sh > /tmp/live.log 2>&1 &

# 4. 瀏覽器 http://localhost:8080/
```

---

## 6. 清理

每次 live 提問會留下約 20 MB（大部分是 workspace 裡那份影片副本）。

```bash
cd /home/video-code-harness/video-harness-demo
python tools/prune_live.py              # 只報告會刪什麼
python tools/prune_live.py --apply      # 保留最近 10 個，其餘刪除
python tools/prune_live.py --keep 0 --apply   # 全部清掉
```

保留而非跑完就刪，是因為 bundle 沒有對應的 run 目錄就**無法再被重新驗證** ——
而「可被重新驗證」正是這整個專案的主張。

live 的產出不會進版控、不會出現在公開站台。

---

## 7. 卡住時

| 症狀 | 原因 | 處理 |
|---|---|---|
| 瀏覽器全黑 / 一直載入 | tunnel 通了但服務沒在那個介面上聽 | 用 `LIVE_HOST=0.0.0.0` 重啟 |
| 看不到「Ask your own」 | 你連到 5173（dev server），那裡沒有 API | 改用 8080 |
| 按 run 出現 `Not found` | 同上 | 改用 8080 |
| `address already in use` | 它已經在跑了 | 直接開瀏覽器 |
| run 卡住不動最後 timeout | 已知的間歇性 wedge（未解） | 重跑一次；紀錄見 phase-0 decision log 的 OPEN 條目 |
| 紅色警告說模型沒起來 | GPU 服務沒啟動 | 見第 4 節 |

其他狀況：`tail -f /tmp/live.log`，以及瀏覽器 F12 的 Console / Network。
