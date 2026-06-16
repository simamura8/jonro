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
      const thief = state.players[playerId];
      const target = state.players[targetId];
      if (thief && target) {
        const stolenRole = target.role!;
        thief.role = stolenRole;
        target.role = ROLES.PHANTOM_THIEF;
        messages.push({ channel: `private-user-${playerId}`, text: `[怪盗] ${target.name} の役職（${stolenRole}）を奪いました。`, isSystem: true });
        messages.push({ channel: `private-user-${targetId}`, text: `[システム] 怪盗に役職を奪われました。`, isSystem: true });
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
        wolfTargets.push(targetId);
      }
    } else if (originalRole === ROLES.KNIGHT && targetId) {
      knightTarget = targetId;
    } else if (originalRole === ROLES.SEER && targetId) {
      const target = state.players[targetId];
      if (target) {
        const result = target.role === ROLES.WEREWOLF ? '人狼' : '人間';
        messages.push({ channel: `private-user-${playerId}`, text: `[占い結果] ${target.name} は ${result} です。`, isSystem: true });
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
