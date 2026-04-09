import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { Client } from "@notionhq/client";

// 初始化 Notion 客戶端
const notion = new Client({ auth: process.env.NOTION_TOKEN });

// 初始化 MCP 伺服器
const server = new McpServer({
  name: "Notion-Bridge",
  version: "1.0.0",
});

// 🛠️ 工具一：搜尋 Notion 工作區
server.tool(
  "search_notion",
  { query: z.string().describe("要搜尋的關鍵字") },
  async ({ query }) => {
    try {
      const response = await notion.search({ query, page_size: 5 });
      return { content: [{ type: "text", text: JSON.stringify(response.results) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `搜尋失敗: ${error.message}` }] };
    }
  }
);

// 🛠️ 工具二：讀取特定 Notion 頁面內容
server.tool(
  "read_notion_page",
  { page_id: z.string().describe("Notion 頁面的 ID") },
  async ({ page_id }) => {
    try {
      const response = await notion.pages.retrieve({ page_id });
      return { content: [{ type: "text", text: JSON.stringify(response) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `讀取失敗: ${error.message}` }] };
    }
  }
);

const app = express();

// 💡 修正 1：加入 CORS 標頭，並放行隱形小兵 (OPTIONS 預檢請求)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

// 🛡️ 安全驗證中介軟體 (現在不會擋掉 OPTIONS 了)
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedPassword = process.env.MY_AUTH_PASSWORD;
  
  if (expectedPassword && authHeader !== `Bearer ${expectedPassword}`) {
    console.warn(`未授權的連線嘗試: ${req.method} ${req.url}`);
    return res.status(401).send("Unauthorized");
  }
  next();
});

// 🌐 SSE 連線端點
let transport: SSEServerTransport;

app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
  console.log("Profet AI 已成功透過 SSE 連線！");
});

// 💡 修正 2：移除全域的 express.json()，避免吃掉 MCP SDK 的資料流
app.post("/messages", async (req, res) => {
  if (!transport) {
    return res.status(503).send("SSE transport not initialized");
  }
  await transport.handlePostMessage(req, res);
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Notion MCP 橋接器已啟動，正在監聽 Port ${port}...`);
});