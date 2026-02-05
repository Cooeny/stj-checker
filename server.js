const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

app.get("/stj/informativo", async (req, res) => {
  const query = String(req.query.query || "").trim();
  if (!query) return res.json({ ok: false, error: "Missing query" });

  const urlBase = "https://processo.stj.jus.br/jurisprudencia/externo/informativo/";
  let browser;

  try {
    browser = await chromium.launch({   headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"] });

    const context = await browser.newContext({
      locale: "pt-BR",
      viewport: { width: 1366, height: 768 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
    });

    const page = await context.newPage();

    await page.goto(urlBase, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(1500);

    // ✅ espera carregar input real do informativo
    const input = page.locator("#livreInf");
    if (!(await input.count())) {
      await page.screenshot({ path: "stj_sem_input.png", fullPage: true }).catch(() => {});
      return res.json({
        ok: false,
        query,
        error: "Não achei o input #livreInf (talvez o STJ mudou a página ou bloqueou).",
        screenshot: "stj_sem_input.png"
      });
    }

    await input.waitFor({ state: "visible", timeout: 20000 });

    // digita
    await input.click();
    await input.fill("");
    await input.type(query, { delay: 35 });

    // ✅ lupa real
    const lupa = page.locator("button.btn-search-inf");
    if (!(await lupa.count())) {
      await page.screenshot({ path: "stj_sem_lupa.png", fullPage: true }).catch(() => {});
      return res.json({
        ok: false,
        query,
        error: "Não achei o botão lupa button.btn-search-inf.",
        screenshot: "stj_sem_lupa.png"
      });
    }

    await lupa.waitFor({ state: "visible", timeout: 20000 });
    await lupa.click();

    // ✅ espera aparecer texto de resultado
    await page.waitForFunction(() => {
      const t = document.body ? document.body.innerText : "";
      return (
        /Nenhum documento encontrado/i.test(t) ||
        /Notas encontradas:/i.test(t) ||
        /Informativo\s*n[ºo]/i.test(t)
      );
    }, { timeout: 20000 }).catch(() => {});

    const bodyText = await page.evaluate(() => document.body?.innerText || "");

    // SEM RESULTADO
    if (/Nenhum documento encontrado/i.test(bodyText)) {
      return res.json({
        ok: true,
        query,
        hasResults: false,
        notes: 0,
        url: `${urlBase}?acao=pesquisar&livre=${encodeURIComponent(query)}`
      });
    }

    // tenta extrair notas
    const m = bodyText.match(/Notas encontradas:\s*(\d+)/i);
    const notes = m ? Number(m[1]) : null;

    const hasResults =
      (notes !== null && !Number.isNaN(notes) && notes > 0) ||
      /Informativo\s*n[ºo]/i.test(bodyText);

    return res.json({
      ok: true,
      query,
      hasResults,
      notes,
      url: `${urlBase}?acao=pesquisar&livre=${encodeURIComponent(query)}`
    });

  } catch (e) {
    return res.json({ ok: false, query, error: e.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando na porta", PORT));
