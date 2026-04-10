import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { Client } from "@notionhq/client";

// 初始化 Notion 客戶端
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const server = new McpServer({
  name: "Notion-Professional-Bridge",
  version: "2.0.0",
});

// 1. 【搜尋工具】搜尋頁面或資料庫
server.tool("search_notion", { 
  query: z.string().describe("搜尋關鍵字") 
}, async ({ query }) => {
  const response = await notion.search({ query, page_size: 10 });
  return { content: [{ type: "text", text: JSON.stringify(response.results) }] };
});

// 2. 【讀取工具】獲取頁面詳細內容 (包含所有區塊)
server.tool("get_page_content", { 
  page_id: z.string().describe("Notion 頁面 ID") 
}, async ({ page_id }) => {
  const blocks = await notion.blocks.children.list({ block_id: page_id });
  return { content: [{ type: "text", text: JSON.stringify(blocks.results) }] };
});

// 3. 【建立工具】在指定父頁面下開立新頁面 (新專案)
server.tool("create_notion_page", {
  parent_id: z.string().describe("父頁面的 ID"),
  title: z.string().describe("新頁面的標題")
}, async ({ parent_id, title }) => {
  const response = await notion.pages.create({
    parent: { page_id: parent_id },
    properties: { title: [{ text: { content: title } }] }
  });
  return { content: [{ type: "text", text: `已成功建立頁面！網址：${(response as any).url}` }] };
});

// 4. 【寫入工具】在頁面末尾新增內容 (Append blocks)
server.tool("append_to_page", {
  page_id: z.string().describe("頁面 ID"),
  content: z.string().describe("要新增的文字內容")
}, async ({ page_id, content }) => {
  await notion.blocks.children.append({
    block_id: page_id,
    children: [{
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content } }] }
    }]
  });
  return { content: [{ type: "text", text: "內容已成功寫入頁面！" }] };
});

// --- 以下為 SSE 與 安全防護 邏輯 (保持不變) ---
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (process.env.MY_AUTH_PASSWORD && authHeader !== `Bearer ${process.env.MY_AUTH_PASSWORD}`) {
    return res.status(401).send("Unauthorized");
  }
  next();
});

let transport: SSEServerTransport | null = null;
app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (transport) await transport.handlePostMessage(req, res);
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => console.log(`🚀 全功能 Notion MCP 啟動在 Port ${port}`));