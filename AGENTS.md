# AGENTS.md

面向 AI 编码代理的操作手册。人类读者请看 [README.md](README.md)。

---

## 0. 这是什么

本地跑的大模型人格干预工具。推理时往残差流里注入一个向量，改变模型的说话风格。Python 后端常驻模型，React 前端单页。

三个核心事实：

1. **模型参数留在文件里，偏置加在计算里。** 人格是一个 `hidden_size` 维的单位向量（4B 是 2560 维，13 KB），每次前向现算成一层偏置。
2. **两种粒度。** 方向级（`residual += α·‖r‖·v`）通用；神经元级（`residual += Δ·down_proj[:, j]`）要求每层有 dense `down_proj`。
3. **单卡串行。** 所有前向共用一个 `engine.lock`，并发请求排队。

---

## 1. 首次接管

```bash
# 1) 依赖（完整步骤见 README「快速开始」）
python -m venv D:/AI/LLM/venv
D:/AI/LLM/venv/Scripts/python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu130
D:/AI/LLM/venv/Scripts/python.exe -m pip install transformers accelerate pillow fastapi "uvicorn[standard]" sse-starlette

# 2) 模型（约 8.2 GB）
D:/AI/LLM/venv/Scripts/hf download Qwen/Qwen3.5-4B --local-dir D:/AI/LLM/models/Qwen3.5-4B

# 3) 前端
cd app/web && npm install && npm run build && cd ..

# 4) 起服务（前台阻塞，日志在 stdout）
cd app && D:/AI/LLM/venv/Scripts/python.exe server.py

# 5) 自检（另开一个终端）
D:/AI/LLM/venv/Scripts/python.exe app/verify.py
```

`verify.py` 五项全部 `PASS` 即环境就绪。它只读接口，不改数据。

---

## 2. 仓库地图

| 路径 | 职责 | 什么时候动它 |
|---|---|---|
| `app/engine.py` | 模型加载、注入、剂量换算、建向量、扫描、流式生成 | 改干预机制 |
| `app/server.py` | HTTP 层：人格 CRUD、SSE、扫描、导出导入、静态托管 | 加接口 |
| `app/verify.py` | 端到端自检，五项检查 | 加功能后补一项 |
| `app/data/personas.json` | 人格元数据（名字、层、α、颜色、备注） | 调默认参数 |
| `app/web/src/App.tsx` | 前端外壳、全局状态 `Ctx`、视图路由（hash） | 改布局/状态 |
| `app/web/src/components/LabView.tsx` | 实验台：人格栏 + 对话 + 参数 | 改对话交互 |
| `app/web/src/components/CompareView.tsx` | 三栏并排 | 改对比逻辑 |
| `app/web/src/components/LocateView.tsx` | 扫描 + 分布图 + 候选表 + 神经元详情 | 改定位体验 |
| `app/web/src/components/LibraryView.tsx` | 人格卡片墙、新建、导入导出 | 改人格管理 |
| `app/web/src/components/ParamPanel.tsx` | 右侧参数面板（方向/神经元、层、α、温度） | 改参数项 |
| `app/web/src/lib/api.ts` | API 客户端、SSE 解析、类型定义 | 加接口后同步 |
| `traits/*.pt` | 人格向量（`{vec, layer, name, dim}`） | 换模型后重建 |
| `traits/*.json` | 对比提示词（`{target[], neutral[]}`），**与模型无关** | 加人格 |
| `neuron_steer.py` | 命令行版，同一套机制的脚本入口 | 加 CLI 子命令 |
| `app/desktop/` | Tauri 外壳：自绘标题栏、启动时探测并拉起后端 | 改窗口行为 |
| `app/promo/` | 宣传片源码：HTML 动画 + CDP 逐帧渲染脚本 | 改宣传片 |
| `app/web/src/components/TitleBar.tsx` | 自绘标题栏，`IS_TAURI` 为真时渲染 | 改窗口控件 |

