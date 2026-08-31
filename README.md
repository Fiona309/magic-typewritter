# The Magic Typewriter · 魔法打字机

纯前端摄像头手势互动项目。玩家无需接触键盘，通过手势操作一台原创机械打字机，回答两个问题，并生成一张 3:4 创作者宣言海报。

## 交互

- 张开手掌移动：选择字母
- 捏合：敲下字母
- 大拇指：空格
- 剪刀手：删除
- 双手举起：完成当前输入

同时支持鼠标和实体键盘作为调试与现场降级方案。

## 本地运行

```bash
python3 serve.py
```

打开 `http://localhost:8642`。

调试参数：

- `?mouse=1`：跳过摄像头，使用鼠标和键盘
- `?auto=1`：自动演示 `FIONA / MUSIC` 完整流程
- `?debug=1`：显示状态与帧率

## 技术结构

- `public/js/HandInput.js`：MediaPipe 手部识别
- `public/js/main.js`：问答状态机、输入与海报流程
- `public/js/AudioFX.js`：原创程序化机械音效
- `public/assets/typewriter/layers/`：打字机、纸张、滚轴和键帽分层素材

完整产品说明见 [`PRODUCT_SPEC_TYPEWRITER.md`](./PRODUCT_SPEC_TYPEWRITER.md)。
