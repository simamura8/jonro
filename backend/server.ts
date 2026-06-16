import type { Party, PartyServer, PartyConnection } from "partykit/server";

const ROLES = {
  VILLAGER: '村人',
  WEREWOLF: '人狼',
  SEER: '占い師',
  KNIGHT: '騎士',
  MADMAN: '狂人',
  MEDIUM: '霊媒師',
  PHANTOM_THIEF: '怪盗'
};

function assignRoles(players: any, rolePool: any) {
  const playerIds = Object.keys(players);
  const pool = [...rolePool];
  pool.sort(() => Math.random() - 0.5);

  playerIds.forEach((id, index) => {
    players[id].role = pool[index] || ROLES.VILLAGER;
    players[id].isAlive = true;
  });
}

function checkWinCondition(roomState: any) {
  const players = Object.values(roomState.players) as any[];
  const alivePlayers = players.filter(p => p.isAlive);
  const aliveWolves = alivePlayers.filter(p => p.role === ROLES.WEREWOLF);
  const aliveVillagers = alivePlayers.filter(p => p.role !== ROLES.WEREWOLF);

  if (aliveWolves.length === 0) return 'VILLAGERS';
  if (aliveWolves.length >= aliveVillagers.length) return 'WEREWOLVES';
  return null;
}

export default class WerewolfServer implements PartyServer {
  roomState: any;

  constructor(readonly room: Party) {
    this.roomState = {
      id: this.room.id,
      players: {},
      status: 'waiting',
      dayCount: 0,
      logs: [],
      nightActions: {},
      votes: {},
      winner: null,
      isRevote: false,
      candidates: null,
      rolePool: [ROLES.VILLAGER, ROLES.WEREWOLF, ROLES.SEER],
      lastExecutedId: null
    };
  }

  onConnect(conn: PartyConnection, ctx: any) {
    // 接続時処理はjoin_roomメッセージ内で行う
  }

  onClose(conn: PartyConnection) {
    if (this.roomState.players[conn.id]) {
      const player = this.roomState.players[conn.id];
      delete this.roomState.players[conn.id];
      this.room.broadcast(JSON.stringify({
        type: 'chat_message',
        payload: {
          sender: 'System',
          text: `${player.name} が退出しました。`,
          isSystem: true
        }
      }));
      this.room.broadcast(JSON.stringify({
        type: 'room_update',
        payload: this.roomState
      }));
    }
  }

  onMessage(message: string, sender: PartyConnection) {
    const data = JSON.parse(message);
    const { type, payload } = data;

    switch (type) {
      case 'join_room': {
        const isNew = !this.roomState.players[sender.id];
        this.roomState.players[sender.id] = {
          id: sender.id,
          name: payload.playerName || `Player ${Object.keys(this.roomState.players).length + 1}`,
          role: null,
          isAlive: this.roomState.status === 'waiting'
        };
        
        this.room.broadcast(JSON.stringify({ type: 'room_update', payload: this.roomState }));
        
        if (isNew) {
          this.room.broadcast(JSON.stringify({
            type: 'chat_message',
            payload: {
              sender: 'System',
              text: `${this.roomState.players[sender.id].name} が参加しました。`,
              isSystem: true
            }
          }));
        }
        break;
      }
      case 'start_game': {
        if (this.roomState.status === 'waiting') {
          assignRoles(this.roomState.players, this.roomState.rolePool);
          this.roomState.status = 'night';
          this.roomState.dayCount = 1;
          this.roomState.logs.push('ゲームが開始されました。夜が訪れます...');
          this.roomState.nightActions = {};
          this.roomState.votes = {};
          this.roomState.isRevote = false;
          this.roomState.candidates = null;
          this.roomState.lastExecutedId = null;

          this.room.broadcast(JSON.stringify({ type: 'room_update', payload: this.roomState }));
          this.room.broadcast(JSON.stringify({
            type: 'chat_message',
            payload: {
              sender: 'System',
              text: 'ゲーム開始。夜のアクションを行ってください。',
              isSystem: true
            }
          }));
        }
        break;
      }
      case 'update_roles': {
        if (this.roomState.status === 'waiting') {
          this.roomState.rolePool = payload.roles;
          this.room.broadcast(JSON.stringify({ type: 'room_update', payload: this.roomState }));
        }
        break;
      }
      case 'send_message': {
        const player = this.roomState.players[sender.id];
        if (!player || !player.isAlive) return;

        if (this.roomState.status === 'night' && player.role === ROLES.WEREWOLF) {
          Object.values(this.roomState.players).forEach((p: any) => {
            if (p.role === ROLES.WEREWOLF) {
              const wolfConn = this.room.getConnection(p.id);
              if (wolfConn) {
                wolfConn.send(JSON.stringify({
                  type: 'chat_message',
                  payload: {
                    sender: player.name,
                    text: `[人狼チャット] ${payload.text}`,
                    isSystem: false
                  }
                }));
              }
            }
          });
        } else {
          this.room.broadcast(JSON.stringify({
            type: 'chat_message',
            payload: {
              sender: player.name,
              text: payload.text,
              isSystem: false
            }
          }));
        }
        break;
      }
      case 'night_action': {
        if (this.roomState.status !== 'night') return;
        const player = this.roomState.players[sender.id];
        if (!player || !player.isAlive) return;

        this.roomState.nightActions[sender.id] = payload.targetId;

        const aliveCount = Object.values(this.roomState.players).filter((p: any) => p.isAlive).length;
        if (Object.keys(this.roomState.nightActions).length >= aliveCount) {
          this.processNightActions();
        }
        break;
      }
      case 'vote': {
        if (this.roomState.status !== 'voting') return;
        const player = this.roomState.players[sender.id];
        if (!player || !player.isAlive) return;

        this.roomState.votes[sender.id] = payload.targetId;

        const aliveCount = Object.values(this.roomState.players).filter((p: any) => p.isAlive).length;
        if (Object.keys(this.roomState.votes).length >= aliveCount) {
          this.processVotes();
        }
        break;
      }
      case 'change_phase': {
        if (this.roomState.status === 'day' && payload.phase === 'voting') {
          this.roomState.status = 'voting';
          this.room.broadcast(JSON.stringify({ type: 'room_update', payload: this.roomState }));
          this.room.broadcast(JSON.stringify({
            type: 'chat_message',
            payload: {
              sender: 'System',
              text: '投票の時間です。処刑する相手を選んでください。',
              isSystem: true
            }
          }));
        }
        break;
      }
      case 'restart_game': {
        if (this.roomState.status === 'finished') {
          this.roomState.status = 'waiting';
          this.roomState.dayCount = 0;
          this.roomState.logs = [];
          this.roomState.nightActions = {};
          this.roomState.votes = {};
          this.roomState.winner = null;
          this.roomState.isRevote = false;
          this.roomState.candidates = null;
          this.roomState.lastExecutedId = null;
          
          Object.values(this.roomState.players).forEach((p: any) => {
            p.role = null;
            p.isAlive = true;
          });
          
          this.room.broadcast(JSON.stringify({ type: 'room_update', payload: this.roomState }));
          this.room.broadcast(JSON.stringify({
            type: 'chat_message',
            payload: {
              sender: 'System',
              text: 'ゲームがリセットされました。待機中です。',
              isSystem: true
            }
          }));
        }
        break;
      }
    }
  }

