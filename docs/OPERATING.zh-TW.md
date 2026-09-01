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
ssh -L 8080:<container-ip>:8080 cy31@ai-spark.hmcse.uwf.edu
```

然後瀏覽器開 **http://localhost:8080/**

`-L` 的目標寫 container IP，SSH 會一次完成「筆電 → host → container」兩跳，
你不需要自己分兩段。

### ⚠ container IP 會變

**Docker 在 container 重啟時會重新分配 IP。** 寫死 `172.17.0.2` 遲早會失效，
症狀是 SSH 一直印：

```
channel 3: open failed: connect failed: Connection refused
```

**那不代表 server 掛了** —— tunnel 是通的，只是它連到的位址上沒有東西在聽。

先查現在的 IP（在 container 裡）：

```bash
hostname -I
```

或者一行搞定，不用先查（前提是你在 host 上有 docker 權限）：

```bash
IP=$(ssh cy31@ai-spark.hmcse.uwf.edu \
      "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 41e9ceed22a4")
ssh -L 8080:$IP:8080 cy31@ai-spark.hmcse.uwf.edu
```

container 的名稱/ID（`41e9ceed22a4`）不會變，變的只有 IP。

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

## 4-bis. 關掉模型、釋放 GPU

```bash
cd /home/video-code-harness/video-agent-harness-phase0

bash scripts/stop_services.sh --dry-run   # 先看會關掉哪些行程
bash scripts/stop_services.sh             # 兩個都關
bash scripts/stop_services.sh coder       # 只關其中一個
```

關完會印出 port 狀態和 GPU 用量。**權重在行程結束時就釋放了,沒有其他要做的。**

### 為什麼不能直接 kill pid 檔裡那個

服務記錄的 pid 只是最外層的 shell。實際的行程鏈是:

```
bash start_coder_server.sh
└─ uv run vllm serve
   └─ python3
      └─ VLLM::EngineCore
         ├─ VLLM::Worker_TP0     ← 這兩個才是佔 GPU 的
         └─ VLLM::Worker_TP1
```

只殺最上層,worker 會變成孤兒繼續佔著約 40 GB —— 看起來像「關了但沒關」。
`stop_services.sh` 會走完整棵樹。

> `nvidia-smi` 在 container 裡顯示的是 **host PID**,跟這裡的 `/proc` 對不起來,
> 不要試著比對。看**釋放的記憶體**就好。

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

收工：

```bash
pkill -f "uvicorn live.app"                                    # 關 Live Web
cd /home/video-code-harness/video-agent-harness-phase0
bash scripts/stop_services.sh                                   # 關模型、放 GPU
```

模型放著不關也可以（它們只是佔記憶體，不吃算力）。
但如果別人要用那幾張卡，就該關。

---

## 6. 清理

**live 只保留當次。** 每次開始新的 run 之前，會自動把上一次的清掉
（run 目錄 + bundle 一起），所以不會累積。

清理發生在**開跑前**而不是跑完後 —— 這樣你看完的那一次會一直留著，
直到你問下一題為止。

要手動清空（例如跑完就想收乾淨）：

```bash
cd /home/video-code-harness/video-harness-demo
python tools/prune_live.py --keep 0 --apply
```

`prune_live.py` 仍然保留，用於手動清理或改變保留數量。

live 的產出不會進版控、不會出現在公開站台。

---

## 7. 卡住時

| 症狀 | 原因 | 處理 |
|---|---|---|
| 瀏覽器全黑 / 一直載入 | tunnel 通了但服務沒在那個介面上聽 | 用 `LIVE_HOST=0.0.0.0` 重啟 |
| SSH 一直印 `channel N: open failed: connect failed` | **container IP 變了**，tunnel 指到舊位址 | 在 container 裡 `hostname -I` 查新 IP，重開 tunnel |
| 看不到「Ask your own」 | 你連到 5173（dev server），那裡沒有 API | 改用 8080 |
| 按 run 出現 `Not found` | 同上 | 改用 8080 |
| `address already in use` | 它已經在跑了 | 直接開瀏覽器 |
| run 卡住不動最後 timeout | 已知的間歇性 wedge（未解） | 重跑一次；紀錄見 phase-0 decision log 的 OPEN 條目 |
| 紅色警告說模型沒起來 | GPU 服務沒啟動 | 見第 4 節 |

其他狀況：`tail -f /tmp/live.log`，以及瀏覽器 F12 的 Console / Network。
