import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon } from 'lucide-react';

export default function Home() {
  const [playerName, setPlayerName] = useState('');
  const navigate = useNavigate();

  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      alert('名前を入力してください');
      return;
    }
    const roomId = Math.random().toString(36).substring(2, 9);
    navigate(`/room/${roomId}`, { state: { playerName } });
  };

  return (
    <div className="glass-panel" style={{ maxWidth: '400px', margin: '5vh auto', textAlign: 'center' }}>
      <Moon size={48} color="#a78bfa" style={{ marginBottom: '0.5rem', display: 'inline-block' }} />
      <h1>人狼 ONLINE</h1>
      <p style={{ marginBottom: '1.5rem', color: '#94a3b8' }}>友達とブラウザで遊べるリアルタイム人狼</p>
      
      <input 
        type="text" 
        className="input-field" 
        placeholder="あなたの名前" 
        value={playerName}
        onChange={(e) => setPlayerName(e.target.value)}
        maxLength={10}
      />
      
      <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem', marginBottom: '1.5rem' }} onClick={handleCreateRoom}>
        ルームを作成する
      </button>

      <div style={{ margin: '0 auto', display: 'flex', justifyContent: 'center' }}>
        <img 
          src="/wolf-girl.png" 
          alt="人狼少女" 
          style={{ 
            width: '320px', 
            height: 'auto', 
            display: 'block',
            borderRadius: '12px',
            filter: 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.4))'
          }} 
        />
      </div>
    </div>
  );
}