---

## 3. 环境事实

- Python **3.13**；torch **2.14.1+cu130**（Windows 上 CUDA 轮子最高到此版本，Blackwell sm_120 需要 cu130）
- transformers **5.22.1**；`torchvision` 必装——`AutoProcessor` 加载 Qwen3-VL 系 processor 时依赖它
- 模型 Qwen3.5-4B：**32 层 / hidden 2560 / intermediate 9216 / bf16 占 8.5 GB**
- 架构特点：混合线性注意力（每 4 层一个 full attention）+ 多模态；层路径是 `model.language_model.layers`
- 前端：Vite + React 19 + Tailwind v4 + shadcn（radix 基座）
- 端口：后端 **8791**（同时托管 `web/dist`），前端 dev **5273**（`/api` 代理到 8791）
- 桌面版：Tauri 2 + Rust 1.77+，`decorations: false` 配自绘标题栏；页面来自 `tauri://`，接口走 `http://127.0.0.1:8791`（见 `lib/api.ts` 的 `API_BASE`）

---

## 4. 硬约束

改动时必须满足：

1. **向量维度 == `model.config.hidden_size`**。不匹配时 `load_vector` 会抛错并指路「人格库 → 重建全部」。
2. **层号与 checkpoint 绑定**。换模型后层号语义全变，人格必须重建、层号必须重扫。
3. **所有前向持 `engine.lock`**。`stream` / `scan` / `inspect_neuron` / `build_trait` 都在锁内，新加的路径照做。
4. **SSE 事件格式固定**：`{"type": "meta"|"delta"|"done"|"error", "payload": ...}`。前端 `lib/api.ts` 按这个解析。
5. **改前端源码后跑 `npm run build`**。8791 读的是 `app/web/dist`，dev server 只服务 5273。
6. **仓库只放代码和小向量**。权重、`venv`、`node_modules` 走 `.gitignore`。

---

## 5. 核心代码路径

改机制从这几个函数下手：

```python
# 加载与结构探测
Engine._load()          # 按 TT_MODEL_DIR / TT_MODEL_ID 加载
Engine._find_layers()   # 兼容 model.layers / model.language_model.layers / ...
_has_ffn(layer)         # 认 mlp / moe / feed_forward 三种命名
dense_mlp(layer)        # 取 dense MLP；MoE 层返回 None
Engine.supports_neuron()# 能力探测，返回 (bool, 人话原因)

# 注入
Engine.install(injection)   # 分发到下面两个
hook_direction(...)         # 在 layers[L] 输出上加向量
hook_neuron(...)            # 在 down_proj 的输入上改第 j 位

# 剂量与向量
Engine.residual_norm(L)     # 该层残差流中位范数，α 的分母
Engine.build_trait(pairs, layer)  # 对比均值差 → 单位向量

# 扫描与生成
Engine.scan(pairs, layers)  # 一次前向抓所有层
Engine.stream(messages, injection, ...)  # TextIteratorStreamer + 线程
```

两个公式：

```
神经元级:  residual += Δ · down_proj.weight[:, j]     Δ = dose · ‖r‖ / ‖col_j‖
方向级:    residual += α · ‖r‖ · v
```

`‖r‖` 是该层残差流中位范数，所以 α 与 dose 都是**相对量**，跨层可比。

---

## 6. 常见任务配方

### 6.1 换模型

```bash
set TT_MODEL_DIR=D:/AI/LLM/models/目标模型
set TT_MODEL_ID=org/目标模型     # 本地目录存在时以后者为准，前者只作兜底
```

启动后去「人格库 → 重建全部」（或 `POST /api/personas/rebuild`），用各自的提示词 JSON 为当前模型重算向量。**提示词通用，向量跟模型绑定。**

### 6.2 加一个人格

写 `traits/<name>.json`：

```json
{"target": ["用X的语气回答：问题一", "..."], "neutral": ["用平常的语气回答：问题一", "..."]}
```

