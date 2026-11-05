# 语音识别服务（Agent 输入框的语音输入）

> 基准版本：`main` @ `bf744a9`（2026-11-05）
> 服务代码：`asr/`（独立目录，Python + Docker）
> 前端接入：`src/pages/agent/voice/`、`src/pages/agent/hooks/use-voice-input.ts`

---

## 一、一句话结论

浏览器自带的 `webkitSpeechRecognition` **不可用**（术语全错、9 位物料号丢位、桌面壳没有这个 API），
所以语音输入改成：**前端 `MediaRecorder` 录音 → 上传本地 ASR 容器 → 文本回填**。

识别引擎是 **SenseVoice-Small**（234M / int8 230MB），CPU 即可，15 秒音频约 0.3 秒出结果。

```bash
cd asr && docker compose up -d      # 启动，监听 127.0.0.1:9383
./smoke.sh                          # 冒烟测试（macOS 用 say 现造一段中文）
```

---

## 二、为什么不用 Web Speech API

同一句话，三种链路的实测：

| 链路 | 结果 |
| --- | --- |
| Chrome Web Speech | 新建一个包装包**放置**物料**316-1801****项目好**FT**和**029…**佛疗**118140-044 11810 000 |
| SenseVoice | 新建一个包装包**缝制物料316180001项目号**是FT029…**辅料118140044** |

Chrome 那条路有三个死结：

1. **不能注入词表**。`SpeechGrammarList` 现代浏览器直接忽略，`缝制`→`放置`、`辅料`→`佛疗` 这类错无法纠正；
2. **长数字串被语义规整**。`316180001` 变成 `316-1801`，位数都丢了，后处理补不回来；
3. **桌面壳没有这个 API**。MyGo 用 WKWebView（Safari 内核），`window.webkitSpeechRecognition` 是 undefined。

另外它默认 `continuous = false`，语义是「识别完一句话就结束」，说几个字、换口气就被判停
—— 这也是最初「说几个字就自动停」的原因。

---

## 三、架构

```
输入框麦克风
   │  MediaRecorder（audio/webm;codecs=opus）
   ▼
POST /asr ──(dev: vite proxy → 127.0.0.1:9383)──►  asr 容器
                                                    │ ffmpeg 解码 → 16k 单声道
                                                    │ SenseVoice 识别
                                                    │ postprocess：术语纠错 + 格式规整
                                                    ▼
                                            { text, raw, elapsed, rtf }
```

**为什么是「整段上传」而不是流式**：识别只要 0.3 秒，延迟几乎全部来自说话时长本身；
而 VAD 切句会把「项目号是……FT-029」这种一口气报参数的句子切碎，后半句失去语境反而更容易错。
真要做逐句识别，见第十节的扩展方向。

---

## 四、起服务

```bash
cd asr
docker compose up -d          # 首次构建约 5 分钟（装 ffmpeg）
docker compose logs -f        # 看模型加载
curl localhost:9383/health    # {"status":"ok", ...}
```

资源：**2 核 / 2G 足够**，常驻内存 350MB 左右，模型加载 0.65 秒。

三个东西不进镜像、需要单独准备：

| 内容 | 位置 | 说明 |
| --- | --- | --- |
| 模型权重 | `asr/models/sensevoice/` | 230MB，`model.int8.onnx` + `tokens.txt`，已 gitignore |
| 业务词表 | `asr/business_terms.txt` | 挂载进容器，改词 `docker compose restart asr` 即可 |
| ffmpeg | 镜像内 | arm64 上会带 97MB 的 X11/llvm 依赖，**国内直连 deb 源会构建失败，需要 Docker 走代理** |

模型下载（国内直连 huggingface 不通，用镜像站）：

```bash
cd asr/models/sensevoice
curl -L -o model.int8.onnx https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx
curl -L -o tokens.txt      https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt
```

---

## 五、接口

### `GET /health`

```json
{ "status": "ok", "model": "sensevoice-small-int8", "language": "auto", "error": null }
```

`status` 为 `loading` 表示模型还在加载（或加载失败，原因在 `error` 里）。

### `POST /asr`

`multipart/form-data`，字段名 `file`。wav / mp3 / m4a / webm / opus 都行，服务端交给 ffmpeg 解码。

```bash
curl -X POST localhost:9383/asr -F "file=@录音.m4a"
```

```json
{
  "text": "新建一个包装bom缝制物料316180001，项目号是FT-029。",
  "raw": "新建一个包装包缝制物料316180001，项目号是FT029。",
  "duration": 7.98,
  "elapsed": 0.151,
  "rtf": 0.019
}
```

- `text`：纠错后的结果，**前端用这个**；
- `raw`：识别原文，排查「到底模型听错了还是纠错改错了」时对比用。

### `GET /terms`

当前生效的业务词表，改完词表重启容器后可以在这里确认是否加载。

---

## 六、词表维护（这是纠错能力的唯一来源）

`asr/business_terms.txt`，每行一个词：

```
正确写法 | 别名1 | 别名2
```

别名可选，只在**目标词含英文/数字**时才需要（拼音匹配不到英文）。

### 纯中文词：靠拼音近似，不需要写别名

纠错器把识别文本和词表都转成拼音（声母 + 韵母），长度相同的窗口逐个比：