  processNightActions() {
    // 1. 各プレイヤーの元々の役職を記録
    const originalRoles: Record<string, string> = {};
    for (const socketId of Object.keys(this.roomState.players)) {
      originalRoles[socketId] = this.roomState.players[socketId].role;
    }

    // 2. 先に怪盗の処理を行う
    let thiefId = null;
    let thiefTargetId = null;

    for (const [socketId, targetId] of Object.entries(this.roomState.nightActions)) {
      if (originalRoles[socketId] === ROLES.PHANTOM_THIEF && targetId && this.roomState.dayCount === 1) {
        thiefId = socketId;
        thiefTargetId = targetId as string;
        break;
      }
    }

    if (thiefId && thiefTargetId) {
      const thiefPlayer = this.roomState.players[thiefId];
      const targetPlayer = this.roomState.players[thiefTargetId];
      if (thiefPlayer && targetPlayer) {
        const stolenRole = targetPlayer.role;
        thiefPlayer.role = stolenRole;
        targetPlayer.role = ROLES.PHANTOM_THIEF;

        const thiefConn = this.room.getConnection(thiefId);
        if (thiefConn) {
          thiefConn.send(JSON.stringify({
            type: 'chat_message',
            payload: {
              sender: 'System',
              text: `[怪盗] あなたは ${targetPlayer.name} の役職（${stolenRole}）を奪いました。今後は ${stolenRole} として行動します。`,
              isSystem: true
            }
          }));
        }
        
        const targetConn = this.room.getConnection(thiefTargetId);
        if (targetConn) {
          targetConn.send(JSON.stringify({
            type: 'chat_message',
            payload: {
              sender: 'System',
              text: `[システム] あなたは怪盗に役職を奪われました。能力のない「怪盗」になります。`,
              isSystem: true
            }
          }));
        }
      }
    }

    // 3. 他のアクションを処理
    let wolfTarget = null;
    let knightTarget = null;

    for (const [socketId, targetId] of Object.entries(this.roomState.nightActions)) {
      const originalRole = originalRoles[socketId];
      
      if (originalRole === ROLES.WEREWOLF && targetId) {
        wolfTarget = targetId;
      } else if (originalRole === ROLES.KNIGHT && targetId) {
        knightTarget = targetId;
      } else if (originalRole === ROLES.SEER && targetId) {
        const targetPlayer = this.roomState.players[targetId as string];
        // ここで参照する targetPlayer.role は怪盗の交換が反映された「現在の」役職
        const result = targetPlayer.role === ROLES.WEREWOLF ? '人狼' : '人間';
        const seerConn = this.room.getConnection(socketId);
        if (seerConn) {
          seerConn.send(JSON.stringify({
            type: 'chat_message',
            payload: {
              sender: 'System',
              text: `[占い結果] ${targetPlayer.name} は ${result} です。`,
              isSystem: true
            }
          }));
        }
      }
    }

    // 4. 襲撃処理
    let killedPlayerName = '誰も死にませんでした';
    if (wolfTarget && wolfTarget !== knightTarget) {
      const victim = this.roomState.players[wolfTarget as string];
      if (victim) {
        victim.isAlive = false;
        killedPlayerName = victim.name;
      }
    }

    const winner = checkWinCondition(this.roomState);
    if (winner) {
      this.endGame(winner);
      return;
    }

    this.roomState.status = 'day';
    this.roomState.nightActions = {};
    
    this.room.broadcast(JSON.stringify({ type: 'room_update', payload: this.roomState }));
    this.room.broadcast(JSON.stringify({
      type: 'chat_message',
      payload: {
        sender: 'System',
        text: `朝になりました。昨晩の犠牲者：${killedPlayerName}。議論を開始してください。`,
        isSystem: true
      }
    }));
  }

