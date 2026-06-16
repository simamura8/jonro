import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './title.css';

// ホタルのようなパーティクルを生成するコンポーネント
function Particles() {
  const particles = Array.from({ length: 28 }, (_, i) => {
    const size   = Math.random() * 5 + 3;
    const startX = Math.random() * 100;
    const startY = Math.random() * 100;
    const dx = (Math.random() - 0.5) * 200;
    const dy = -(Math.random() * 300 + 100);
    const duration = Math.random() * 6 + 5;
    const delay    = Math.random() * 8;
    return { id: i, size, startX, startY, dx, dy, duration, delay };
  });

  return (
    <div className="tt-particles" aria-hidden="true">
      {particles.map((p) => (
        <div
          key={p.id}
          className="tt-particle"
          style={{
            width:  p.size,
            height: p.size,
            left:   `${p.startX}%`,
            top:    `${p.startY}%`,
            '--dx': `${p.dx}px`,
            '--dy': `${p.dy}px`,
            animationDuration:  `${p.duration}s`,
            animationDelay:     `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function Home() {
  const [phase, setPhase]     = useState('title'); // 'title' | 'exiting' | 'form'
  const [playerName, setPlayerName] = useState('');
  const navigate  = useNavigate();
  const inputRef  = useRef(null);

  // フォーム表示後にオートフォーカス
  useEffect(() => {
    if (phase === 'form') {
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [phase]);

  // タイトル画面クリック → フェードアウト → フォーム表示
  const handleTitleClick = () => {
    if (phase !== 'title') return;
    setPhase('exiting');
    setTimeout(() => setPhase('form'), 780); // tt-exit アニメーション(0.8s)に合わせる
  };

  // Enterキーでもスタート
  const handleTitleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') handleTitleClick();
  };

  const handleCreateRoom = () => {
    if (!playerName.trim()) return;
    const roomId = Math.random().toString(36).substring(2, 9);
    navigate(`/room/${roomId}`, { state: { playerName } });
  };

  const handleInputKey = (e) => {
    if (e.key === 'Enter') handleCreateRoom();
  };

  /* ─────────────────────────────────────────
     タイトル画面
  ───────────────────────────────────────── */
  if (phase === 'title' || phase === 'exiting') {
    return (
      <div
        className={`tt-root${phase === 'exiting' ? ' tt-exit' : ''}`}
        onClick={handleTitleClick}
        onKeyDown={handleTitleKey}
        role="button"
        tabIndex={0}
        aria-label="クリックしてスタート"
      >
        {/* 背景画像 */}
        <div className="tt-bg" />

        {/* 暗めオーバーレイ */}
        <div className="tt-overlay" />

        {/* ホタルパーティクル */}
        <Particles />

        {/* テキスト・ボタン */}
        <div className="tt-content">
          {/* 上部タイトルブロック */}
          <header className="tt-header">
            <span className="tt-badge">🌙 Online Multiplayer Werewolf</span>
            <h1 className="tt-title-jp">
              みんなで人狼
              <span className="tt-title-en">ONLINE</span>
            </h1>
            <p className="tt-tagline">闇夜の森で、誰が人狼か見抜け。</p>
          </header>

          {/* 下部ボタンブロック */}
          <footer className="tt-footer">
            <button className="tt-cta" tabIndex={-1} aria-hidden="true">
              <span className="tt-cta-lantern">🏮</span>
              クリックしてスタート
              <span className="tt-cta-lantern">🏮</span>
            </button>
            <p className="tt-hint">Click or Press Enter to continue</p>
          </footer>
        </div>
      </div>
    );
  }

  /* ─────────────────────────────────────────
     名前入力フォーム画面
  ───────────────────────────────────────── */
  return (
    <div className="tf-root">
      {/* ぼかし背景 */}
      <div className="tf-bg" />
      <div className="tf-overlay" />

      {/* カード */}
      <div className="tf-card">
        <img
          src="/wolf-girl.png"
          alt="人狼少女"
          className="tf-char"
          draggable="false"
        />

        <h2 className="tf-title">みんなで人狼ONLINE</h2>
        <p className="tf-sub">友達とブラウザで遊べるリアルタイム人狼ゲーム</p>

        <label className="tf-label" htmlFor="player-name">
          🌙 プレイヤー名
        </label>
        <input
          id="player-name"
          ref={inputRef}
          type="text"
          className="tf-input"
          placeholder="名前を入力してください"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          onKeyDown={handleInputKey}
          maxLength={10}
        />
        <button
          className="tf-btn"
          onClick={handleCreateRoom}
          disabled={!playerName.trim()}
        >
          🏮 ルームを作成する
        </button>
      </div>
    </div>
  );
}
