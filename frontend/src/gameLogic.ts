// ─────────────────────────────────────────────
// 役職定数
// ─────────────────────────────────────────────
export const ROLES = {
  VILLAGER: '村人',
  WEREWOLF: '人狼',
  SEER: '占い師',
  KNIGHT: '騎士',
  MADMAN: '狂人',
  MEDIUM: '霊媒師',
  PHANTOM_THIEF: '怪盗'
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

export interface Player {
  id: string;
  name: string;
  role: Role | null;
  isAlive: boolean;
}

export interface RoomState {
  id: string;
  players: Record<string, Player>;
  status: 'waiting' | 'night' | 'day' | 'voting' | 'finished';
  dayCount: number;
  nightActions: Record<string, string | null>;
  votes: Record<string, string | null>;
  winner: string | null;
  isRevote: boolean;
  candidates: string[] | null;
  lastExecutedId: string | null;
  logs: string[];
  rolePool: Role[];
}

// ─────────────────────────────────────────────
// 勝敗判定（純粋関数）
// ─────────────────────────────────────────────
export function checkWinCondition(roomState: RoomState): 'VILLAGERS' | 'WEREWOLVES' | null {
  const players = Object.values(roomState.players);
  const alivePlayers = players.filter(p => p.isAlive);
  const aliveWolves = alivePlayers.filter(p => p.role === ROLES.WEREWOLF);
  const aliveVillagers = alivePlayers.filter(p => p.role !== ROLES.WEREWOLF);

  if (aliveWolves.length === 0) return 'VILLAGERS';
  if (aliveWolves.length >= aliveVillagers.length) return 'WEREWOLVES';
  return null;
}

// ─────────────────────────────────────────────
// 夜アクション処理（純粋関数 - メッセージを返す）
// ─────────────────────────────────────────────
export interface NightResult {
  updatedState: RoomState;
  messages: Array<{ channel: string; text: string; isSystem: boolean }>;
  killedPlayerName: string | null;
}

export function processNightActions(roomState: RoomState): NightResult {
  // ディープコピーして元のStateを壊さない
  const state: RoomState = JSON.parse(JSON.stringify(roomState));
  const messages: Array<{ channel: string; text: string; isSystem: boolean }> = [];

  // 1. 元の役職を記録
  const originalRoles: Record<string, string> = {};
  for (const id of Object.keys(state.players)) {
    originalRoles[id] = state.players[id].role!;
  }

  // 2. 怪盗の処理（1日目のみ）
  for (const [playerId, targetId] of Object.entries(state.nightActions)) {
    if (originalRoles[playerId] === ROLES.PHANTOM_THIEF && targetId && state.dayCount === 1) {
      // 自分自身からは奪えない
      if (targetId !== playerId) {
        const thief = state.players[playerId];
        const target = state.players[targetId];
        if (thief && target) {
          const stolenRole = target.role!;
          thief.role = stolenRole;
          target.role = ROLES.PHANTOM_THIEF;
          messages.push({ channel: `private-user-${playerId}`, text: `[怪盗] ${target.name} の役職（${stolenRole}）を奪いました。`, isSystem: true });
          messages.push({ channel: `private-user-${targetId}`, text: `[システム] 怪盗に役職を奪われました。`, isSystem: true });
        }
      }
      break;
    }
  }

  // 3. 人狼・騎士・占い師の処理
  let knightTarget: string | null = null;
  const wolfTargets: string[] = [];

  // 生存している人狼（アクション権利がある人狼）をリストアップ
  const activeWolves = Object.values(state.players).filter(
    (p) => p.role === ROLES.WEREWOLF && p.isAlive
  );

  for (const [playerId, targetId] of Object.entries(state.nightActions)) {
    const originalRole = originalRoles[playerId];
    if (originalRole === ROLES.WEREWOLF && targetId) {
      // 生存している人狼からのアクションのみを採用
      if (state.players[playerId]?.isAlive) {
        // 自分自身と、味方の人狼（夜開始時点の役職）への襲撃は無効
        const isTargetWolf = originalRoles[targetId] === ROLES.WEREWOLF;
        if (targetId !== playerId && !isTargetWolf) {
          wolfTargets.push(targetId);
        }
      }
    } else if (originalRole === ROLES.KNIGHT && targetId) {
      // 自分自身への護衛は無効
      if (targetId !== playerId) {
        knightTarget = targetId;
      }
    } else if (originalRole === ROLES.SEER && targetId) {
      // 自分自身への占いは無効
      if (targetId !== playerId) {
        const target = state.players[targetId];
        if (target) {
          const result = target.role === ROLES.WEREWOLF ? '人狼' : '人間';
          messages.push({ channel: `private-user-${playerId}`, text: `[占い結果] ${target.name} は ${result} です。`, isSystem: true });
        }
      }
    }
  }

  // 襲撃先の判定：
  // 生存している人狼全員がアクションを送信し、かつそのターゲットが全員一致している場合のみ襲撃成功
  let wolfTarget: string | null = null;
  if (activeWolves.length > 0 && wolfTargets.length === activeWolves.length) {
    const allMatch = wolfTargets.every((val) => val === wolfTargets[0]);
    if (allMatch) {
      wolfTarget = wolfTargets[0];
    }
  }

  // 4. 襲撃処理
  let killedPlayerName: string | null = null;
  if (wolfTarget && wolfTarget !== knightTarget) {
    const victim = state.players[wolfTarget];
    if (victim) {
      victim.isAlive = false;
      killedPlayerName = victim.name;
    }
  }

  state.nightActions = {};
  return { updatedState: state, messages, killedPlayerName };
}

// ─────────────────────────────────────────────
// 投票集計（純粋関数）
// ─────────────────────────────────────────────
export interface VoteResult {
  executedIds: string[];   // 処刑されるプレイヤーのID
  maxVotes: number;
  isTie: boolean;
}

export function tallyVotes(votes: Record<string, string | null>): VoteResult {
  const voteCounts: Record<string, number> = {};
  for (const targetId of Object.values(votes)) {
    if (targetId) {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    }
  }

  let maxVotes = 0;
  let candidates: string[] = [];

  for (const [targetId, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      candidates = [targetId];
    } else if (count === maxVotes) {
      candidates.push(targetId);
    }
  }

  return {
    executedIds: candidates,
    maxVotes,
    isTie: candidates.length > 1
  };
}

// ─────────────────────────────────────────────
// 人狼のロック済みターゲット取得（純粋関数）
// ─────────────────────────────────────────────
/**
 * 人狼が複数いる場合、すでに他の人狼がnaightActionを送信済みであれば
 * そのターゲットIDを返す。まだ誰も送信していなければ null を返す。
 * 自分自身のIDを除外して他の人狼のアクションのみを参照する。
 */
export function getLockedWolfTarget(
  nightActions: Record<string, string | null>,
  players: Record<string, Player>,
  myId: string
): string | null {
  for (const [playerId, targetId] of Object.entries(nightActions)) {
    // 自分以外の生存している人狼がターゲットを選択済みの場合
    const player = players[playerId];
    if (
      playerId !== myId &&
      player?.role === ROLES.WEREWOLF &&
      player.isAlive &&
      targetId !== null &&
      targetId !== undefined
    ) {
      return targetId;
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// プレイヤーが画面上で選択可能（グレーアウトしない）かの判定
// ─────────────────────────────────────────────
export function isPlayerSelectable(
  room: any,
  myId: string,
  targetId: string,
  lockedWolfTarget: string | null,
  isMyActionDone: boolean
): boolean {
  const myPlayer = room.players[myId];
  const targetPlayer = room.players[targetId];

  if (!targetPlayer || !targetPlayer.isAlive || isMyActionDone) {
    return false;
  }

  if (room.status === 'voting') {
    const isCandidate = !room.candidates || room.candidates.includes(targetId);
    return isCandidate;
  }

  if (room.status === 'night') {
    let isNightTargetValid = true;
    if (myPlayer) {
      // 1. 自分自身を選べない役職 (占い師、怪盗、騎士、人狼)
      const cannotSelectSelf = ['占い師', '怪盗', '騎士', '人狼'].includes(myPlayer.role);
      if (cannotSelectSelf && targetId === myId) {
        isNightTargetValid = false;
      }
      // 2. 味方の人狼を選べない (人狼)
      if (myPlayer.role === ROLES.WEREWOLF && targetPlayer.role === ROLES.WEREWOLF) {
        isNightTargetValid = false;
      }
      // 3. 人狼が複数いる場合、仲間が選んだターゲット以外は選べない
      if (myPlayer.role === ROLES.WEREWOLF && lockedWolfTarget && targetId !== lockedWolfTarget) {
        isNightTargetValid = false;
      }
    }
    return isNightTargetValid;
  }

  return false;
}
