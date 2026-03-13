# 快速测试指南 - 搜索功能修复验证

## 问题修复总结

已修复两个关键 bug：
1. ✅ `handleSaveGeneral` 函数没有保存搜索设置
2. ✅ chatStore.ts 中有重复的 v4→v5 迁移代码

## 测试步骤

### 步骤 1：清除旧数据（重要！）

由于之前的 bug，你的浏览器 localStorage 中可能有不完整的数据。需要清除：

1. 打开 KatopGPT
2. 按 `F12` 打开开发者工具
3. 切换到 "Console" 标签
4. 输入以下命令并回车：
   ```javascript
   localStorage.clear()
   ```
5. 刷新页面（`Ctrl+R` 或 `F5`）

### 步骤 2：配置搜索引擎

1. 点击设置按钮（齿轮图标）
2. 滚动到 "网络搜索设置" 部分
3. 在 "搜索引擎" 下拉菜单中选择 **"Tavily（推荐，免费1000次/月）"**
4. **验证**：下方应该立即显示 "Tavily API Key" 输入框
   - ✅ 如果显示了输入框 → Bug 已修复
   - ❌ 如果没有显示 → 截图并告诉我

### 步骤 3：输入 API Key

1. 在 "Tavily API Key" 输入框中输入你的 API Key
2. 点击 "保存" 按钮
3. 关闭设置面板

### 步骤 4：验证搜索按钮

1. 查看输入框左侧
2. **验证**：应该显示一个搜索按钮（🔍）
   - ✅ 如果显示了搜索按钮 → 完全修复成功
   - ❌ 如果没有显示 → 按 F12 打开控制台，输入以下命令查看状态：
     ```javascript
     JSON.parse(localStorage.getItem('katop-gpt-storage')).state.settings
     ```
     截图控制台输出并告诉我

### 步骤 5：测试搜索功能

1. 点击搜索按钮（🔍）启用搜索（按钮应该变成蓝色高亮）
2. 输入一个测试问题，例如："2026年最新科技新闻"
3. 发送消息
4. 按 F12 打开控制台，查看是否有搜索日志：
   - 应该看到 `[Search Request]` 和 `[Search Response]` 日志
   - AI 回答中应该包含 [1], [2] 等引用标记
   - 回答下方应该显示 "来源" 面板

## 如果还有问题

如果按照上述步骤操作后仍然有问题，请提供：

1. 截图：设置面板中的 "网络搜索设置" 部分
2. 截图：输入框区域（显示是否有搜索按钮）
3. 控制台输出：
   ```javascript
   JSON.parse(localStorage.getItem('katop-gpt-storage')).state.settings
   ```

## 注册 Tavily API Key

如果你还没有 Tavily API Key：

1. 访问 https://tavily.com
2. 点击 "Sign Up" 注册（使用邮箱，无需信用卡）
3. 登录后在 Dashboard 找到 API Key
4. 复制并粘贴到 KatopGPT 设置中

免费额度：1000 次搜索/月
