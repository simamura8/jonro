const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3001;

// ルームとプレイヤーの状態を管理
const rooms = {};

// 役職の定義
const ROLES = {
  VILLAGER: '村人',
  WEREWOLF: '人狼',
  SEER: '占い師',
  KNIGHT: '騎士'
};

// 役職の割り当てロジック
function assignRoles(players) {
  const playerIds = Object.keys(players);
  const count = playerIds.length;
  
  // デフォルト構成（4人以上を想定）
  // 4人: 人狼1, 占い師1, 騎士1, 村人1
  // 5人: 人狼1, 占い師1, 騎士1, 村人2
  // 6人: 人狼2, 占い師1, 騎士1, 村人2
  
  let rolePool = [];
  if (count <= 4) {
    rolePool = [ROLES.WEREWOLF, ROLES.SEER, ROLES.KNIGHT];
    while (rolePool.length < count) rolePool.push(ROLES.VILLAGER);
  } else if (count === 5) {
    rolePool = [ROLES.WEREWOLF, ROLES.SEER, ROLES.KNIGHT, ROLES.VILLAGER, ROLES.VILLAGER];
  } else {
    rolePool = [ROLES.WEREWOLF, ROLES.WEREWOLF, ROLES.SEER, ROLES.KNIGHT];
    while (rolePool.length < count) rolePool.push(ROLES.VILLAGER);
  }

  // シャッフル
  rolePool.sort(() => Math.random() - 0.5);

  playerIds.forEach((id, index) => {
    players[id].role = rolePool[index] || ROLES.VILLAGER;
    players[id].isAlive = true;
  });
}

