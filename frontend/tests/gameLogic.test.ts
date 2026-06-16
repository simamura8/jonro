import { describe, it, expect } from 'vitest';
import {
  checkWinCondition,
  processNightActions,
  tallyVotes,
  ROLES,
  type RoomState,
  type Player,
  type Role,
} from '../src/gameLogic';

// ═════════════════════════════════════════════
// テスト用ヘルパー
// ═════════════════════════════════════════════

/** プレイヤーを1人作成 */
function p(id: string, name: string, role: Role, isAlive = true): Player {
  return { id, name, role, isAlive };
}

/** ルーム状態を作成（nightActionsは省略可能） */
function makeRoom(
  players: Player[],
  nightActions: Record<string, string | null> = {},
  overrides: Partial<RoomState> = {}
): RoomState {
  return {
    id: 'TEST',
    players: Object.fromEntries(players.map(pl => [pl.id, pl])),
    status: 'night',
    dayCount: 1,
    nightActions,
    votes: {},
    winner: null,
    isRevote: false,
    candidates: null,
    lastExecutedId: null,
    logs: [],
    rolePool: [],
    ...overrides,
  };
}

// ═════════════════════════════════════════════
// 1. 勝敗判定テスト（checkWinCondition）
// ═════════════════════════════════════════════
describe('checkWinCondition — 勝敗判定', () => {
  // ─── 村人陣営の勝利 ───────────────────────
  describe('村人陣営の勝利パターン', () => {
    it('人狼が1人で死亡している → 村人の勝ち', () => {
      const room = makeRoom([
        p('a', 'アリス', ROLES.VILLAGER),
        p('b', 'ボブ', ROLES.SEER),
        p('w', '人狼', ROLES.WEREWOLF, false), // 死亡
      ]);
      expect(checkWinCondition(room)).toBe('VILLAGERS');
    });

    it('人狼が複数いて全員死亡している → 村人の勝ち', () => {
      const room = makeRoom([
        p('a', 'アリス', ROLES.VILLAGER),
        p('b', 'ボブ', ROLES.VILLAGER),
        p('w1', '人狼A', ROLES.WEREWOLF, false),
        p('w2', '人狼B', ROLES.WEREWOLF, false),
      ]);
      expect(checkWinCondition(room)).toBe('VILLAGERS');
    });

    it('狂人だけ生き残っていて人狼が全員死亡 → 村人の勝ち（狂人は村人側とカウント）', () => {
      // 狂人は role === '人狼' ではないので村人側カウント
      const room = makeRoom([
        p('m', '狂人', ROLES.MADMAN),
        p('w', '人狼', ROLES.WEREWOLF, false),
      ]);
      expect(checkWinCondition(room)).toBe('VILLAGERS');
    });

    it('怪盗が人狼の役職を奪った後、もともとの人狼が死亡 → 実際の役職で判定される', () => {
      // 怪盗が人狼役職を持ち（現在の role = '人狼'）、もともとの人狼は '怪盗' に変わっている
      // → 人狼ロールのプレイヤーが生きているので人狼の勝ちになるはず
      const room = makeRoom([
        p('a', 'アリス', ROLES.VILLAGER),
        p('thief', '怪盗→人狼', ROLES.WEREWOLF), // 怪盗が人狼役職を奪って現在 '人狼'
        p('w', '人狼→怪盗', ROLES.PHANTOM_THIEF), // もともと人狼、現在 '怪盗'
      ]);
      // 人狼ロール保持者（怪盗が奪った）が生存 → まだ勝負つかず
      expect(checkWinCondition(room)).toBeNull();
    });
  });

  // ─── 人狼陣営の勝利 ───────────────────────
  describe('人狼陣営の勝利パターン', () => {
    it('人狼1人 vs 村人1人 → 同数なので人狼の勝ち', () => {
      const room = makeRoom([
        p('a', 'アリス', ROLES.VILLAGER),
        p('w', '人狼', ROLES.WEREWOLF),
      ]);
      expect(checkWinCondition(room)).toBe('WEREWOLVES');
    });

    it('人狼2人 vs 村人1人・騎士1人 → 人狼の勝ち', () => {
      const room = makeRoom([
        p('a', 'アリス', ROLES.VILLAGER),
        p('k', '騎士', ROLES.KNIGHT),
        p('w1', '人狼A', ROLES.WEREWOLF),
        p('w2', '人狼B', ROLES.WEREWOLF),
      ]);
      expect(checkWinCondition(room)).toBe('WEREWOLVES');
    });

    it('人狼1人 vs 狂人1人（村人0人）→ 人狼の勝ち', () => {
      // 狂人は村人側カウントだが、人狼が村人(非人狼)と同数
      const room = makeRoom([
        p('m', '狂人', ROLES.MADMAN),
        p('w', '人狼', ROLES.WEREWOLF),
      ]);
      expect(checkWinCondition(room)).toBe('WEREWOLVES');
    });
  });

  // ─── 決着なし ───────────────────────────
  describe('まだ決着がついていないパターン', () => {
    it('人狼1人 vs 村人2人 → null', () => {
      const room = makeRoom([
        p('a', 'アリス', ROLES.VILLAGER),
        p('b', 'ボブ', ROLES.SEER),
        p('w', '人狼', ROLES.WEREWOLF),
      ]);
      expect(checkWinCondition(room)).toBeNull();
    });

    it('人狼1人 vs 村人1人・占い師1人 → null', () => {
      const room = makeRoom([
        p('a', 'アリス', ROLES.VILLAGER),
        p('s', '占い師', ROLES.SEER),
        p('w', '人狼', ROLES.WEREWOLF),
      ]);
      expect(checkWinCondition(room)).toBeNull();
    });

    it('死亡した村人は生存者カウントから除外される', () => {
      // 生存: 村人1 + 人狼1 → 同数 → 人狼の勝ち
      const room = makeRoom([
        p('a', 'アリス', ROLES.VILLAGER, false), // 死亡
        p('b', 'ボブ', ROLES.VILLAGER),          // 生存
        p('w', '人狼', ROLES.WEREWOLF),           // 生存
      ]);
      expect(checkWinCondition(room)).toBe('WEREWOLVES');
    });
  });
});

