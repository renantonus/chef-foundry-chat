/**
 * Conversor simples e SEGURO de markdown para HTML.
 * Primeiro escapa todo o HTML (para o agente nunca conseguir injetar código na página),
 * depois aplica só o básico: títulos, listas, negrito, itálico, código e parágrafos.
 */
(function () {
  "use strict";

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function inline(text) {
    return text
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  }

  function renderMarkdown(src) {
    const lines = escapeHtml(String(src || "").replace(/\r\n/g, "\n")).split("\n");
    const out = [];
    let list = null; // "ul" | "ol"
    let para = [];
    let code = null;

    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join("<br>"))}</p>`); para = []; } };
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (code === null) { flushPara(); closeList(); code = []; } else { out.push(`<pre><code>${code.join("\n")}</code></pre>`); code = null; }
        continue;
      }
      if (code !== null) { code.push(line); continue; }

      const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

      if (!line.trim()) { flushPara(); closeList(); continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); closeList(); out.push("<hr>"); continue; }
      if (heading) { flushPara(); closeList(); out.push(`<h3>${inline(heading[1])}</h3>`); continue; }
      if (bullet || numbered) {
        flushPara();
        const type = bullet ? "ul" : "ol";
        if (list !== type) { closeList(); out.push(`<${type}>`); list = type; }
        out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
        continue;
      }
      closeList();
      para.push(line);
    }
    if (code !== null) out.push(`<pre><code>${code.join("\n")}</code></pre>`);
    flushPara();
    closeList();
    return out.join("");
  }

  window.renderMarkdown = renderMarkdown;
})();