规则：**两边问的事情一致，差别只在语气**；条数相等。然后：

```bash
curl -X POST http://127.0.0.1:8791/api/personas -H "Content-Type: application/json" -d '{
  "name":"sarcastic","label":"阴阳怪气","layer":18,"alpha":0.8,
  "color":"#7F77DD","notes":"","target":[...],"neutral":[...]}'
```

层号靠试：攻击类 L18、亲密类 L22，实测差异很大。

### 6.3 让 MoE 模型支持神经元模式（进阶）

当前 `dense_mlp()` 对 MoE 返回 `None`，界面上会灰掉神经元模式。要支持，需要：

1. 给神经元编号加一个专家维度：`neuron = expert_id * expert_inter + j`
2. `hook_neuron` 里改成 hook 到 `mlp.experts[expert_id].down_proj`
3. 注意每个 token 只路由到 top-k 个专家（Qwen3.6-35B-A3B 是 8/256），注入只对路由到该专家的 token 生效，效果会被稀释
4. `scan` 的输出维度也要按 `num_experts * expert_inter` 展开

这条路可行但收益有限——MoE 上方向级本来就够用。

### 6.4 加一个 API 端点

`app/server.py` 里加函数 → `app/web/src/lib/api.ts` 里加方法 → `app/verify.py` 里加一项检查。

### 6.5 打包桌面版

```bash
cd app/desktop && npm install && npx tauri build
# 产物：src-tauri/target/release/bundle/nsis/TT_Persona_<ver>_x64-setup.exe
```

改完前端要先 `cd app/web && npm run build`，Tauri 的 `frontendDist` 指向 `web/dist`。

后端路径由 `%APPDATA%\TT_Persona\backend.json` 决定，首次运行自动生成。窗口用 `decorations: false`，标题栏是 `TitleBar.tsx` 画的，窗口控制依赖 `capabilities/default.json` 里那几个 `core:window:allow-*` 权限。

### 6.6 改前端视图

视图组件在 `components/`，共享状态走 `App.tsx` 的 `Ctx`。加视图要同时改三处：`NAV` 常量、`View` 类型、`App` 里的条件渲染。

---

## 7. 验证

```bash
D:/AI/LLM/venv/Scripts/python.exe app/verify.py
```

五项：模型就绪 / 人格库可读 / 流式生成 / 神经元扫描 / 神经元注入。MoE 模型下第五项会显示「跳过」。

---

## 8. 已知坑（都踩过）

| 现象 | 原因 | 处理 |
|---|---|---|
| `Torchvision 缺失` | `AutoProcessor` 依赖它 | `pip install torchvision`（同 CUDA 索引） |
| Windows 脚本输出乱码 | 控制台 GBK | `subprocess(..., encoding='gbk', errors='ignore')` |
| 访问 127.0.0.1 报 502 | 环境有 `http_proxy` | 脚本里 `build_opener(ProxyHandler({}))`（verify.py 已处理） |
| shadcn 把文件写到 `@/` 目录 | TS6 移除了 `baseUrl`，CLI 解析不到别名 | 手工搬回 `src/components/ui/` |
| 无头截图看不到变化 | Chrome 缓存 | URL 加 `?cb=$RANDOM` |
| 输出里出现 `<think>` | 剂量偏大时模型重发思考标记 | 前端 `clean()` 过滤 |
| 前端改了页面照旧 | 忘了 `npm run build` | 构建，或浏览器加 `?v=2` |

---

## 9. 边界

- **MoE 模型走方向模式。** 专家层里没有统一的 `down_proj`。
- **GGUF 走方向级。** llama.cpp 提供 layer 级 control vector；量化后的列带误差，剂量标定会偏。
- **剂量窗口窄。** ±0.3 几乎原样，±0.8 效果明显，±1.5 以上崩坏。
- **换风格，换不了能力。** 它调动模型训练时已具备的表达能力；能力上限由模型本身决定。