  processVotes() {
    const voteCounts: any = {};
    for (const targetId of Object.values(this.roomState.votes)) {
      if (targetId) {
        voteCounts[targetId as string] = (voteCounts[targetId as string] || 0) + 1;
      }
    }

    let maxVotes = 0;
    let candidates: string[] = [];

    for (const [targetId, count] of Object.entries(voteCounts)) {
      if ((count as number) > maxVotes) {
        maxVotes = count as number;
        candidates = [targetId];
      } else if (count === maxVotes) {
        candidates.push(targetId);
      }
    }

    if (maxVotes === 0) {
    if (maxVotes === 0) {
      this.goToNextNight('投票の結果、誰も処刑されませんでした。');
      return;
    }

    if (candidates.length === 1) {
      const executedId = candidates[0];
      this.roomState.players[executedId].isAlive = false;
      this.roomState.lastExecutedId = executedId;
      
      const executionMessage = `投票の結果、${this.roomState.players[executedId].name} が処刑されました。`;

      const winner = checkWinCondition(this.roomState);
      if (winner) {
        this.room.broadcast(JSON.stringify({
          type: 'chat_message',
          payload: {
            sender: 'System',
            text: executionMessage,
            isSystem: true
          }
        }));
        this.endGame(winner);
        return;
      }
      this.goToNextNight(executionMessage);
    } else {
      if (this.roomState.isRevote) {
        this.goToNextNight('決選投票の結果も同数だったため、誰も処刑されませんでした。');
      } else {
        this.roomState.isRevote = true;
        this.roomState.candidates = candidates;
        this.roomState.votes = {};

        const candidateNames = candidates.map((id: string) => this.roomState.players[id].name).join(', ');
        
        this.room.broadcast(JSON.stringify({ type: 'room_update', payload: this.roomState }));
        this.room.broadcast(JSON.stringify({
          type: 'chat_message',
          payload: {
            sender: 'System',
            text: `投票が同数（${maxVotes}票）だったため、決選投票を行います。対象者: ${candidateNames}。もう一度投票してください。`,
            isSystem: true
          }
        }));
      }
    }
  }

  goToNextNight(executionMessage?: string) {
    this.roomState.status = 'night';
    this.roomState.dayCount += 1;
    this.roomState.votes = {};
    this.roomState.isRevote = false;
    this.roomState.candidates = null;
    
    this.room.broadcast(JSON.stringify({ type: 'room_update', payload: this.roomState }));
    this.room.broadcast(JSON.stringify({
      type: 'chat_message',
      payload: {
        sender: 'System',
        text: '夜が訪れました。夜のアクションを行ってください。',
        isSystem: true
      }
    }));

    if (executionMessage) {
      this.room.broadcast(JSON.stringify({
        type: 'chat_message',
        payload: {
          sender: 'System',
          text: executionMessage,
          isSystem: true
        }
      }));
    }

    if (this.roomState.lastExecutedId) {
      const executed = this.roomState.players[this.roomState.lastExecutedId];
      if (executed) {
        const isWolf = executed.role === ROLES.WEREWOLF;
        const resultText = `[霊媒結果] 本日処刑された ${executed.name} は ${isWolf ? '人狼' : '人間'} でした。`;
        
        Object.values(this.roomState.players).forEach((p: any) => {
          if (p.isAlive && p.role === ROLES.MEDIUM) {
            const medConn = this.room.getConnection(p.id);
            if (medConn) {
              medConn.send(JSON.stringify({
                type: 'chat_message',
                payload: {
                  sender: 'System',
                  text: resultText,
                  isSystem: true
                }
              }));
            }
          }
        });
      }
      this.roomState.lastExecutedId = null;
    }
  }

  endGame(winnerTeam: string) {
    this.roomState.status = 'finished';
    this.roomState.winner = winnerTeam;
    
    const teamName = winnerTeam === 'VILLAGERS' ? '村人陣営' : '人狼陣営';
    
    this.room.broadcast(JSON.stringify({ type: 'room_update', payload: this.roomState }));
    this.room.broadcast(JSON.stringify({
      type: 'chat_message',
      payload: {
        sender: 'System',
        text: `ゲーム終了！ ${teamName} の勝利です！`,
        isSystem: true
      }
    }));
  }
}
