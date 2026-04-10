import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { Client } from "@notionhq/client";

// 初始化 Notion
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const server = new McpServer({
  name: "Notion-Pro-Bridge",
  version: "2.1.0",
});

// 1. 搜尋工具
server.tool("search_notion", { query: z.string() }, async ({ query }) => {
  try {
    const response = await notion.search({ query, page_size: 5 });
    return { content: [{ type: "text", text: JSON.stringify(response.results) }] };
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }] };
  }
});

// 2. 讀取頁面工具
server.tool("get_page_content", { page_id: z.string() }, async ({ page_id }) => {
  try {
    const blocks = await notion.blocks.children.list({ block_id: page_id });
    return { content: [{ type: "text", text: JSON.stringify(blocks.results) }] };
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }] };
  }
});

// 3. 建立頁面工具
server.tool("create_notion_page", { parent_id: z.string(), title: z.string() }, async ({ parent_id, title }) => {
  try {
    const response = await notion.pages.create({
      parent: { page_id: parent_id },
      properties: { title: [{ text: { content: title } }] }
    });
    return { content: [{ type: "text", text: `成功建立: ${(response as any).url}` }] };
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }] };
  }
});

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

app.get("/", (req, res) => res.send("Notion MCP Server is Running!"));

// SSE 連線與防佔線機制
let transport: SSEServerTransport | null = null;

app.get("/sse", async (req, res) => {
  console.log("🔔 收到 SSE 連線請求");
  
  // 【關鍵修復】如果發現舊的連線，先把它掛斷，避免佔線崩潰
  if (transport) {
    console.log("🧹 發現舊連線，正在清理...");
    try {
      await transport.close();
    } catch (e) {
      console.error("清理連線時略過錯誤");
    }
  }

  transport = new SSEServerTransport("/messages", res);
  try {
    await server.connect(transport);
    console.log("✅ 新的 SSE 連線建立成功！");
  } catch (e: any) {
    console.error("⚠️ 建立連線失敗:", e.message);
  }
});

app.post("/messages", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(503).send("SSE not initialized");
  }
});

// 全域錯誤捕捉 (防止任何意外導致崩潰)
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

const port = process.env.PORT || 10000;
app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server 啟動於 port ${port}`);
});