// ═════════════════════════════════════════════
// 2. 夜フェーズ処理テスト（processNightActions）
// ═════════════════════════════════════════════
describe('processNightActions — 夜フェーズ処理', () => {
  // ─── 人狼の襲撃 ────────────────────────
  describe('人狼の襲撃', () => {
    it('人狼が村人を襲撃する → その村人が死亡する', () => {
      const room = makeRoom(
        [p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER), p('b', 'ボブ', ROLES.VILLAGER)],
        { w: 'a' } // 人狼がアリスを狙う
      );
      const { updatedState, killedPlayerName } = processNightActions(room);

      expect(killedPlayerName).toBe('アリス');
      expect(updatedState.players['a'].isAlive).toBe(false);
      expect(updatedState.players['b'].isAlive).toBe(true); // ボブは無事
    });

    it('人狼が誰も狙わない（targetId = null）→ 誰も死なない', () => {
      const room = makeRoom(
        [p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        { w: null }
      );
      const { killedPlayerName } = processNightActions(room);
      expect(killedPlayerName).toBeNull();
    });

    it('夜アクションが誰もない（全員スキップ）→ 誰も死なない', () => {
      const room = makeRoom(
        [p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        {} // アクションなし
      );
      const { killedPlayerName } = processNightActions(room);
      expect(killedPlayerName).toBeNull();
    });

    it('夜フェーズ終了後、nightActionsがリセットされる', () => {
      const room = makeRoom(
        [p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        { w: 'a' }
      );
      const { updatedState } = processNightActions(room);
      expect(Object.keys(updatedState.nightActions)).toHaveLength(0);
    });

    it('元のRoomStateは変更されない（ディープコピーの確認）', () => {
      const room = makeRoom(
        [p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        { w: 'a' }
      );
      processNightActions(room);

      // 元のStateのアリスはまだ生存しているはず
      expect(room.players['a'].isAlive).toBe(true);
    });

    it('人狼が2人いて、同じ人を襲撃する → その人が死亡する', () => {
      const room = makeRoom(
        [
          p('w1', '人狼A', ROLES.WEREWOLF),
          p('w2', '人狼B', ROLES.WEREWOLF),
          p('a', 'アリス', ROLES.VILLAGER),
        ],
        { w1: 'a', w2: 'a' } // 2人ともアリスを狙う
      );
      const { killedPlayerName, updatedState } = processNightActions(room);
      expect(killedPlayerName).toBe('アリス');
      expect(updatedState.players['a'].isAlive).toBe(false);
    });

    it('人狼が2人いて、別々の人を襲撃する → 誰も死なない（襲撃失敗）', () => {
      const room = makeRoom(
        [
          p('w1', '人狼A', ROLES.WEREWOLF),
          p('w2', '人狼B', ROLES.WEREWOLF),
          p('a', 'アリス', ROLES.VILLAGER),
          p('b', 'ボブ', ROLES.VILLAGER),
        ],
        { w1: 'a', w2: 'b' } // Aはアリス、Bはボブを狙う
      );
      const { killedPlayerName, updatedState } = processNightActions(room);
      expect(killedPlayerName).toBeNull();
      expect(updatedState.players['a'].isAlive).toBe(true);
      expect(updatedState.players['b'].isAlive).toBe(true);
    });

    it('人狼が2人いて、片方が未選択 → 誰も死なない（襲撃失敗）', () => {
      const room = makeRoom(
        [
          p('w1', '人狼A', ROLES.WEREWOLF),
          p('w2', '人狼B', ROLES.WEREWOLF),
          p('a', 'アリス', ROLES.VILLAGER),
        ],
        { w1: 'a', w2: null } // Bは未選択
      );
      const { killedPlayerName, updatedState } = processNightActions(room);
      expect(killedPlayerName).toBeNull();
      expect(updatedState.players['a'].isAlive).toBe(true);
    });

    it('人狼が2人いて、うち1人は死亡している → 生きている人狼のアクションのみで襲撃が決定する', () => {
      const room = makeRoom(
        [
          p('w1', '人狼A（生存）', ROLES.WEREWOLF),
          p('w2', '人狼B（死亡）', ROLES.WEREWOLF, false), // 死亡している
          p('a', 'アリス', ROLES.VILLAGER),
        ],
        { w1: 'a' } // 生きている人狼Aだけがアクション
      );
      const { killedPlayerName, updatedState } = processNightActions(room);
      expect(killedPlayerName).toBe('アリス');
      expect(updatedState.players['a'].isAlive).toBe(false);
    });

    it('人狼が自分自身を襲撃対象に選んだ場合 → 襲撃無効（誰も死なない）', () => {
      const room = makeRoom(
        [p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        { w: 'w' } // 自分を襲撃
      );
      const { killedPlayerName, updatedState } = processNightActions(room);
      expect(killedPlayerName).toBeNull();
      expect(updatedState.players['w'].isAlive).toBe(true);
    });

    it('人狼Aが味方の人狼Bを襲撃対象に選んだ場合 → 襲撃無効（誰も死なない）', () => {
      const room = makeRoom(
        [
          p('w1', '人狼A', ROLES.WEREWOLF),
          p('w2', '人狼B', ROLES.WEREWOLF),
          p('a', 'アリス', ROLES.VILLAGER),
        ],
        { w1: 'w2', w2: 'a' } // w1がw2（味方）を、w2がアリスを狙う（不一致扱い）
      );
      const { killedPlayerName } = processNightActions(room);
      expect(killedPlayerName).toBeNull();
    });
  });

  // ─── 騎士の護衛 ────────────────────────
  describe('騎士の護衛', () => {
    it('騎士が人狼の標的と同じ人を護衛 → 死なない', () => {
      const room = makeRoom(
        [p('w', '人狼', ROLES.WEREWOLF), p('k', '騎士', ROLES.KNIGHT), p('a', 'アリス', ROLES.VILLAGER)],
        { w: 'a', k: 'a' } // 人狼と騎士が同じアリスを指定
      );
      const { killedPlayerName, updatedState } = processNightActions(room);

      expect(killedPlayerName).toBeNull();
      expect(updatedState.players['a'].isAlive).toBe(true);
    });

    it('騎士が別の人を護衛 → 人狼の標的は死亡する', () => {
      const room = makeRoom(
        [p('w', '人狼', ROLES.WEREWOLF), p('k', '騎士', ROLES.KNIGHT), p('a', 'アリス', ROLES.VILLAGER), p('b', 'ボブ', ROLES.VILLAGER)],
        { w: 'a', k: 'b' } // 人狼はアリスを狙い、騎士はボブを護衛
      );
      const { killedPlayerName } = processNightActions(room);

      expect(killedPlayerName).toBe('アリス');
    });

    it('騎士が護衛してもメッセージは全体には届かない（護衛は秘密）', () => {
      const room = makeRoom(
        [p('w', '人狼', ROLES.WEREWOLF), p('k', '騎士', ROLES.KNIGHT), p('a', 'アリス', ROLES.VILLAGER)],
        { w: 'a', k: 'a' }
      );
      const { messages } = processNightActions(room);

      // 護衛に関するメッセージは出ない
      const knightMsg = messages.find(m => m.text.includes('護衛'));
      expect(knightMsg).toBeUndefined();
    });

    it('騎士が自分自身を護衛 → 護衛無効（人狼に狙われたら死亡する）', () => {
      const room = makeRoom(
        [p('w', '人狼', ROLES.WEREWOLF), p('k', '騎士', ROLES.KNIGHT)],
        { w: 'k', k: 'k' } // 人狼が騎士を狙い、騎士が自分自身を護衛
      );
      const { killedPlayerName, updatedState } = processNightActions(room);
      expect(killedPlayerName).toBe('騎士');
      expect(updatedState.players['k'].isAlive).toBe(false); // 護衛無効で死亡
    });
  });

  // ─── 占い師の占い ────────────────────────
  describe('占い師の占い', () => {
    it('占い師が人狼を占う → 「人狼」という結果が占い師にのみ届く', () => {
      const room = makeRoom(
        [p('s', '占い師', ROLES.SEER), p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        { s: 'w', w: 'a' }
      );
      const { messages } = processNightActions(room);

      const seerMsg = messages.find(m => m.channel === 'private-user-s');
      expect(seerMsg).toBeDefined();
      expect(seerMsg!.text).toContain('人狼');
    });

    it('占い師が村人を占う → 「人間」という結果が占い師にのみ届く', () => {
      const room = makeRoom(
        [p('s', '占い師', ROLES.SEER), p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        { s: 'a', w: 's' }
      );
      const { messages } = processNightActions(room);

      const seerMsg = messages.find(m => m.channel === 'private-user-s');
      expect(seerMsg).toBeDefined();
      expect(seerMsg!.text).toContain('人間');
    });

    it('占い師が狂人を占う → 「人間」という結果になる（狂人は人間判定）', () => {
      const room = makeRoom(
        [p('s', '占い師', ROLES.SEER), p('w', '人狼', ROLES.WEREWOLF), p('m', '狂人', ROLES.MADMAN)],
        { s: 'm', w: 's' }
      );
      const { messages } = processNightActions(room);

      const seerMsg = messages.find(m => m.channel === 'private-user-s');
      expect(seerMsg!.text).toContain('人間');
    });

    it('占い結果は対象外のプレイヤーには届かない', () => {
      const room = makeRoom(
        [p('s', '占い師', ROLES.SEER), p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        { s: 'w', w: 'a' }
      );
      const { messages } = processNightActions(room);

      // アリスや人狼のチャンネルに占い結果が届かない
      const wolfMsg = messages.find(m => m.channel === 'private-user-w' && m.text.includes('占い'));
      const aliceMsg = messages.find(m => m.channel === 'private-user-a' && m.text.includes('占い'));
      expect(wolfMsg).toBeUndefined();
      expect(aliceMsg).toBeUndefined();
    });

    it('占い師が誰も占わない（null）→ 占い結果メッセージが届かない', () => {
      const room = makeRoom(
        [p('s', '占い師', ROLES.SEER), p('w', '人狼', ROLES.WEREWOLF)],
        { s: null, w: 's' }
      );
      const { messages } = processNightActions(room);

      const seerMsg = messages.find(m => m.channel === 'private-user-s' && m.text.includes('占い'));
      expect(seerMsg).toBeUndefined();
    });

    it('占い師が自分自身を占う → 占い無効（結果メッセージが届かない）', () => {
      const room = makeRoom(
        [p('s', '占い師', ROLES.SEER), p('w', '人狼', ROLES.WEREWOLF)],
        { s: 's', w: 'w' } // 占い師が自分自身を占う
      );
      const { messages } = processNightActions(room);
      const seerMsg = messages.find(m => m.channel === 'private-user-s' && m.text.includes('占い'));
      expect(seerMsg).toBeUndefined(); // メッセージなし
    });
  });

  // ─── 怪盗の役職交換 ────────────────────────
  describe('怪盗の役職交換', () => {
    it('怪盗が村人の役職を奪う → 役職が交換される', () => {
      const room = makeRoom(
        [p('t', '怪盗', ROLES.PHANTOM_THIEF), p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        { t: 'a', w: 't' }
      );
      const { updatedState } = processNightActions(room);

      expect(updatedState.players['t'].role).toBe(ROLES.VILLAGER);      // 怪盗 → 村人
      expect(updatedState.players['a'].role).toBe(ROLES.PHANTOM_THIEF); // アリス → 怪盗
    });

    it('怪盗が人狼の役職を奪う → 役職が交換される', () => {
      const room = makeRoom(
        [p('t', '怪盗', ROLES.PHANTOM_THIEF), p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        { t: 'w', w: 'a' }
      );
      const { updatedState } = processNightActions(room);

      expect(updatedState.players['t'].role).toBe(ROLES.WEREWOLF);      // 怪盗 → 人狼
      expect(updatedState.players['w'].role).toBe(ROLES.PHANTOM_THIEF); // 人狼 → 怪盗
    });

    it('怪盗が役職を奪うと、怪盗本人に通知が届く', () => {
      const room = makeRoom(
        [p('t', '怪盗', ROLES.PHANTOM_THIEF), p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        { t: 'w', w: 'a' }
      );
      const { messages } = processNightActions(room);

      const thiefMsg = messages.find(m => m.channel === 'private-user-t');
      expect(thiefMsg).toBeDefined();
      expect(thiefMsg!.text).toContain('人狼'); // 奪った役職名が含まれる
    });

    it('役職を奪われた相手にも通知が届く', () => {
      const room = makeRoom(
        [p('t', '怪盗', ROLES.PHANTOM_THIEF), p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        { t: 'w', w: 'a' }
      );
      const { messages } = processNightActions(room);

      const victimMsg = messages.find(m => m.channel === 'private-user-w');
      expect(victimMsg).toBeDefined();
      expect(victimMsg!.text).toContain('怪盗');
    });

    it('怪盗が人狼を奪った後、占い師がその怪盗を占う → 「人狼」と見える（現在の役職で判定）', () => {
      const room = makeRoom(
        [
          p('t', '怪盗', ROLES.PHANTOM_THIEF),
          p('w', '人狼', ROLES.WEREWOLF),
          p('s', '占い師', ROLES.SEER),
          p('a', 'アリス', ROLES.VILLAGER),
        ],
        { t: 'w', w: 'a', s: 't' } // 怪盗が人狼を奪い、占い師が怪盗を占う
      );
      const { messages } = processNightActions(room);

      const seerMsg = messages.find(m => m.channel === 'private-user-s');
      expect(seerMsg!.text).toContain('人狼'); // 怪盗は今や人狼ロールなので人狼と見える
    });

    it('もともとの人狼（役職を奪われて今は怪盗）を占い師が占う → 「人間」と見える', () => {
      const room = makeRoom(
        [
          p('t', '怪盗', ROLES.PHANTOM_THIEF),
          p('w', '人狼', ROLES.WEREWOLF),
          p('s', '占い師', ROLES.SEER),
          p('a', 'アリス', ROLES.VILLAGER),
        ],
        { t: 'w', w: 'a', s: 'w' } // 怪盗が人狼を奪い、占い師がもともとの人狼を占う
      );
      const { messages } = processNightActions(room);

      const seerMsg = messages.find(m => m.channel === 'private-user-s');
      // 'w' は現在 '怪盗' ロールなので人間と見える
      expect(seerMsg!.text).toContain('人間');
    });

    it('怪盗は2日目以降は役職を奪えない', () => {
      const room = makeRoom(
        [p('t', '怪盗', ROLES.PHANTOM_THIEF), p('w', '人狼', ROLES.WEREWOLF)],
        { t: 'w' },
        { dayCount: 2 } // 2日目
      );
      const { updatedState } = processNightActions(room);

      expect(updatedState.players['t'].role).toBe(ROLES.PHANTOM_THIEF); // 変わらない
      expect(updatedState.players['w'].role).toBe(ROLES.WEREWOLF);      // 変わらない
    });

    it('怪盗が誰も狙わない（null）→ 役職は変わらない', () => {
      const room = makeRoom(
        [p('t', '怪盗', ROLES.PHANTOM_THIEF), p('w', '人狼', ROLES.WEREWOLF)],
        { t: null, w: 't' }
      );
      const { updatedState } = processNightActions(room);

      expect(updatedState.players['t'].role).toBe(ROLES.PHANTOM_THIEF);
    });

    it('人狼の行動は怪盗の役職交換後も「元の役職」で判定される', () => {
      // 人狼が村人を狙う → 怪盗が人狼役職を奪っても、元々の人狼のアクションは有効
      const room = makeRoom(
        [p('t', '怪盗', ROLES.PHANTOM_THIEF), p('w', '人狼', ROLES.WEREWOLF), p('a', 'アリス', ROLES.VILLAGER)],
        { t: 'w', w: 'a' } // 怪盗が人狼を奪い、もともとの人狼がアリスを狙う
      );
      const { killedPlayerName } = processNightActions(room);

      // 元々の人狼 'w' のアクションで アリスが死ぬ
      expect(killedPlayerName).toBe('アリス');
    });

    it('怪盗が自分自身から奪う → 奪うアクション無効（役職は怪盗のまま）', () => {
      const room = makeRoom(
        [p('t', '怪盗', ROLES.PHANTOM_THIEF), p('w', '人狼', ROLES.WEREWOLF)],
        { t: 't' } // 怪盗が自分自身を指名
      );
      const { updatedState, messages } = processNightActions(room);
      expect(updatedState.players['t'].role).toBe(ROLES.PHANTOM_THIEF); // 変わらない
      const thiefMsg = messages.find(m => m.channel === 'private-user-t' && m.text.includes('奪いました'));
      expect(thiefMsg).toBeUndefined(); // メッセージも届かない
    });
  });

  // ─── 複合シナリオ ────────────────────────
  describe('複合シナリオ', () => {
    it('占い師・騎士・人狼が全員アクション → それぞれ正しく処理される', () => {
      const room = makeRoom(
        [
          p('w', '人狼', ROLES.WEREWOLF),
          p('s', '占い師', ROLES.SEER),
          p('k', '騎士', ROLES.KNIGHT),
          p('a', 'アリス', ROLES.VILLAGER),
          p('b', 'ボブ', ROLES.VILLAGER),
        ],
        { w: 'a', s: 'w', k: 'a' } // 人狼がアリスを狙い、騎士もアリスを護衛、占い師が人狼を占う
      );
      const { killedPlayerName, messages, updatedState } = processNightActions(room);

      expect(killedPlayerName).toBeNull();                                     // 護衛成功
      expect(updatedState.players['a'].isAlive).toBe(true);                   // アリス生存
      const seerMsg = messages.find(m => m.channel === 'private-user-s');
      expect(seerMsg!.text).toContain('人狼');                                  // 占い結果正常
    });
  });
});

// ═════════════════════════════════════════════
// 3. 投票集計テスト（tallyVotes）
// ═════════════════════════════════════════════
describe('tallyVotes — 投票集計', () => {
  // ─── 通常の投票 ───────────────────────
  describe('通常の投票', () => {
    it('全員が1人に投票 → その1人が処刑対象（同数なし）', () => {
      const votes = { p1: 'p4', p2: 'p4', p3: 'p4' };
      const result = tallyVotes(votes);

      expect(result.executedIds).toEqual(['p4']);
      expect(result.maxVotes).toBe(3);
      expect(result.isTie).toBe(false);
    });

    it('最多票の1人が選ばれる', () => {
      const votes = { p1: 'p4', p2: 'p4', p3: 'p3' }; // p4に2票、p3に1票
      const result = tallyVotes(votes);

      expect(result.executedIds).toEqual(['p4']);
      expect(result.maxVotes).toBe(2);
      expect(result.isTie).toBe(false);
    });

    it('自分自身に投票することもある（自己投票）', () => {
      const votes = { p1: 'p1', p2: 'p1', p3: 'p2' };
      const result = tallyVotes(votes);

      expect(result.executedIds).toEqual(['p1']);
    });
  });

  // ─── 同数（タイ）の処理 ───────────────────────
  describe('同数票（タイ）の処理', () => {
    it('2人が同数票 → タイフラグが立ちどちらも候補になる', () => {
      const votes = { p1: 'p3', p2: 'p4', p3: 'p3', p4: 'p4' }; // p3=2票, p4=2票
      const result = tallyVotes(votes);

      expect(result.isTie).toBe(true);
      expect(result.executedIds).toHaveLength(2);
      expect(result.executedIds).toContain('p3');
      expect(result.executedIds).toContain('p4');
    });

    it('3人が同数票 → 3人全員が候補になる', () => {
      const votes = { p1: 'p2', p2: 'p3', p3: 'p4', p4: 'p2', p5: 'p3', p6: 'p4' };
      // p2=2票, p3=2票, p4=2票
      const result = tallyVotes(votes);

      expect(result.isTie).toBe(true);
      expect(result.executedIds).toHaveLength(3);
    });
  });

  // ─── 投票ゼロ・nullの扱い ───────────────────────
  describe('投票なし・null票の扱い', () => {
    it('全員 null（誰も投票しなかった）→ maxVotes=0, 候補なし', () => {
      const votes = { p1: null, p2: null, p3: null };
      const result = tallyVotes(votes);

      expect(result.maxVotes).toBe(0);
      expect(result.executedIds).toHaveLength(0);
      expect(result.isTie).toBe(false);
    });

    it('一部が null → null は集計に含まれない', () => {
      const votes = { p1: 'p3', p2: null, p3: null, p4: 'p3' }; // p3に2票、nullは無視
      const result = tallyVotes(votes);

      expect(result.executedIds).toEqual(['p3']);
      expect(result.maxVotes).toBe(2);
    });

    it('投票が空（{}）→ maxVotes=0, 候補なし', () => {
      const result = tallyVotes({});

      expect(result.maxVotes).toBe(0);
      expect(result.executedIds).toHaveLength(0);
    });

    it('1人だけ投票して残りはnull → その1票が最多票', () => {
      const votes = { p1: 'p2', p2: null, p3: null };
      const result = tallyVotes(votes);

      expect(result.executedIds).toEqual(['p2']);
      expect(result.maxVotes).toBe(1);
    });
  });

  // ─── 複数プレイヤーの大人数投票 ───────────────────────
  describe('大人数（6人）での投票', () => {
    it('6人で1人に票が集中 → isTie=false', () => {
      const votes = {
        p1: 'p6', p2: 'p6', p3: 'p6',
        p4: 'p5', p5: 'p4', p6: 'p3',
      };
      // p6=3票, p5=1票, p4=1票, p3=1票
      const result = tallyVotes(votes);

      expect(result.executedIds).toEqual(['p6']);
      expect(result.isTie).toBe(false);
    });
  });
});