function checkWinCondition(room) {
  const players = Object.values(room.players);
  const alivePlayers = players.filter(p => p.isAlive);
  const aliveWolves = alivePlayers.filter(p => p.role === ROLES.WEREWOLF);
  const aliveVillagers = alivePlayers.filter(p => p.role !== ROLES.WEREWOLF);

  if (aliveWolves.length === 0) {
    return 'VILLAGERS'; // 村人の勝利
  }
  if (aliveWolves.length >= aliveVillagers.length) {
    return 'WEREWOLVES'; // 人狼の勝利
  }
  return null; // 継続
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  let currentRoomId = null;

  // ルームへの参加
  socket.on('join_room', ({ roomId, playerName }) => {
    currentRoomId = roomId;
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        players: {},
        status: 'waiting', // waiting, night, day, voting, finished
        dayCount: 0,
        logs: [],
        nightActions: {},
        votes: {},
        winner: null
      };
    }

    const room = rooms[roomId];
    
    // 進行中の場合は観戦モードにするか弾く処理が必要だが、MVPではシンプルに参加可能にする（ただし役職なし死亡扱い等）
    const isNew = !room.players[socket.id];

    room.players[socket.id] = {
      id: socket.id,
      name: playerName || `Player ${Object.keys(room.players).length + 1}`,
      role: null,
      isAlive: room.status === 'waiting' // 途中参加は死亡扱い
    };

    io.to(roomId).emit('room_update', room);
    
    if (isNew) {
      io.to(roomId).emit('chat_message', {
        sender: 'System',
        text: `${room.players[socket.id].name} が参加しました。`,
        isSystem: true
      });
    }
  });

  // ゲーム開始
  socket.on('start_game', (roomId) => {
    const room = rooms[roomId];
    if (room && room.status === 'waiting') {
      assignRoles(room.players);
      room.status = 'night';
      room.dayCount = 1;
      room.logs.push('ゲームが開始されました。夜が訪れます...');
      room.nightActions = {};
      room.votes = {};

      io.to(roomId).emit('room_update', room);
      io.to(roomId).emit('chat_message', {
        sender: 'System',
        text: 'ゲーム開始。夜のアクションを行ってください。',
        isSystem: true
      });
    }
  });

  // チャットメッセージ
  socket.on('send_message', ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;

    // 死者はシステムログのみ、または別チャットにするのが通常だがMVPでは全員送信か死者のみ送信
    if (!player.isAlive) {
      // 死者チャット（今回は省略、死者は発言不可とする）
      return;
    }

    // 夜の人狼チャット制限
    if (room.status === 'night') {
      if (player.role === ROLES.WEREWOLF) {
        // 人狼同士のみ
        Object.values(room.players).forEach(p => {
          if (p.role === ROLES.WEREWOLF) {
            io.to(p.id).emit('chat_message', {
              sender: player.name,
              text: `[人狼チャット] ${text}`,
              isSystem: false
            });
          }
        });
      }
    } else {
      // 昼間は全体チャット
      io.to(roomId).emit('chat_message', {
        sender: player.name,
        text: text,
        isSystem: false
      });
    }
  });

  // 夜のアクション
  socket.on('night_action', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'night') return;
    const player = room.players[socket.id];
    if (!player || !player.isAlive) return;

    room.nightActions[socket.id] = targetId;

    // 生きている能力者（人狼、占い師、騎士）の数
    const activeRoles = Object.values(room.players).filter(p => p.isAlive && p.role !== ROLES.VILLAGER);
    
    // 全員アクション完了したか判定（シンプル化：全員がアクションを送る前提。村人はnullなどを送る）
    // 今回のMVPでは、村人も「何もしない」アクションを送信するようにフロントを実装
    if (Object.keys(room.nightActions).length >= Object.values(room.players).filter(p=>p.isAlive).length) {
      processNightActions(roomId);
    }
  });

  // 昼の投票
  socket.on('vote', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'voting') return;
    const player = room.players[socket.id];
    if (!player || !player.isAlive) return;

    room.votes[socket.id] = targetId;

    if (Object.keys(room.votes).length >= Object.values(room.players).filter(p=>p.isAlive).length) {
      processVotes(roomId);
    }
  });

  function processNightActions(roomId) {
    const room = rooms[roomId];
    
    let wolfTarget = null;
    let knightTarget = null;

    // アクション集計
    for (const [socketId, targetId] of Object.entries(room.nightActions)) {
      const player = room.players[socketId];
      if (!player) continue;
      
      if (player.role === ROLES.WEREWOLF && targetId) {
        // 複数人狼の場合の処理を簡易化（最後の人狼のアクションを優先）
        wolfTarget = targetId;
      } else if (player.role === ROLES.KNIGHT && targetId) {
        knightTarget = targetId;
      } else if (player.role === ROLES.SEER && targetId) {
        const targetPlayer = room.players[targetId];
        const result = targetPlayer.role === ROLES.WEREWOLF ? '人狼' : '人間';
        io.to(socketId).emit('chat_message', {
          sender: 'System',
          text: `[占い結果] ${targetPlayer.name} は ${result} です。`,
          isSystem: true
        });
      }
    }

    // 襲撃処理
    let killedPlayerName = '誰も死にませんでした';
    if (wolfTarget && wolfTarget !== knightTarget) {
      const victim = room.players[wolfTarget];
      if (victim) {
        victim.isAlive = false;
        killedPlayerName = victim.name;
      }
    }

    // 勝敗判定
    const winner = checkWinCondition(room);
    if (winner) {
      endGame(roomId, winner);
      return;
    }

    room.status = 'day';
    room.nightActions = {};
    
    io.to(roomId).emit('room_update', room);
    io.to(roomId).emit('chat_message', {
      sender: 'System',
      text: `朝になりました。昨晩の犠牲者：${killedPlayerName}。議論を開始してください。`,
      isSystem: true
    });
  }

  function processVotes(roomId) {
    const room = rooms[roomId];
    
    // 得票数計算
    const voteCounts = {};
    for (const targetId of Object.values(room.votes)) {
      if (targetId) {
        voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
      }
    }

    let maxVotes = 0;
    let executedId = null;

    for (const [targetId, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        executedId = targetId;
      } else if (count === maxVotes) {
        // 同数の場合はランダム処刑（MVP仕様）
        if (Math.random() > 0.5) {
          executedId = targetId;
        }
      }
    }

    if (executedId && room.players[executedId]) {
      room.players[executedId].isAlive = false;
      io.to(roomId).emit('chat_message', {
        sender: 'System',
        text: `投票の結果、${room.players[executedId].name} が処刑されました。`,
        isSystem: true
      });
    } else {
      io.to(roomId).emit('chat_message', {
        sender: 'System',
        text: '投票の結果、誰も処刑されませんでした。',
        isSystem: true
      });
    }

    // 勝敗判定
    const winner = checkWinCondition(room);
    if (winner) {
      endGame(roomId, winner);
      return;
    }

    // 次の夜へ
    room.status = 'night';
    room.dayCount += 1;
    room.votes = {};
    
    io.to(roomId).emit('room_update', room);
    io.to(roomId).emit('chat_message', {
      sender: 'System',
      text: '夜が訪れました。夜のアクションを行ってください。',
      isSystem: true
    });
  }

  function endGame(roomId, winnerTeam) {
    const room = rooms[roomId];
    room.status = 'finished';
    room.winner = winnerTeam;
    
    const teamName = winnerTeam === 'VILLAGERS' ? '村人陣営' : '人狼陣営';
    
    io.to(roomId).emit('room_update', room);
    io.to(roomId).emit('chat_message', {
      sender: 'System',
      text: `ゲーム終了！ ${teamName} の勝利です！`,
      isSystem: true
    });
  }

  socket.on('change_phase', ({ roomId, phase }) => {
    // 昼から投票へ移行する用
    const room = rooms[roomId];
    if (room && room.status === 'day' && phase === 'voting') {
      room.status = 'voting';
      io.to(roomId).emit('room_update', room);
      io.to(roomId).emit('chat_message', {
        sender: 'System',
        text: '投票の時間です。処刑する相手を選んでください。',
        isSystem: true
      });
    }
  });

  socket.on('restart_game', (roomId) => {
    const room = rooms[roomId];
    if (room && room.status === 'finished') {
      room.status = 'waiting';
      room.dayCount = 0;
      room.logs = [];
      room.nightActions = {};
      room.votes = {};
      room.winner = null;
      // プレイヤーの状態をリセット
      Object.values(room.players).forEach(p => {
        p.role = null;
        p.isAlive = true;
      });
      io.to(roomId).emit('room_update', room);
      io.to(roomId).emit('chat_message', {
        sender: 'System',
        text: 'ゲームがリセットされました。待機中です。',
        isSystem: true
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    if (currentRoomId && rooms[currentRoomId]) {
      const room = rooms[currentRoomId];
      const player = room.players[socket.id];
      if (player) {
        delete room.players[socket.id];
        io.to(currentRoomId).emit('chat_message', {
          sender: 'System',
          text: `${player.name} が退出しました。`,
          isSystem: true
        });
        io.to(currentRoomId).emit('room_update', room);
        
        // 部屋が空になったら削除
        if (Object.keys(room.players).length === 0) {
          delete rooms[currentRoomId];
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
