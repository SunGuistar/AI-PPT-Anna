// Stage 1: fixed-content PPTX pipeline + minimal LLM connectivity check.
import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

const TOOL_ID = "tool-dev-focus-flow";

async function main() {
  const status = document.getElementById("status");
  const pptxBtn = document.getElementById("pptx-btn");
  const llmBtn = document.getElementById("llm-btn");
  if (!status || !pptxBtn || !llmBtn) return;

  let anna;
  try {
    anna = await AnnaAppRuntime.connect();
  } catch (e) {
    status.textContent = "Standalone preview (no host).";
    return;
  }

  await anna.window.set_title({ title: "focus-flow" });
  status.textContent = "Ready.";

  pptxBtn.addEventListener("click", async () => {
    status.textContent = "生成中…";
    try {
      const out = await anna.tools.invoke({
        tool_id: TOOL_ID,
        method: "create_pptx",
        args: {},
      });
      if (!out.success) throw new Error(out.error || "tool_failed");
      const { path, filename, size_bytes } = out.data;
      // Official delivery: the host consumes the presigned URL at top level
      // and triggers the browser save.
      await anna.files.download({ path, filename });
      await anna.storage.set({ key: "focus-flow:last_pptx", value: path });
      status.textContent = `已生成并下载 ${filename}（${size_bytes} bytes）`;
    } catch (e) {
      status.textContent = "Error: " + (e.message || JSON.stringify(e));
    }
  });

  llmBtn.addEventListener("click", async () => {
    status.textContent = "LLM 调用中…";
    try {
      const res = await anna.llm.complete({
        messages: [
          { role: "user", content: { type: "text", text: "用一句话回答：1+1等于几？" } },
        ],
        maxTokens: 64,
      });
      const text = res.content?.text ?? JSON.stringify(res.content);
      status.textContent = `LLM OK（model: ${res.model}）\n${text}`;
    } catch (e) {
      status.textContent = "LLM Error: " + (e.message || JSON.stringify(e));
    }
  });
}

main();
