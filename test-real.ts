import { compress, decompress, revise, threadStatus, serialize } from "./packages/core/src/index.js";
import type { Message } from "./packages/core/src/types.js";

// Real conversation: multi-topic dev session
const conversation: Message[] = [
  { role: "user", content: "I'm building an auction agent that scrapes GSA API for surplus government equipment. What stack should I use?" },
  { role: "assistant", content: "For a scraping + analysis pipeline, I'd recommend TypeScript with Node.js. Let's go with Hono for the API layer since it's lightweight and runs on Cloudflare Workers. For the database, D1 (Cloudflare's SQLite) keeps everything in one ecosystem." },
  { role: "user", content: "Good call. What about pricing? I need to compare GSA prices against eBay sold listings to find arbitrage opportunities." },
  { role: "assistant", content: "For eBay pricing, use the eBay Browse API — it gives you sold item data. You'll need to compute a spread: (eBay median sold price - GSA asking price) / GSA price. Filter for spreads > 30% to account for shipping, fees, and risk. Store historical price data in D1 for trend analysis." },
  { role: "user", content: "Actually, let me also ask about something totally different. I'm working on a macOS desktop app called Claudio — it's a platformer game where a character runs across your actual desktop." },
  { role: "assistant", content: "Cool concept! For a macOS overlay game, you'll want a transparent NSWindow with SpriteKit for rendering. The key challenge is click-through — you need the window to be non-interactive in areas without game elements so users can still click their desktop. Use NSWindow.Level.floating and set ignoresMouseEvents selectively." },
  { role: "user", content: "Yeah the click-through is the hardest part. I tried making the whole window click-through but then you can't interact with the game character." },
  { role: "assistant", content: "The trick is to use an invisible physics body approach: keep the overlay window click-through everywhere, but place invisible hit-test regions only where interactive game elements are. Use hitTest() on the SpriteKit scene and forward mouse events only when they land on a game node. Never duplicate the desktop visuals — just overlay the game sprites." },
  { role: "user", content: "Back to the auction agent — should I also scrape PublicSurplus and Municibid?" },
  { role: "assistant", content: "Definitely. PublicSurplus and Municibid are the next tier after GSA. GovDeals too. But these don't have official APIs — you'll need browser automation (Playwright) or HTML parsing. Start with GSA since it has a clean API, then add scrapers for the others. Priority: GSA API → PublicSurplus → GovDeals → Municibid." },
  { role: "user", content: "What about rate limiting for the scrapers?" },
  { role: "assistant", content: "For GSA's official API, respect their rate limits (usually 1000 req/hour). For the scraper targets, be conservative: 1 request every 3-5 seconds with randomized delays. Use rotating residential proxies for PublicSurplus — they're aggressive with blocking. Municibid is more lenient. Always implement exponential backoff on 429s." },
  { role: "user", content: "One more thing on Claudio — there's a bug where the character falls through the taskbar. The physics body isn't aligned with the screen bottom." },
  { role: "assistant", content: "The taskbar height varies by macOS version and display scaling. Don't hardcode it. Use NSScreen.main?.visibleFrame to get the actual usable area (excludes menu bar and dock). Set your SpriteKit physics boundary to match visibleFrame, not the full screen frame. The difference between frame and visibleFrame is exactly the dock/menu bar height." },
  { role: "user", content: "Perfect, that fixed it. Now I want to add a resume builder to my Winstack project — it should let people edit PDFs inline." },
  { role: "assistant", content: "For inline PDF editing in a web app, pdf-lib is the best library — it can modify existing PDFs without a server. Combine it with a canvas-based WYSIWYG editor for positioning text and elements. The flow: upload PDF → render pages to canvas → overlay editable text fields → on save, merge edits back into the PDF using pdf-lib. Store the career data separately in your MCP server so the same data can generate multiple tailored resumes." },
  { role: "user", content: "Should I use react-pdf or pdf.js for the rendering?" },
  { role: "assistant", content: "pdf.js (via pdfjs-dist) for rendering — it's Mozilla's battle-tested PDF renderer. react-pdf is a wrapper around it but adds abstraction you don't need for an editor. Render each page to a canvas, then overlay absolutely-positioned contenteditable divs for the text fields. This gives you pixel-perfect PDF display with editable overlays." },
];

console.log("=== COMPRESSING REAL CONVERSATION ===\n");
console.log(`Input: ${conversation.length} messages`);
console.log(`Input tokens (est): ${conversation.reduce((a, m) => a + Math.ceil(m.content.length / 4), 0)}`);

const blob = await compress(conversation);
console.log(`\nThreads detected: ${blob.threads.length}`);
console.log(`Compression ratio: ${blob.metadata.compressionRatio.toFixed(2)}x`);
console.log(`Original tokens: ${blob.metadata.totalTokensOriginal}`);
console.log(`Compressed tokens: ${blob.metadata.totalTokensCompressed}`);

console.log("\n=== THREAD STATUS ===\n");
const status = threadStatus(blob);
for (const t of status.threads) {
  console.log(`[${t.tier.toUpperCase().padEnd(8)}] ${t.label}`);
  console.log(`           chunks: ${t.chunkCount}, facts: ${t.factCount}, revision: ${t.revision}`);
}

console.log("\n=== DECOMPRESSED OUTPUT (what a new model sees) ===\n");
const output = decompress(blob);
for (const msg of output) {
  console.log(`--- Thread: ${msg.metadata.threadId} [${msg.metadata.tier}] ---`);
  console.log(msg.content);
  console.log();
}

// Test serialization size
const buffer = serialize(blob);
const rawSize = JSON.stringify(conversation).length;
console.log("=== STORAGE ===\n");
console.log(`Raw conversation JSON: ${rawSize} bytes`);
console.log(`.tmf blob (gzipped):   ${buffer.length} bytes`);
console.log(`Storage savings:       ${((1 - buffer.length / rawSize) * 100).toFixed(1)}%`);

// Test revision
console.log("\n=== REVISING WITH NEW MESSAGES ===\n");
const newMessages: Message[] = [
  { role: "user", content: "Update on the auction agent: I got the GSA API key and the first batch of results looks great. Found a lot of IT equipment." },
  { role: "assistant", content: "Great progress! IT equipment (servers, monitors, laptops) typically has the best resale margins on eBay. Focus on enterprise-grade gear — Dell PowerEdge servers, Cisco switches, and ThinkPads have strong secondary markets. Create category filters in your dashboard to surface these first." },
];

const revised = await revise(blob, newMessages);
console.log(`Threads after revision: ${revised.threads.length}`);
console.log(`New compression ratio:  ${revised.metadata.compressionRatio.toFixed(2)}x`);

const revisedStatus = threadStatus(revised);
for (const t of revisedStatus.threads) {
  const rev = t.revision > 0 ? ` (revised ${t.revision}x)` : "";
  console.log(`[${t.tier.toUpperCase().padEnd(8)}] ${t.label}${rev}`);
}