- 整个音节相同 = 1 分，只有声母相同 = 0.5 分；
- 平均 ≥ 0.75 且字数相同 → 替换成词表写法。

```
纺织物料  fang-zhi-wu-liao  vs  缝制物料  feng-zhi-wu-liao
          (0.5)  (1)   (1)    (1)  →  0.875  ≥ 0.75  → 替换
```

所以**同一个词的各种错法都能命中**，不需要事先见过：
`纺织物料` / `防织物料` / `仿制物料` 都会变成 `缝制物料`，`佛疗` / `幅料` 都会变成 `辅料`。

### 含英文的词：必须写别名

`包装bom` 的拼音和「包装包」差得太远，走不了拼音匹配，只能列：

```
包装bom | 包装包 | 包装宝 | 包装波
```

### 写词表的原则

- **词要来自业务**（物料类型、包装方法、字段名），不是从某句识别错误里抄；
- **宁可少写**：`数量`、`方法` 这种到处都对的词写进来，只会让纠错器把正常文本改坏；
- **长度必须一致才会替换**，所以词表里的词要和口述习惯一致（说「缝制物料」就写四个字）；
- 词表可以灌到几百条，开销是 `O(词数 × 文本长度)`，毫秒级。

---

## 七、格式规整（与说法无关，规则永远成立）

| 输入 | 输出 | 规则 |
| --- | --- | --- |
| `FT杠029` / `ftT—029` / `FT029` | `FT-029` | 前缀与数字间允许 0~4 个非数字字符 |
| `118140044118100007` | `118140044 118100007` | 相邻物料号按 9 位切 |

**只切 9 的整数倍**：长度不是 9 的倍数说明识别时已经丢了位，硬切只会切出更隐蔽的错，
原样留着让人一眼看出这里有问题。

业务常量集中在 `asr/postprocess.py` 顶部：

```python
PROJECT_PREFIXES = ("FT",)      # 项目号前缀
MATERIAL_CODE_LENGTH = 9        # 物料号位数
MIN_SIMILARITY = 0.75           # 拼音相似度阈值
```

---

## 八、前端接入

```
src/pages/agent/
  voice/client.ts         上传与错误文案（不走 @/api：multipart 二进制，且识别服务不需要登录态）
  hooks/use-voice-input.ts  MediaRecorder 录音 + 状态机，把 allowSpeech 摊给 Sender
```

- Sender 走**受控模式** `allowSpeech={{ recording, onRecordingChange }}`：点一下开始、再点一次结束，
  不依赖任何语音活动检测；`onRecordingChange` 只是告诉我们「用户点了开始/结束」。
- 首次录音会弹麦克风授权，这期间图标先亮（乐观置位），失败再回退并提示。
- 识别结果拼进输入框时按空格连接已输入的内容。
- footer 会显示「正在听…」/「识别中…」。

地址配置（见 `.env.development`）：

```bash
# 开发环境默认走 dev server 的 /asr 代理（同源，不用处理 CORS），代理目标：
# VITE_ASR_TARGET=http://127.0.0.1:9383
# 生产没有 dev server，必须显式指向服务地址：
# VITE_ASR_URL=http://192.168.9.16:9383
```

代理规则在 `vite.config.ts` 的 `server.proxy['/asr']`。

---

## 九、排查

| 现象 | 原因 |
| --- | --- |
| 提示「连不上语音识别服务」 | 容器没起：`cd asr && docker compose up -d` |
| 提示「识别服务还在加载模型」 | 503，模型首次加载中，等几秒 |
| 提示「没录到声音」 | 录制数据不足 800 字节，多半是麦克风没权限或被占用 |
| 识别成英文乱码 | 传给服务的是空音频（例如 TTS 生成了 0.01 秒的空文件），不是语言设置的问题 |
| 构建卡在 `apt-get install ffmpeg` | 国内直连 deb 源只有 205kB/s，会断。让 Docker 走代理，或临时换国内源 |
| 改了词表没生效 | 词表是挂载的，`docker compose restart asr`；改完用 `GET /terms` 确认 |

---

## 十、已知限制与扩展方向

### 改不了的

**数字丢位**。`316180001` 识别成 `3161801`（少一位），任何模型和规则都补不回来——
错一位就是另一个物料。所以编号必须做**位数校验 + 查库**，查不到就让人确认，不能静默通过。

### 可以改善的

| 方向 | 做法 | 收益 |
| --- | --- | --- |
| **逐句识别** | AudioWorklet 抓 PCM，按静音切片上传 | 说完一句就出结果，不用等整段说完；适合「一句一句慢慢说」 |
| **ASR 层热词** | 换成 FunASR Paraformer（`sherpa-onnx` 的 `from_paraformer`）并配热词表 | 解码时就认识领域词，`bom` 这类中英混读不用靠别名枚举 |
| **LLM 纠错** | 把 `raw` + 词表交给模型，只纠词不动数字 | 能处理语义层面的错，代价是延迟翻倍、可能改坏 |
| **词表规模化** | 从物料主数据、方法枚举批量生成 `business_terms.txt` | 覆盖面从十几条变成几百条，这才是「通用性」的最终来源 |

### 刻意不做

- 前端不做任何纠错：业务词会散进代码，改一个词要发一次版；
- 不做通用语言纠错：容易把用户本来正确的话改坏，还会掩盖真正的问题。
