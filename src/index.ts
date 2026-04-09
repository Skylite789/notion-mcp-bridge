import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { Client } from "@notionhq/client";

// 初始化 Notion 客戶端
const notion = new Client({ auth: process.env.NOTION_TOKEN });

// 初始化 MCP 伺服器
const server = new McpServer({
  name: "Notion-Zeabur-Bridge",
  version: "1.0.0",
});

// 🛠️ 工具一：搜尋 Notion 工作區
server.tool(
  "search_notion",
  { query: z.string().describe("要搜尋的關鍵字") },
  async ({ query }) => {
    try {
      const response = await notion.search({
        query,
        page_size: 5,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response.results) }],
      };
    } catch (error: any) {
      return { content: [{ type: "text", text: `搜尋失敗: ${error.message}` }] };
    }
  }
);

// 🛠️ 工具二：讀取特定 Notion 頁面內容
server.tool(
  "read_notion_page",
  { page_id: z.string().describe("Notion 頁面的 ID (不含橫槓也可)") },
  async ({ page_id }) => {
    try {
      const response = await notion.pages.retrieve({ page_id });
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    } catch (error: any) {
      return { content: [{ type: "text", text: `讀取失敗: ${error.message}` }] };
    }
  }
);

// 啟動 Express 伺服器
const app = express();
app.use(express.json());

// 🛡️ 安全驗證中介軟體
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedPassword = process.env.MY_AUTH_PASSWORD;
  
  if (expectedPassword && authHeader !== `Bearer ${expectedPassword}`) {
    console.warn("未授權的連線嘗試");
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

app.post("/messages", async (req, res) => {
  if (!transport) {
    return res.status(503).send("SSE transport not initialized");
  }
  await transport.handlePostMessage(req, res);
});

// 🚀 啟動伺服器
const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Notion MCP 橋接器已啟動，正在監聽 Port ${port}...`);
});