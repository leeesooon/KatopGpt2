# 网络搜索功能实现总结

## 概述

为 KatopGPT 成功添加了完整的网络搜索功能，支持通过 Serper API 获取 Google 搜索结果，并将结果集成到 AI 对话中。

## 实现的功能

### 1. 核心功能
- ✅ Serper API 集成（Google 搜索结果）
- ✅ 自动检测需要搜索的查询（基于关键词启发式）
- ✅ 手动搜索开关（用户可控制）
- ✅ 搜索结果缓存（5分钟 TTL）
- ✅ 搜索失败优雅降级
- ✅ 内联引用标记 [1][2] 解析和渲染
- ✅ 搜索来源面板展示

### 2. 用户体验
- ✅ 设置面板中配置 Serper API Key
- ✅ 默认启用搜索开关
- ✅ 输入框搜索按钮（仅在配置 API Key 后显示）
- ✅ 搜索状态提示（控制台日志）
- ✅ 搜索失败提示（控制台日志）
- ✅ 引用链接可点击跳转

## 修改的文件

### 新增文件
1. **src/services/searchApi.ts** (218 行)
   - `webSearch()` - Serper API 调用
   - `formatSearchContext()` - 格式化搜索结果为 LLM 上下文
   - `shouldTriggerSearch()` - 自动检测是否需要搜索
   - `SearchCache` - 内存缓存实现
   - `SearchApiError` - 自定义错误类

2. **src/components/SourcesPanel.tsx** (38 行)
   - 搜索来源展示组件
   - 支持标题、URL、日期显示
   - 外部链接图标悬停效果

### 修改文件
1. **src/types/index.ts**
   - 新增 `SearchResult` 接口
   - 新增 `SearchState` 接口
   - `Message` 接口添加 `searchResults` 字段
   - `AppSettings` 接口添加 `serperApiKey` 和 `enableSearchByDefault` 字段
   - 更新 `DEFAULT_SETTINGS`

2. **src/store/chatStore.ts**
   - 版本升级：v4 → v5
   - 新增 `searchEnabled` 状态（transient）
   - 新增 `setSearchEnabled()` action
   - 新增 `attachSearchResults()` action
   - 更新 `updateSettings` 类型签名
   - 添加 v4→v5 迁移逻辑

3. **src/components/SettingsModal.tsx**
   - 新增 Serper API Key 输入框（带显示/隐藏切换）
   - 新增"默认启用网络搜索"开关
   - 更新 `handleSave` 保存新设置

4. **src/components/InputArea.tsx**
   - 新增搜索按钮（仅在配置 API Key 后显示）
   - 按钮状态根据 `searchEnabled` 动态变化
   - 集成 `useChatStore` 访问搜索状态

5. **src/components/MessageBubble.tsx**
   - 新增 `parseCitations()` 函数解析 [1][2] 标记
   - 集成 `SourcesPanel` 组件
   - 更新 ReactMarkdown 渲染逻辑支持引用链接

6. **src/components/ChatView.tsx**
   - 集成搜索流程到 `handleSend()`
   - 自动/手动搜索触发逻辑
   - 搜索结果格式化为 LLM 上下文
   - 搜索失败优雅降级
   - 搜索结果附加到 assistant 消息

## 技术细节

### 搜索触发逻辑
```typescript
// 混合模式：自动检测 + 用户手动控制
if ((searchEnabled || settings.enableSearchByDefault) && settings.serperApiKey) {
  const shouldSearch = searchEnabled || shouldTriggerSearch(messageContent)
  if (shouldSearch) {
    // 执行搜索
  }
}
```

### 搜索上下文注入
```typescript
// 将搜索结果注入到系统提示词
let enhancedSystemPrompt = settings.systemPrompt
if (searchContext) {
  enhancedSystemPrompt = `${settings.systemPrompt}

以下是网络搜索结果，请基于这些信息回答用户问题。在回答中使用 [1], [2] 等标记引用来源：

${searchContext}`
}
```

### 引用标记解析
```typescript
// 解析 [1], [2] 并转换为可点击链接
function parseCitations(text: string, sources: { url: string }[] = []) {
  const parts = text.split(/(\[\d+\])/g)
  return parts.map((part, index) => {
    const match = part.match(/\[(\d+)\]/)
    if (!match) return part
    const citationIndex = parseInt(match[1]) - 1
    const url = sources[citationIndex]?.url
    if (!url) return part
    return <a href={url} target="_blank">{part}</a>
  })
}
```

## 使用方法

### 1. 配置 API Key
1. 打开设置面板
2. 滚动到"网络搜索设置"部分
3. 输入 Serper API Key（从 https://serper.dev 获取）
4. 可选：启用"默认启用网络搜索"

### 2. 使用搜索
- **自动模式**：启用"默认启用网络搜索"后，AI 会自动检测需要搜索的问题
- **手动模式**：点击输入框左侧的搜索按钮启用/禁用搜索

### 3. 查看搜索结果
- AI 回答中的 [1], [2] 等标记可点击跳转到来源
- 回答下方显示完整的来源列表

## 搜索触发关键词

自动触发搜索的关键词包括：
- 时间相关：最新、最近、当前、新、今天、现在、今年、2024、2025、2026
- 信息查询：价格、新闻、更新、发布、公告
- 比较类：比较、对比、vs、versus、最好、推荐

不触发搜索的关键词：
- 创作类：写、创建、生成、总结、解释、翻译
- 个人相关：我的、我们的、私人、个人
- 请求类：帮我、请、能否、可以

## 性能优化

1. **缓存机制**：搜索结果缓存 5 分钟，避免重复请求
2. **Token 控制**：搜索上下文限制在 4000 tokens 以内
3. **非阻塞**：搜索失败不影响 AI 正常回答
4. **并发控制**：每次对话只执行一次搜索

## 已知限制

1. **语言支持**：当前仅优化中文搜索（`lr=lang_zh-CN`）
2. **搜索引擎**：仅支持 Serper API（Google 结果）
3. **免费额度**：Serper 免费 2500 次/月
4. **结果数量**：默认返回 8 条结果

## 未来改进方向

1. 支持多搜索引擎（Tavily、Google Custom Search）
2. 搜索结果预览（在发送前显示搜索结果）
3. 搜索历史记录
4. 更智能的搜索触发算法（基于 LLM 分类）
5. 搜索结果排序和过滤
6. 支持图片搜索

## 测试建议

1. **基础功能测试**
   - 配置 API Key 后搜索按钮是否显示
   - 手动启用搜索后按钮状态是否正确
   - 搜索结果是否正确显示在来源面板

2. **自动触发测试**
   - 询问"2026年最新科技新闻"是否自动触发搜索
   - 询问"帮我写一篇文章"是否不触发搜索

3. **引用测试**
   - AI 回答中的 [1], [2] 是否可点击
   - 点击后是否正确跳转到来源 URL

4. **错误处理测试**
   - 无效 API Key 是否优雅降级
   - 网络错误是否不影响 AI 回答

5. **缓存测试**
   - 相同查询是否使用缓存（查看控制台日志）

## 控制台日志

搜索功能会在控制台输出详细日志：
- `[Search Request]` - 搜索请求详情
- `[Search Response]` - 搜索结果摘要
- `[Search Cache]` - 缓存命中
- `[Search Error]` - 搜索失败详情

## 总结

成功为 KatopGPT 添加了完整的网络搜索功能，实现了：
- 混合触发模式（自动 + 手动）
- Serper API 集成
- 内联引用渲染
- 搜索来源展示
- 优雅的错误处理

所有功能已集成到现有架构中，遵循项目现有的代码风格和模式。
