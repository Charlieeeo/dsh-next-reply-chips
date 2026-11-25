# dsh-next-reply-chips

[English](README.en.md) | 简体中文

**每条回答下方，三个可以直接点的下一步。** 为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）提供可点击的后续消息建议。

`v0.6.0` · DSH `0.2.2-rc.x` · 桌面 / Web

## 功能

- 每轮回答结束后，在本轮动作行**上方**显示最多 3 个药丸按钮，每个是一条可以直接发出去的话。
- 点击行为可切换：**直接发送**（默认），或**只填入输入框**、你改完再自己发。
- 建议由**主回复自身**给出，不额外调用模型，因此每轮没有附加延迟和费用。
- 代理（子）会话不显示药丸，也不会被注入格式指令。
- 颜色跟随 DSH 深浅主题；会话进行中时按钮置灰。

## 工作原理

1. **主机半**注册一条系统提示，要求模型在每轮末尾追加一个 `suggest` 代码块：

   ````text
   ```suggest
   选项一 || 选项二 || 选项三
   ```
   ````

2. **浏览器半**做两件事：用一个 `suggest` 语言键的 hoc 层把该代码块**整块吞掉**（正文里看不到），并从本轮助手原文中解析出选项，渲染成药丸。

3. **点击**走输入框自身的 `inputActions`，所以附件、权限门、计划模式的表现与你手动输入完全一致。

**代价（如实说明）**：建议来自回复本身，所以**模型不遵守格式的那一轮就没有药丸**——不报错、不留空行。有插件选择"每轮额外调一次模型"来换取格式无关，代价是每轮的延迟与费用；本项目选了前者。

### 为什么用代码块而不是 HTML 注释

最初用的是 `<!--NEXT: -->` 注释，但 DSH 的 markdown 管线会**转义**而非丢弃 HTML 节点，注释会以原文形式露在正文里。代码块会按语言派发到真实槽位，因此 hoc 层可以整体替换它。旧的注释形态仍然能被解析，只是不再推荐。

## 安装

从 GitHub（推荐）：

```powershell
dsh plugin --profile desktop add "github:Charlieeeo/dsh-next-reply-chips"
```

或在 **设置 → 插件 → 添加插件** 里粘贴同一串 `github:Charlieeeo/dsh-next-reply-chips`。

从本地目录：

```powershell
dsh plugin --profile desktop add "E:\path\to\dsh-next-reply-chips"
```

安装后在 **设置 → 插件** 确认已启用。**主机半**改动需要重启 DSH；**浏览器半**改动只需刷新页面。

卸载：

```powershell
dsh plugin --profile desktop remove dsh-next-reply-chips
```

## 使用

装好后无需配置：下一轮回答结束，药丸就会出现在回答下方。

点击行为在 **设置 → 下一步建议** 里切换：

| 选项 | 点击后 |
| --- | --- |
| **直接发送**（默认） | 立刻作为你的下一条消息发出 |
| **填入输入框，待我确认** | 只填进输入框，你可以改完再自己发 |

想彻底关掉：**设置 → 插件 → dsh-next-reply-chips** 关闭开关。这会同时移除药丸、设置页、代码块隐藏层和系统提示指令，不会留下脏状态。

## 配置

唯一的状态是一个布尔值，存在 **`~/.dsh/next-reply-chips.json`**：

```json
{ "directSend": false }
```

放在 DSH 主目录而不是包目录，是因为 `dsh plugin add github:...` 会把包装进 `node_modules`，那里可能不可写、升级时也会被覆盖。

早于 0.6 的版本把该文件写在包目录，读取时仍会兼容并沿用其中的值。

## 数据与隐私

- **不联网**。插件不发起任何外部请求。
- **不额外调用模型**。没有辅助请求，没有把会话内容发到别处。
- 唯一的网络往返是**同源**的 `GET/POST /plugins/dsh-next-reply-chips/config`，仅用于读写上面那个布尔值。
- 唯一的落盘文件是 `~/.dsh/next-reply-chips.json`。
- 不采集任何遥测。

## 兼容性

- 在 DSH `0.2.2-rc.5` 上实测可用。
- 依赖三个客户端槽位：`conversation.chat.turnTail`、`conversation.chat.markdown.fence`、`settings.section`。若某个槽位不存在，药丸那一格会自动不显示，其余功能不受影响。
- 无依赖、无构建步骤、无 `peerDependencies`，因此不会触发安装期的版本闸门。

## 已知限制

- 依赖模型遵守格式；不遵守时该轮没有药丸。
- 用户消息里若手动粘贴 ```suggest 代码块，也会被隐藏层吞掉（不会影响助手侧功能）。
- 尚未发布到 npm。

## 开发

```powershell
node test/smoke.mjs   # 39 项，覆盖主机段与路由、两种点击模式、两种标记形态、Turn 折叠、解析清洗
```

测试使用临时文件，**不会读写你真实的 `~/.dsh/next-reply-chips.json`**。

调试"药丸没出现"：在浏览器控制台执行 `window.__NRC_DIAG__ = true` 并刷新，最新一条回答下方会打印一行形状诊断（`turn`、`order` 长度、`nodes` 是否 map、尾部节点种类）。

## 许可

[MIT](LICENSE)
