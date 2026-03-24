import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://notebooklm.google.com/');

  console.log('👉 Войди в Google вручную');
  console.log('👉 После входа нажми ENTER в терминале');

  process.stdin.once('data', async () => {
    await context.storageState({ path: './.notebooklm/storage_state.json' });
    console.log('✅ storage_state.json обновлён');

    await browser.close();
    process.exit(0);
  });
})();