import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import PartySocket from 'partysocket';
import { Copy, Play, Send, Moon, Sun, Skull, Trophy } from 'lucide-react';

const PARTY_URL = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999';

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [socket, setSocket] = useState(null);
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [isNameSet, setIsNameSet] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [actionDone, setActionDone] = useState(false);
  const messagesEndRef = useRef(null);

  const location = useLocation();

  useEffect(() => {
    if (location.state?.playerName) {
      setPlayerName(location.state.playerName);
      setIsNameSet(true);
    }
  }, [location.state]);

  const emit = (type, payload) => {
    if (socket) {
      socket.send(JSON.stringify({ type, payload }));
    }
  };

  useEffect(() => {
    if (!isNameSet) return;

    const newSocket = new PartySocket({
      host: PARTY_URL,
      room: roomId,
    });
    setSocket(newSocket);

    newSocket.addEventListener("open", () => {
      newSocket.send(JSON.stringify({ type: 'join_room', payload: { playerName } }));
    });

    newSocket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'room_update') {
        setRoom(data.payload);
        setSelectedPlayerId(null);
        setActionDone(false);
      } else if (data.type === 'chat_message') {
        setMessages((prev) => [...prev, data.payload]);
      }
    });

    return () => newSocket.close();
  }, [roomId, isNameSet, playerName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleJoinRoom = () => {
    if (!playerName.trim()) {
      alert('名前を入力してください');
      return;
    }
    setIsNameSet(true);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert('URLをコピーしました！友達に共有してください。');
  };

  const handleStartGame = () => {
    emit('start_game');
  };

  const handleRestartGame = () => {
    emit('restart_game');
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    emit('send_message', { text: chatInput });
    setChatInput('');
  };

  const handleNightAction = () => {
    emit('night_action', { targetId: selectedPlayerId });
    setActionDone(true);
  };

  const handleVote = () => {
    emit('vote', { targetId: selectedPlayerId });
    setActionDone(true);
  };

  const handleGoToVote = () => {
    emit('change_phase', { phase: 'voting' });
  };

  if (!isNameSet) {
    return (
      <div className="container">
        <div className="glass-panel" style={{ maxWidth: '400px', margin: '10vh auto', textAlign: 'center' }}>
          <h2>ルームに参加</h2>
          <p style={{ marginBottom: '2rem', color: '#94a3b8' }}>ルーム: {roomId}</p>
          <input 
            type="text" 
            className="input-field" 
            placeholder="あなたの名前" 
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={10}
          />
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleJoinRoom}>
            ルームに参加する
          </button>
        </div>
      </div>
    );
  }

  if (!room) {
    return <div className="container" style={{ textAlign: 'center', marginTop: '20vh' }}>読み込み中...</div>;
  }

  const myPlayer = room.players[socket?.id];
  const isHost = Object.keys(room.players)[0] === socket?.id;
  const playersList = Object.values(room.players);

  const getRoleClass = (role) => {
    switch(role) {
      case '村人': return 'role-villager';
      case '人狼': return 'role-werewolf';
      case '占い師': return 'role-seer';
      case '騎士': return 'role-knight';
      case '狂人': return 'role-madman';
      case '霊媒師': return 'role-medium';
      default: return '';
    }
  };

  const handleAddRole = (role) => {
    emit('update_roles', { roles: [...room.rolePool, role] });
  };

  const handleRemoveRole = (indexToRemove) => {
    const newRoles = room.rolePool.filter((_, idx) => idx !== indexToRemove);
    emit('update_roles', { roles: newRoles });
  };

  const isRoleAddable = (role) => {
    if (role === '村人' || role === '人狼') return true;
    return !room.rolePool.includes(role);
  };

  return (
    <div className="container" style={{ paddingBottom: '2rem' }}>
      <div className="glass-panel" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>ルーム: {roomId}</h2>
          <button className="btn" style={{ background: 'rgba(255,255,255,0.1)', color: 'white' }} onClick={handleCopyLink}>
            <Copy size={18} /> URLを共有
          </button>
        </div>
        
        {room.status === 'waiting' && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px' }}>
            <p>参加者を待っています... (現在 {playersList.length} 人)</p>
            
            <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem' }}>役職構成 (計 {room.rolePool?.length || 0} 人分)</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                {room.rolePool?.map((role, idx) => (
                  <div key={idx} className={`role-badge ${getRoleClass(role)}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                    {role}
                    {isHost && idx >= 3 && (
                      <span style={{ cursor: 'pointer', fontWeight: 'bold' }} onClick={() => handleRemoveRole(idx)}>×</span>
                    )}
                  </div>
                ))}
              </div>
              
              {isHost && (
                <div>
                  <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: '#94a3b8' }}>役職を追加：</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {['村人', '人狼', '占い師', '騎士', '狂人', '霊媒師'].map(role => (
                      <button 
                        key={role}
                        className="btn"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }}
                        disabled={!isRoleAddable(role)}
                        onClick={() => handleAddRole(role)}
                      >
                        + {role}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {isHost && (
              <div style={{ marginTop: '1.5rem' }}>
                <button 
                  className="btn btn-primary" 
                  disabled={playersList.length !== room.rolePool?.length}
                  onClick={handleStartGame}
                >
                  <Play size={18} /> ゲームを開始する
                </button>
                {playersList.length !== room.rolePool?.length && (
                  <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                    ※参加人数（{playersList.length}人）と役職の数（{room.rolePool?.length || 0}人分）を一致させてください。
                  </p>
                )}
              </div>
            )}
            
            {!isHost && (
              <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '1rem' }}>ホストがゲームを開始するのを待っています...</p>
            )}
          </div>
        )}

        {room.status === 'finished' && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(251, 191, 36, 0.1)', borderRadius: '8px', textAlign: 'center' }}>
            <h3 style={{ color: '#fbbf24', margin: '0 0 1rem 0' }}>ゲーム終了</h3>
            {isHost ? (
              <button className="btn btn-primary" onClick={handleRestartGame}>
                もう一度遊ぶ（同じメンバーで）
              </button>
            ) : (
              <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>ホストが「もう一度遊ぶ」を選択するのを待っています...</p>
            )}
          </div>
        )}

        {room.status !== 'waiting' && myPlayer && (
          <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {room.status === 'day' && <Sun color="#fbbf24" />}
                {room.status === 'night' && <Moon color="#a78bfa" />}
                {room.status === 'voting' && <Skull color="#ef4444" />}
                {room.status === 'finished' && <Trophy color="#fbbf24" />}
                {room.status === 'day' && `昼 (Day ${room.dayCount})`}
                {room.status === 'night' && `夜 (Day ${room.dayCount})`}
                {room.status === 'voting' && '投票時間'}
                {room.status === 'finished' && '結果発表'}
              </h3>
            </div>
            {myPlayer.role && (
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>あなたの役職:</span>
                <div className={`role-badge ${getRoleClass(myPlayer.role)}`} style={{ fontSize: '1rem', padding: '0.25rem 0.75rem', marginLeft: '0.5rem' }}>
                  {myPlayer.role}
                </div>
                {!myPlayer.isAlive && <span style={{ color: '#ef4444', marginLeft: '0.5rem', fontWeight: 'bold' }}>[死亡]</span>}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        {/* 左側：プレイヤー一覧とアクション */}
        <div style={{ flex: '1 1 300px' }}>
          <div className="glass-panel">
            <h3>プレイヤー</h3>
            <div className="player-grid">
              {playersList.map((p) => {
                const isCandidate = !room.candidates || room.candidates.includes(p.id);
                const isSelectable = p.isAlive && !actionDone && (
                  room.status === 'night' || (room.status === 'voting' && isCandidate)
                );

                const isSelected = selectedPlayerId === p.id;

                const notCandidateStyle = room.status === 'voting' && room.candidates && !room.candidates.includes(p.id) 
                  ? { opacity: 0.3, cursor: 'not-allowed' } 
                  : {};
                  
                const candidateStyle = room.status === 'voting' && room.candidates && room.candidates.includes(p.id) && !isSelected
                  ? { boxShadow: '0 0 10px #fbbf24', borderColor: '#fbbf24' }
                  : {};

                const selectedStyle = isSelected
                  ? { boxShadow: '0 0 15px #3b82f6', borderColor: '#3b82f6', transform: 'scale(1.05)', zIndex: 10 }
                  : {};

                return (
                  <div 
                    key={p.id} 
                    className={`player-card ${!p.isAlive ? 'dead' : ''} ${isSelected ? 'selected' : ''}`}
                    style={{ ...notCandidateStyle, ...candidateStyle, ...selectedStyle }}
                    onClick={() => {
                      if (isSelectable) {
                        setSelectedPlayerId(p.id);
                      }
                    }}
                  >
                    <div style={{ fontWeight: 'bold' }}>{p.name}</div>
                    {/* 人狼同士は仲間が見える */}
                    {myPlayer?.role === '人狼' && p.role === '人狼' && room.status !== 'waiting' && (
                      <div className="role-badge role-werewolf" style={{ fontSize: '0.6rem' }}>人狼</div>
                    )}
                    {/* 終了時は全員の役職を表示 */}
                    {room.status === 'finished' && p.role && (
                      <div className={`role-badge ${getRoleClass(p.role)}`} style={{ fontSize: '0.6rem' }}>{p.role}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* アクションエリア */}
            {myPlayer?.isAlive && room.status === 'night' && !actionDone && (
              <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                <p style={{ marginBottom: '1rem' }}>
                  {myPlayer.role === '村人' ? 'あなたは村人です。夜は何もできません。完了ボタンを押してください。' :
                   myPlayer.role === '狂人' ? 'あなたは狂人です。人狼に加担しますが、誰が人狼かはわかりません。夜は何もできません。完了ボタンを押してください。' :
                   myPlayer.role === '霊媒師' ? 'あなたは霊媒師です。処刑されたプレイヤーの正体を知ることができます。夜のアクションはありません。完了ボタンを押してください。' :
                   myPlayer.role === '人狼' ? '襲撃する相手を選んでください。' :
                   myPlayer.role === '占い師' ? '占う相手を選んでください。' :
                   '護衛する相手を選んでください。'}
                </p>
                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%' }}
                  disabled={(myPlayer.role !== '村人' && myPlayer.role !== '狂人' && myPlayer.role !== '霊媒師') && !selectedPlayerId}
                  onClick={handleNightAction}
                >
                  アクションを決定する
                </button>
              </div>
            )}

            {myPlayer?.isAlive && room.status === 'voting' && !actionDone && (
              <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>
                <p style={{ marginBottom: '1rem' }}>
                  {room.candidates ? '決選投票（再投票）です。候補者から選んでください。' : '処刑する相手を選んでください。'}
                </p>
                <button 
                  className="btn btn-danger" 
                  style={{ width: '100%' }}
                  disabled={!selectedPlayerId}
                  onClick={handleVote}
                >
                  投票する
                </button>
              </div>
            )}

            {actionDone && room.status !== 'finished' && (
              <div style={{ marginTop: '1.5rem', textAlign: 'center', color: '#94a3b8' }}>
                他のプレイヤーを待っています...
              </div>
            )}

            {room.status === 'day' && isHost && (
              <button className="btn btn-danger" style={{ width: '100%', marginTop: '1.5rem' }} onClick={handleGoToVote}>
                議論を終了し投票へ進む
              </button>
            )}
          </div>
        </div>

        {/* 右側：チャット */}
        <div style={{ flex: '1 1 400px' }}>
          <div className="glass-panel" style={{ height: '100%', padding: '1rem' }}>
            <h3 style={{ margin: '0 0 1rem 0' }}>チャットログ</h3>
            <div className="chat-container" style={{ marginTop: 0 }}>
              <div className="chat-messages">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`message ${msg.isSystem ? 'system' : msg.sender === myPlayer?.name ? 'me' : ''}`}>
                    {!msg.isSystem && msg.sender !== myPlayer?.name && (
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>{msg.sender}</div>
                    )}
                    {msg.text}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              {room.status !== 'waiting' && myPlayer?.isAlive && (
                <form className="chat-input-area" onSubmit={handleSendMessage}>
                  <input
                    type="text"
                    className="input-field"
                    placeholder={room.status === 'night' ? (myPlayer.role === '人狼' ? "人狼チャット（仲間にのみ見えます）" : "夜は発言できません") : "メッセージを入力..."}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={room.status === 'night' && myPlayer.role !== '人狼'}
                  />
                  <button type="submit" className="btn btn-primary" disabled={room.status === 'night' && myPlayer.role !== '人狼'}>
                    <Send size={18} />
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
