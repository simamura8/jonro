import { triggerPusher } from "./pusherHelper";

const ROLES = {
  VILLAGER: '村人',
  WEREWOLF: '人狼',
  SEER: '占い師',
  KNIGHT: '騎士',
  MADMAN: '狂人',
  MEDIUM: '霊媒師',
  PHANTOM_THIEF: '怪盗'
};

interface Env {
  DB: D1Database;
  PUSHER_APP_ID: string;
  PUSHER_KEY: string;
  PUSHER_SECRET: string;
  PUSHER_CLUSTER: string;
}

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

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { searchParams } = new URL(context.request.url);
    const roomId = searchParams.get("roomId");

    if (!roomId) {
      return new Response("Missing roomId", { status: 400 });
    }

    const db = context.env.DB;
    // ローカル開発環境でテーブルが未作成の場合に備えて自動初期化
    await db.prepare(
      "CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
    ).run();
    const d1Result = await db.prepare("SELECT state FROM rooms WHERE id = ?").bind(roomId).first<{ state: string }>();

    if (!d1Result) {
      // 初期状態
      const initialRoomState = {
        id: roomId,
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
      return new Response(JSON.stringify(initialRoomState), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    return new Response(d1Result.state, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const data = await context.request.json() as any;
    const { roomId, playerId, type, payload } = data;

    if (!roomId || !type) {
      return new Response("Missing roomId or type", { status: 400 });
    }

    const db = context.env.DB;
    // ローカル開発環境でテーブルが未作成の場合に備えて自動初期化
    await db.prepare(
      "CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
    ).run();
    const pusherConfig = {
      appId: context.env.PUSHER_APP_ID,
      key: context.env.PUSHER_KEY,
      secret: context.env.PUSHER_SECRET,
      cluster: context.env.PUSHER_CLUSTER,
    };

    // 1. ルーム状態のロード
    const d1Result = await db.prepare("SELECT state FROM rooms WHERE id = ?").bind(roomId).first<{ state: string }>();
    
    let roomState: any;
    if (!d1Result) {
      // 初期状態
      roomState = {
        id: roomId,
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
    } else {
      roomState = JSON.parse(d1Result.state);
    }

    let broadcastState = true;
    let messagesToBroadcast: Array<{ channel: string; event: string; payload: any }> = [];

    // 2. アクションの処理
    switch (type) {
      case 'join_room': {
        if (!playerId) return new Response("Missing playerId", { status: 400 });
        const isNew = !roomState.players[playerId];
        roomState.players[playerId] = {
          id: playerId,
          name: payload.playerName || `Player ${Object.keys(roomState.players).length + 1}`,
          role: roomState.players[playerId]?.role || null,
          isAlive: roomState.status === 'waiting' ? true : (roomState.players[playerId]?.isAlive ?? false)
        };

        if (isNew) {
          messagesToBroadcast.push({
            channel: `presence-room-${roomId}`,
            event: 'chat_message',
            payload: {
              sender: 'System',
              text: `${roomState.players[playerId].name} が参加しました。`,
              isSystem: true
            }
          });
        }
        break;
      }

      case 'leave_room': {
        if (!playerId) return new Response("Missing playerId", { status: 400 });
        if (roomState.players[playerId]) {
          const player = roomState.players[playerId];
          delete roomState.players[playerId];
          messagesToBroadcast.push({
            channel: `presence-room-${roomId}`,
            event: 'chat_message',
            payload: {
              sender: 'System',
              text: `${player.name} が退出しました。`,
              isSystem: true
            }
          });
        }
        break;
      }

      case 'start_game': {
        if (roomState.status === 'waiting') {
          assignRoles(roomState.players, roomState.rolePool);
          roomState.status = 'night';
          roomState.dayCount = 1;
          roomState.logs.push('ゲームが開始されました。夜が訪れます...');
          roomState.nightActions = {};
          roomState.votes = {};
          roomState.isRevote = false;
          roomState.candidates = null;
          roomState.lastExecutedId = null;

          messagesToBroadcast.push({
            channel: `presence-room-${roomId}`,
            event: 'chat_message',
            payload: {
              sender: 'System',
              text: 'ゲーム開始。夜のアクションを行ってください。',
              isSystem: true
            }
          });
        }
        break;
      }

      case 'update_roles': {
        if (roomState.status === 'waiting') {
          roomState.rolePool = payload.roles;
        }
        break;
      }

      case 'send_message': {
        if (!playerId) return new Response("Missing playerId", { status: 400 });
        const player = roomState.players[playerId];
        if (!player || !player.isAlive) return new Response("Player unauthorized or dead", { status: 403 });

        broadcastState = false; // チャットメッセージ送信のみなので部屋状態全体のブロードキャストはスキップ

        if (roomState.status === 'night' && player.role === ROLES.WEREWOLF) {
          // 人狼専用チャットに送信
          messagesToBroadcast.push({
            channel: `private-room-${roomId}-wolves`,
            event: 'chat_message',
            payload: {
              sender: player.name,
              text: `[人狼チャット] ${payload.text}`,
              isSystem: false
            }
          });
        } else {
          // 通常チャットに送信
          messagesToBroadcast.push({
            channel: `presence-room-${roomId}`,
            event: 'chat_message',
            payload: {
              sender: player.name,
              text: payload.text,
              isSystem: false
            }
          });
        }
        break;
      }

      case 'night_action': {
        if (!playerId) return new Response("Missing playerId", { status: 400 });
        if (roomState.status !== 'night') return new Response("Not night phase", { status: 400 });
        const player = roomState.players[playerId];
        if (!player || !player.isAlive) return new Response("Player unauthorized or dead", { status: 403 });

        // 人狼の複数同期検証（サーバーサイド）
        if (player.role === ROLES.WEREWOLF) {
          let lockedTarget = null;
          for (const [pid, tid] of Object.entries(roomState.nightActions || {})) {
            const otherPlayer = roomState.players[pid] as any;
            if (pid !== playerId && otherPlayer?.role === ROLES.WEREWOLF && otherPlayer.isAlive && tid) {
              lockedTarget = tid;
              break;
            }
          }
          if (lockedTarget && payload.targetId !== lockedTarget) {
            return new Response(JSON.stringify({ error: "仲間の人狼とターゲットを合わせる必要があります。" }), {
              status: 400,
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
          }
        }

        roomState.nightActions[playerId] = payload.targetId;

        const aliveCount = Object.values(roomState.players).filter((p: any) => p.isAlive).length;
        if (Object.keys(roomState.nightActions).length >= aliveCount) {
          // 夜のアクションを処理（関数内でメッセージ作成、状態更新を行う）
          await processNightActions(roomState, roomId, messagesToBroadcast);
        }
        break;
      }

      case 'vote': {
        if (!playerId) return new Response("Missing playerId", { status: 400 });
        if (roomState.status !== 'voting') return new Response("Not voting phase", { status: 400 });
        const player = roomState.players[playerId];
        if (!player || !player.isAlive) return new Response("Player unauthorized or dead", { status: 403 });

        roomState.votes[playerId] = payload.targetId;

        const aliveCount = Object.values(roomState.players).filter((p: any) => p.isAlive).length;
        if (Object.keys(roomState.votes).length >= aliveCount) {
          // 投票の処理
          await processVotes(roomState, roomId, messagesToBroadcast);
        }
        break;
      }

      case 'change_phase': {
        if (roomState.status === 'day' && payload.phase === 'voting') {
          roomState.status = 'voting';
          messagesToBroadcast.push({
            channel: `presence-room-${roomId}`,
            event: 'chat_message',
            payload: {
              sender: 'System',
              text: '投票の時間です。処刑する相手を選んでください。',
              isSystem: true
            }
          });
        }
        break;
      }

      case 'restart_game': {
        if (roomState.status === 'finished') {
          roomState.status = 'waiting';
          roomState.dayCount = 0;
          roomState.logs = [];
          roomState.nightActions = {};
          roomState.votes = {};
          roomState.winner = null;
          roomState.isRevote = false;
          roomState.candidates = null;
          roomState.lastExecutedId = null;
          
          Object.values(roomState.players).forEach((p: any) => {
            p.role = null;
            p.isAlive = true;
          });
          
          messagesToBroadcast.push({
            channel: `presence-room-${roomId}`,
            event: 'chat_message',
            payload: {
              sender: 'System',
              text: 'ゲームがリセットされました。待機中です。',
              isSystem: true
            }
          });
        }
        break;
      }

      default:
        return new Response("Unknown type", { status: 400 });
    }

    // 3. ルーム状態の保存
    await db.prepare("INSERT OR REPLACE INTO rooms (id, state, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
      .bind(roomId, JSON.stringify(roomState))
      .run();

    // 4. Pusher でブロードキャスト
    if (broadcastState) {
      messagesToBroadcast.push({
        channel: `presence-room-${roomId}`,
        event: 'room_update',
        payload: roomState
      });
    }

    // すべてのメッセージを順序を担保しつつ Pusher で送信
    for (const msg of messagesToBroadcast) {
      await triggerPusher(pusherConfig, msg.channel, msg.event, msg.payload);
      // Pusher側でのメッセージ到達順序を担保するため、ごくわずかなディレイ(50ms)を挟む
      await new Promise(resolve => setTimeout(resolve, 50));
    }


    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error: any) {
    console.error("API Error stack:", error.stack || error);
    return new Response(JSON.stringify({ 
      error: error.message || "Internal Server Error",
      stack: error.stack
    }), { 
      status: 500,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};

async function processNightActions(roomState: any, roomId: string, messagesToBroadcast: any[]) {
  // 1. 各プレイヤーの元々の役職を記録（アクション判定用）
  const originalRoles: Record<string, string> = {};
  for (const playerId of Object.keys(roomState.players)) {
    originalRoles[playerId] = roomState.players[playerId].role;
  }

  // 2. 先に怪盗の処理を行う
  let thiefId = null;
  let thiefTargetId = null;
  for (const [playerId, targetId] of Object.entries(roomState.nightActions)) {
    if (originalRoles[playerId] === ROLES.PHANTOM_THIEF && targetId && roomState.dayCount === 1) {
      thiefId = playerId;
      thiefTargetId = targetId as string;
      break;
    }
  }

  if (thiefId && thiefTargetId) {
    const thiefPlayer = roomState.players[thiefId];
    const targetPlayer = roomState.players[thiefTargetId];
    if (thiefPlayer && targetPlayer) {
      const stolenRole = targetPlayer.role;
      thiefPlayer.role = stolenRole;
      targetPlayer.role = ROLES.PHANTOM_THIEF;

      messagesToBroadcast.push({
        channel: `private-user-${thiefId}`,
        event: 'chat_message',
        payload: {
          sender: 'System',
          text: `[怪盗] あなたは ${targetPlayer.name} の役職（${stolenRole}）を奪いました。今後は ${stolenRole} として行動します。`,
          isSystem: true
        }
      });
      messagesToBroadcast.push({
        channel: `private-user-${thiefTargetId}`,
        event: 'chat_message',
        payload: {
          sender: 'System',
          text: `[システム] あなたは怪盗に役職を奪われました。能力のない「怪盗」になります。`,
          isSystem: true
        }
      });
    }
  }

  // 3. 他のアクションを処理（元々の役職に基づいて判定）
  let wolfTarget = null;
  let knightTarget = null;

  for (const [playerId, targetId] of Object.entries(roomState.nightActions)) {
    const originalRole = originalRoles[playerId];
    
    if (originalRole === ROLES.WEREWOLF && targetId) {
      wolfTarget = targetId;
    } else if (originalRole === ROLES.KNIGHT && targetId) {
      knightTarget = targetId;
    } else if (originalRole === ROLES.SEER && targetId) {
      const targetPlayer = roomState.players[targetId as string];
      if (targetPlayer) {
        // ここで参照する targetPlayer.role は怪盗の交換が反映された「現在の」役職
        const result = targetPlayer.role === ROLES.WEREWOLF ? '人狼' : '人間';
        // 占い師個人のプライベートチャネルに結果を送信
        messagesToBroadcast.push({
          channel: `private-user-${playerId}`,
          event: 'chat_message',
          payload: {
            sender: 'System',
            text: `[占い結果] ${targetPlayer.name} は ${result} です。`,
            isSystem: true
          }
        });
      }
    }
  }

  // 4. 襲撃処理
  let killedPlayerName = '誰も死にませんでした';
  if (wolfTarget && wolfTarget !== knightTarget) {
    const victim = roomState.players[wolfTarget as string];
    if (victim) {
      victim.isAlive = false;
      killedPlayerName = victim.name;
    }
  }

  const winner = checkWinCondition(roomState);
  if (winner) {
    endGame(roomState, winner, messagesToBroadcast);
    return;
  }

  roomState.status = 'day';
  roomState.nightActions = {};
  
  messagesToBroadcast.push({
    channel: `presence-room-${roomId}`,
    event: 'chat_message',
    payload: {
      sender: 'System',
      text: `朝になりました。昨晩の犠牲者：${killedPlayerName}。議論を開始してください。`,
      isSystem: true
    }
  });
}

// 投票を処理する関数
async function processVotes(roomState: any, roomId: string, messagesToBroadcast: any[]) {
  const voteCounts: any = {};
  for (const targetId of Object.values(roomState.votes)) {
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
    goToNextNight(roomState, roomId, messagesToBroadcast, '投票の結果、誰も処刑されませんでした。');
    return;
  }

  if (candidates.length === 1) {
    const executedId = candidates[0];
    roomState.players[executedId].isAlive = false;
    roomState.lastExecutedId = executedId;
    
    const executionMessage = `投票の結果、${roomState.players[executedId].name} が処刑されました。`;

    const winner = checkWinCondition(roomState);
    if (winner) {
      messagesToBroadcast.push({
        channel: `presence-room-${roomId}`,
        event: 'chat_message',
        payload: {
          sender: 'System',
          text: executionMessage,
          isSystem: true
        }
      });
      endGame(roomState, winner, messagesToBroadcast);
      return;
    }
    goToNextNight(roomState, roomId, messagesToBroadcast, executionMessage);
  } else {
    if (roomState.isRevote) {
      goToNextNight(roomState, roomId, messagesToBroadcast, '決選投票の結果も同数だったため、誰も処刑されませんでした。');
    } else {
      roomState.isRevote = true;
      roomState.candidates = candidates;
      roomState.votes = {};

      const candidateNames = candidates.map((id: string) => roomState.players[id].name).join(', ');
      
      messagesToBroadcast.push({
        channel: `presence-room-${roomId}`,
        event: 'chat_message',
        payload: {
          sender: 'System',
          text: `投票が同数（${maxVotes}票）だったため、決選投票を行います。対象者: ${candidateNames}。もう一度投票してください。`,
          isSystem: true
        }
      });
    }
  }
}

function goToNextNight(roomState: any, roomId: string, messagesToBroadcast: any[], executionMessage?: string) {
  roomState.status = 'night';
  roomState.dayCount += 1;
  roomState.votes = {};
  roomState.isRevote = false;
  roomState.candidates = null;
  
  messagesToBroadcast.push({
    channel: `presence-room-${roomId}`,
    event: 'chat_message',
    payload: {
      sender: 'System',
      text: '夜が訪れました。夜のアクションを行ってください。',
      isSystem: true
    }
  });

  if (executionMessage) {
    messagesToBroadcast.push({
      channel: `presence-room-${roomId}`,
      event: 'chat_message',
      payload: {
        sender: 'System',
        text: executionMessage,
        isSystem: true
      }
    });
  }

  if (roomState.lastExecutedId) {
    const executed = roomState.players[roomState.lastExecutedId];
    if (executed) {
      const isWolf = executed.role === ROLES.WEREWOLF;
      const resultText = `[霊媒結果] 本日処刑された ${executed.name} は ${isWolf ? '人狼' : '人間'} でした。`;
      
      // 霊媒師全員のプライベートチャネルに結果を送信
      Object.values(roomState.players).forEach((p: any) => {
        if (p.isAlive && p.role === ROLES.MEDIUM) {
          messagesToBroadcast.push({
            channel: `private-user-${p.id}`,
            event: 'chat_message',
            payload: {
              sender: 'System',
              text: resultText,
              isSystem: true
            }
          });
        }
      });
    }
    roomState.lastExecutedId = null;
  }
}

function endGame(roomState: any, winnerTeam: string, messagesToBroadcast: any[]) {
  roomState.status = 'finished';
  roomState.winner = winnerTeam;
  
  const teamName = winnerTeam === 'VILLAGERS' ? '村人陣営' : '人狼陣営';
  
  messagesToBroadcast.push({
    channel: `presence-room-${roomState.id}`,
    event: 'chat_message',
    payload: {
      sender: 'System',
      text: `ゲーム終了！ ${teamName} の勝利です！`,
      isSystem: true
    }
  });
}
