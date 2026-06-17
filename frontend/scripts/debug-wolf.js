import { chromium } from 'playwright';
import readline from 'readline';

async function runDebug() {
  console.log('🔮 人狼複数時のターゲット同期のデバッグスクリプトを開始します...');
  const width = 500;
  const height = 400;
  const browsers = [];
  const pages = [];

  try {
    // 5人のプレイヤーを起動
    const playerNames = ['ホスト', '人狼A', '人狼B', '占い師', '騎士'];
    const positions = [
      { x: 0, y: 0 },
      { x: 510, y: 0 },
      { x: 1020, y: 0 },
      { x: 0, y: 420 },
      { x: 510, y: 420 }
    ];

    let roomUrl = '';

    for (let i = 0; i < 5; i++) {
      const name = playerNames[i];
      const pos = positions[i];
      console.log(`[Player ${name}] ブラウザ起動中...`);
      const browser = await chromium.launch({
        headless: process.env.HEADLESS === 'true',
        args: [
          `--window-position=${pos.x},${pos.y}`,
          `--window-size=${width},${height}`,
          `--no-first-run`
        ]
      });
      browsers.push(browser);
      const context = await browser.newContext({ viewport: null });
      const page = await context.newPage();
      pages.push(page);

      page.on('console', msg => {
        console.log(`[Browser ${name}] ${msg.type().toUpperCase()}: ${msg.text()}`);
      });

      page.on('pageerror', error => {
        console.error(`❌ [Browser ${name}] PAGE ERROR:`, error.message);
        if (error.stack) {
          console.error(error.stack);
        }
      });

      if (i === 0) {
        // ホストでルーム作成
        await page.goto('http://localhost:5173/');
        await page.click('.tt-root');
        await page.waitForSelector('.tf-input');
        await page.fill('.tf-input', name);
        await page.click('.tf-btn');
        await page.waitForURL(/\/room\//);
        roomUrl = page.url();
        console.log(`[Host] ルーム作成完了: ${roomUrl}`);
      } else {
        // ゲストで入室
        try {
          await page.goto(roomUrl);
          await page.waitForSelector('.tf-input', { timeout: 10000 });
          await page.fill('.tf-input', name);
          await page.click('.tf-btn');
          await page.waitForSelector('.player-grid');
          console.log(`[Guest ${i}] ${name} 入室完了`);
        } catch (err) {
          console.error(`❌ [Guest ${i}] ${name} 入室エラー:`, err.message);
          const html = await page.content();
          console.log(`[HTML of ${name}]:`, html.substring(0, 1500));
          throw err;
        }
      }
    }

    // ホスト（プレイヤー0）の画面で、役職プールを5人分にする
    // 初期役職プール：村人、人狼、占い師 (3人分)
    // 5人にするため、「人狼」と「騎士」を追加する
    const hostPage = pages[0];
    await hostPage.click('button:has-text("+ 人狼")');
    await hostPage.waitForTimeout(1000);
    await hostPage.click('button:has-text("+ 騎士")');
    await hostPage.waitForTimeout(1000);

    console.log('[Host] 役職プールの設定完了。ゲームを開始します。');
    await hostPage.click('button:has-text("ゲームを開始する")');

    // 夜フェーズになるのを待つ
    await hostPage.waitForSelector('h3:has-text("夜")');
    console.log('🌙 夜フェーズが開始されました。役職を確認中...');

    // 各プレイヤーの役職を調べる
    const playersRoles = [];
    for (let i = 0; i < 5; i++) {
      const page = pages[i];
      const name = playerNames[i];
      const roleText = await page.locator('.role-badge').first().innerText();
      console.log(`[Player] ${name} の役職: ${roleText}`);
      playersRoles.push({ index: i, name, role: roleText });
    }

    // 人狼プレイヤーを特定する
    const wolves = playersRoles.filter(p => p.role === '人狼');
    console.log(`🐺 人狼プレイヤーの数: ${wolves.length}`);
    wolves.forEach(w => console.log(`  - ${w.name} (Index: ${w.index})`));

    if (wolves.length >= 2) {
      // 1人目の人狼が誰かを襲撃ターゲットに選択して決定する
      const wolf1 = wolves[0];
      const wolf2 = wolves[1];
      console.log(`🐺 1人目の人狼 ${wolf1.name} がアクションを決定します...`);

      const wolf1Page = pages[wolf1.index];
      const wolf2Page = pages[wolf2.index];

      // 襲撃可能ターゲット（人狼以外）を探してクリックする
      // 人狼以外の生存プレイヤーのカード
      const nonWolves = playersRoles.filter(p => p.role !== '人狼');
      const target = nonWolves[0];
      console.log(`🎯 ターゲット: ${target.name} (Index: ${target.index})`);

      // カードをクリック
      await wolf1Page.click(`.player-card:has-text("${target.name}")`);
      await wolf1Page.waitForTimeout(500);

      // アクションを決定するボタンをクリック
      await wolf1Page.click('button:has-text("アクションを決定する")');
      console.log(`🐺 1人目の人狼 ${wolf1.name} が決定ボタンを押しました。`);

      // 2人目の人狼の画面で、同期がどうなっているか確認する
      await wolf2Page.waitForTimeout(2000); // 同期を待つ

      // サーバーから最新の roomState を取得してデバッグ出力
      const roomId = roomUrl.split('/').pop();
      const response = await fetch(`http://localhost:5173/api/room?roomId=${roomId}`);
      const apiRoomState = await response.json();
      console.log('📡 サーバーから取得した現在の roomState:');
      console.log(JSON.stringify(apiRoomState, null, 2));

      // 2人目の人狼の画面で、ターゲット以外のカードがグレーアウト（opacity: 0.4 / cursor: not-allowed）しているかチェック
      const classesAndStyles = await wolf2Page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.player-card'));
        return cards.map(c => {
          const nameEl = c.querySelector('div');
          const name = nameEl ? nameEl.innerText : 'Unknown';
          const style = window.getComputedStyle(c);
          return {
            name,
            opacity: style.opacity,
            cursor: style.cursor,
            boxShadow: style.boxShadow,
            borderColor: style.borderColor
          };
        });
      });

      console.log('🐺 2人目の人狼の画面のプレイヤーカードの状態:');
      console.log(JSON.stringify(classesAndStyles, null, 2));

    } else {
      console.log('⚠️ 人狼が2人以上いません。役職配分の結果、人狼が足りませんでした。');
    }

    if (process.env.HEADLESS !== 'true') {
      console.log('デバッグ完了。Enterキーを押すと終了します。');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      await new Promise((resolve) => rl.question('', () => { rl.close(); resolve(); }));
    } else {
      console.log('デバッグ完了。HEADLESSモードのため自動終了します。');
    }

  } catch (error) {
    console.error('❌ デバッグエラー:', error);
  } finally {
    for (const b of browsers) {
      await b.close().catch(() => {});
    }
  }
}

runDebug();
