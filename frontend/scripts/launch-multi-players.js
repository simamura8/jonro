import { chromium } from 'playwright';
import readline from 'readline';

// コマンドライン引数から起動する人数を取得する (デフォルト 5人)
const args = process.argv.slice(2);
let playerCount = 5;
for (const arg of args) {
  if (arg.startsWith('--count=')) {
    const count = parseInt(arg.split('=')[1], 10);
    if (!isNaN(count) && count > 0) {
      playerCount = count;
    }
  } else if (!isNaN(parseInt(arg, 10))) {
    playerCount = parseInt(arg, 10);
  }
}

// プレイヤー名定義
const playerNames = [
  'ホスト',
  '人狼A',
  '人狼B',
  '占い師',
  '騎士',
  '怪盗',
  '市民A',
  '市民B',
  '狂人',
  '霊媒師'
];

async function launchPlayers() {
  console.log(`🎮 ${playerCount} 人のプレイヤーでテストを開始します...`);

  const width = 600;
  const height = 480;
  const columns = 3;
  const xSpacing = 620;
  const ySpacing = 500;

  const browsers = [];
  const contexts = [];
  const pages = [];

  try {
    // 1. ホスト (Player 1) の起動とルーム作成
    const hostName = playerNames[0];
    console.log(`[Host] 起動中... (${hostName})`);

    const hostBrowser = await chromium.launch({
      headless: false,
      args: [
        `--window-position=0,0`,
        `--window-size=${width},${height}`,
        `--no-first-run`
      ]
    });
    browsers.push(hostBrowser);

    const hostContext = await hostBrowser.newContext({ viewport: null });
    contexts.push(hostContext);

    const hostPage = await hostContext.newPage();
    pages.push(hostPage);

    // ローカルホストを開く
    await hostPage.goto('http://localhost:5173/');
    
    // タイトル画面をクリックしてフォームへ進む
    await hostPage.click('.tt-root');
    await hostPage.waitForSelector('.tf-input');

    // 名前を入力してルーム作成
    await hostPage.fill('.tf-input', hostName);
    await hostPage.click('.tf-btn');

    // ルームID作成後のURL遷移を待つ
    await hostPage.waitForURL(/\/room\//);
    const roomUrl = hostPage.url();
    console.log(`[Host] ルームが作成されました: ${roomUrl}`);

    // 2. ゲスト (Player 2 〜 N) の起動と自動入室
    for (let i = 1; i < playerCount; i++) {
      const guestName = playerNames[i] || `プレイヤー${i + 1}`;
      
      // グリッド位置の計算
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = col * xSpacing;
      const y = row * ySpacing;

      console.log(`[Guest ${i}] 起動中... (${guestName} -> x:${x}, y:${y})`);

      const guestBrowser = await chromium.launch({
        headless: false,
        args: [
          `--window-position=${x},${y}`,
          `--window-size=${width},${height}`,
          `--no-first-run`
        ]
      });
      browsers.push(guestBrowser);

      const guestContext = await guestBrowser.newContext({ viewport: null });
      contexts.push(guestContext);

      const guestPage = await guestContext.newPage();
      pages.push(guestPage);

      // 直接ルームURLを開く
      await guestPage.goto(roomUrl);
      
      // 名前入力画面を待つ
      await guestPage.waitForSelector('.tf-input');
      
      // 名前を入力して入室
      await guestPage.fill('.tf-input', guestName);
      await guestPage.click('.tf-btn');

      // 入室完了を待つ (プレイヤー一覧の表示)
      await guestPage.waitForSelector('.player-grid');
      console.log(`[Guest ${i}] 入室完了: ${guestName}`);
    }

    console.log('\n✨ すべてのプレイヤーが入室しました！');
    console.log('手動でブラウザを操作してテストを行ってください。');
    console.log('ブラウザを閉じて終了するには、このターミナルで Enter キーを押してください。\n');

    // Enter待ちでプロセスをキープ
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    await new Promise((resolve) => {
      rl.question('', () => {
        rl.close();
        resolve();
      });
    });

  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
  } finally {
    console.log('🧹 ブラウザを閉じています...');
    for (const browser of browsers) {
      await browser.close().catch(() => {});
    }
    console.log('👋 終了しました。');
    process.exit(0);
  }
}

launchPlayers();
