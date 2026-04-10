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

// --- 註冊工具 (全部加上 try-catch 防止崩潰) ---

// 1. 搜尋
server.tool("search_notion", { query: z.string() }, async ({ query }) => {
  try {
    const response = await notion.search({ query, page_size: 5 });
    return { content: [{ type: "text", text: JSON.stringify(response.results) }] };
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }] };
  }
});

// 2. 讀取頁面
server.tool("get_page_content", { page_id: z.string() }, async ({ page_id }) => {
  try {
    const blocks = await notion.blocks.children.list({ block_id: page_id });
    return { content: [{ type: "text", text: JSON.stringify(blocks.results) }] };
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }] };
  }
});

// 3. 建立頁面
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

// 💡 修正 502 的關鍵：不要使用全域 express.json()
// 因為 SSEServerTransport 會自己處理 POST body，全域解析會導致衝突
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// 健康檢查路徑 (用來測試 502)
app.get("/", (req, res) => res.send("Notion MCP Server is Running!"));

// SSE 連線
// SSE 連線
let transport: SSEServerTransport | null = null;

app.get("/sse", async (req, res) => {
  console.log("🔔 收到 SSE 連線請求");
  
  // 【關鍵修復】如果已經有舊的連線，先強制掛斷清理掉！
  if (transport) {
    console.log("🧹 清理舊的 SSE 連線...");
    try {
      await server.close();
    } catch (e) {
      console.error("關閉連線時發生錯誤", e);
    }
  }

  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
  console.log("✅ 新的 SSE 連線建立成功！");
});

app.post("/messages", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(503).send("SSE not initialized");
  }
});