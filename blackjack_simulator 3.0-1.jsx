import { useState, useEffect, useRef, useCallback } from "react";

// ─── GAME ENGINE (faithful port from notebook) ───────────────────────────────

function buildDeck(nd = 6) {
  const single = [2,3,4,5,6,7,8,9,10,10,10,10,11];
  let deck = [];
  for (let d = 0; d < nd; d++)
    for (let s = 0; s < 4; s++)
      deck.push(...single);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handValue(hand) {
  let total = hand.reduce((a, b) => a + b, 0);
  let aces = hand.filter(c => c === 11).length;
  while (total > 21 && aces) { total -= 10; aces--; }
  return total;
}

function isSoft(hand) {
  return hand.includes(11) && handValue(hand) <= 21;
}

function hiLoTag(card) {
  if ([2,3,4,5,6].includes(card)) return 1;
  if ([10,11].includes(card)) return -1;
  return 0;
}

function hiLoCat(card) {
  if ([2,3,4,5,6].includes(card)) return 'L';
  if ([10,11].includes(card)) return 'H';
  return 'M';
}

function trueCount(rc, cardsLeft) {
  return rc / Math.max(cardsLeft / 52, 0.5);
}

function hiLoBet(tc) {
  if (tc <= 1) return 1;
  if (tc <= 2) return 3;
  if (tc <= 3) return 8;
  if (tc <= 4) return 14;
  return 20;
}

function cardProbs(L, M, H, nd = 6) {
  const N = Math.max(52 * nd - (L + M + H), 1);
  const pl = (Math.max(20 * nd - L, 0) / N) / 5;
  const pm = (Math.max(12 * nd - M, 0) / N) / 3;
  const pt = (Math.max(20 * nd - H, 0) / N) * 0.8;
  const pa = (Math.max(20 * nd - H, 0) / N) * 0.2;
  return {2:pl,3:pl,4:pl,5:pl,6:pl,7:pm,8:pm,9:pm,10:pt,11:pa};
}

function dealerOutcomes(upcard, probs) {
  const hard = [];
  for (let i = 4; i <= 21; i++) hard.push(i);
  hard.push('bust');
  const soft = [];
  for (let i = 12; i <= 21; i++) soft.push('s' + i);
  const states = [...hard, ...soft];
  const idx = {};
  states.forEach((s, i) => idx[s] = i);
  const n = states.length;

  const T = Array.from({length: n}, () => new Float64Array(n));

  function absorb(s) {
    if (s === 'bust') return true;
    if (typeof s === 'number') return s >= 17;
    return parseInt(s.slice(1)) >= 17;
  }

  for (const s of states) {
    if (absorb(s)) { T[idx[s]][idx[s]] = 1.0; continue; }
    for (const [cardStr, prob] of Object.entries(probs)) {
      const card = parseInt(cardStr);
      if (prob === 0) continue;
      let ns;
      if (typeof s === 'string') {
        const cur = parseInt(s.slice(1));
        if (card === 11) {
          const nt = cur + 1;
          ns = nt <= 21 ? nt : 'bust';
        } else {
          const nt = cur + card;
          if (nt > 21) {
            const nt2 = cur - 10 + card;
            ns = nt2 > 21 ? 'bust' : nt2;
          } else {
            ns = 's' + nt;
          }
        }
      } else {
        if (card === 11) {
          ns = s + 11 <= 21 ? 's' + (s + 11) : (s + 1 <= 21 ? s + 1 : 'bust');
        } else {
          const nt = s + card;
          ns = nt > 21 ? 'bust' : nt;
        }
      }
      if (!(ns in idx)) ns = 'bust';
      T[idx[s]][idx[ns]] += prob;
    }
  }

  // Matrix power T^17
  let result = Array.from({length: n}, (_, i) => {
    const row = new Float64Array(n);
    row[i] = 1;
    return row;
  });

  let base = T.map(r => Float64Array.from(r));
  let power = 17;
  while (power > 0) {
    if (power % 2 === 1) {
      const newR = Array.from({length: n}, () => new Float64Array(n));
      for (let i = 0; i < n; i++)
        for (let k = 0; k < n; k++) {
          if (result[i][k] === 0) continue;
          for (let j = 0; j < n; j++)
            newR[i][j] += result[i][k] * base[k][j];
        }
      result = newR;
    }
    const newB = Array.from({length: n}, () => new Float64Array(n));
    for (let i = 0; i < n; i++)
      for (let k = 0; k < n; k++) {
        if (base[i][k] === 0) continue;
        for (let j = 0; j < n; j++)
          newB[i][j] += base[i][k] * base[k][j];
      }
    base = newB;
    power = Math.floor(power / 2);
  }

  const upcardIdx = typeof upcard === 'string' ? idx[upcard] : idx[upcard];
  const dist = result[upcardIdx];

  const out = {};
  for (const [s, i] of Object.entries(idx)) {
    if (!absorb(s === 'bust' ? 'bust' : (typeof s === 'string' && s !== 'bust' ? s : parseInt(s)))) continue;
    const k = s === 'bust' ? 'bust' : (typeof s === 'string' && s !== 'bust' ? parseInt(s.slice(1)) : parseInt(s));
    out[k] = (out[k] || 0) + dist[i];
  }
  return out;
}

function eStand(ptotal, upcard, probs) {
  const out = dealerOutcomes(upcard, probs);
  let ev = 0;
  for (const [dStr, p] of Object.entries(out)) {
    const d = dStr === 'bust' ? 'bust' : parseInt(dStr);
    if (d === 'bust' || (typeof d === 'number' && d < ptotal)) ev += p;
    else if (typeof d === 'number' && d > ptotal) ev -= p;
  }
  return ev;
}

function eHit(ptotal, soft, upcard, probs, memo) {
  const key = `${ptotal},${soft},${upcard}`;
  if (memo[key] !== undefined) return memo[key];
  let ev = 0;
  for (const [cardStr, prob] of Object.entries(probs)) {
    const card = parseInt(cardStr);
    if (prob === 0) continue;
    let nt, ns;
    if (soft) {
      if (card === 11) { nt = ptotal + 1; ns = false; }
      else {
        nt = ptotal + card; ns = nt <= 21;
        if (nt > 21) { nt -= 10; ns = false; }
      }
    } else {
      if (card === 11) {
        if (ptotal + 11 <= 21) { nt = ptotal + 11; ns = true; }
        else { nt = ptotal + 1; ns = false; }
      } else { nt = ptotal + card; ns = false; }
    }
    if (nt > 21) { ev += prob * (-1); }
    else if (nt === 21) { ev += prob * eStand(21, upcard, probs); }
    else {
      const es = eStand(nt, upcard, probs);
      const eh = eHit(nt, ns, upcard, probs, memo);
      ev += prob * Math.max(es, eh);
    }
  }
  memo[key] = ev;
  return ev;
}

function buildOptimalTable(L, M, H, nd = 6) {
  const probs = cardProbs(L, M, H, nd);
  const memo = {};
  const table = {};
  for (const upcard of [2,3,4,5,6,7,8,9,10,11]) {
    for (let ptotal = 4; ptotal <= 20; ptotal++) {
      for (const soft of [false, true]) {
        if (soft && ptotal < 12) continue;
        if (ptotal <= 11 && !soft) {
          table[`${ptotal},${soft},${upcard}`] = 'hit';
          continue;
        }
        const es = eStand(ptotal, upcard, probs);
        const eh = eHit(ptotal, soft, upcard, probs, memo);
        table[`${ptotal},${soft},${upcard}`] = es >= eh ? 'stand' : 'hit';
      }
    }
  }
  return table;
}

function basicStrategy(ptotal, upcard, soft) {
  const d = upcard;
  if (soft) {
    if (ptotal >= 19) return 'stand';
    if (ptotal === 18) return [9,10,11].includes(d) ? 'hit' : 'stand';
    return 'hit';
  } else {
    if (ptotal >= 17) return 'stand';
    if (ptotal >= 13) return [2,3,4,5,6].includes(d) ? 'stand' : 'hit';
    if (ptotal === 12) return [4,5,6].includes(d) ? 'stand' : 'hit';
    return 'hit';
  }
}

// ─── CARD DISPLAY HELPERS ────────────────────────────────────────────────────

const SUITS = ['♠','♥','♦','♣'];
const RANK_NAMES = {2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'A'};

function cardToDisplay(val, suitIdx) {
  const rank = RANK_NAMES[val] || '?';
  // For 10-value cards, randomly show J/Q/K/10
  let displayRank = rank;
  if (val === 10) {
    const faces = ['10','J','Q','K'];
    displayRank = faces[suitIdx % 4];
  }
  const suit = SUITS[suitIdx % 4];
  const red = suit === '♥' || suit === '♦';
  return { rank: displayRank, suit, red, val };
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────

const STRATEGIES = {
  random: { label: 'Random', color: '#DC4A4A', desc: 'Coin flip every hand' },
  basic: { label: 'Basic Strategy', color: '#4A7CDC', desc: 'Fixed play chart, flat bet' },
  optimal: { label: 'Optimal EV', color: '#a78bfa', desc: 'Recursive EV play, flat bet' },
  hilo: { label: 'Hi-Lo Counter', color: '#3BAF6F', desc: 'Dynamic strategy + bet ramp' },
};

export default function BlackjackSim() {
  const [strategy, setStrategy] = useState('basic');
  const [gameState, setGameState] = useState(null);
  const [histories, setHistories] = useState({ random: [1000], basic: [1000], optimal: [1000], hilo: [1000] });
  const [wagered, setWagered] = useState({ random: [0], basic: [0], optimal: [0], hilo: [0] });
  const [handCounts, setHandCounts] = useState({ random: 0, basic: 0, optimal: 0, hilo: 0 });
  const [chartMode, setChartMode] = useState('bankroll'); // 'bankroll' | 'edge'
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showResult, setShowResult] = useState(null);
  const [trialHands, setTrialHands] = useState(0);
  const [runLog, setRunLog] = useState([]); // [{strategy, hands, net}]
  const runRef = useRef(false);
  const stateRef = useRef(null);
  const optTableRef = useRef({ fresh: null, hot: null, cold: null });
  const suitCounter = useRef(0);

  // Initialize
  useEffect(() => {
    const deck = buildDeck(6);
    const st = { deck, rc: 0, L: 0, M: 0, H: 0, bankroll: 1000, nd: 6 };
    stateRef.current = st;
    setGameState({
      playerHand: [], dealerHand: [], dealerHidden: true,
      rc: 0, tc: 0, cardsLeft: deck.length, bet: 1,
      bankroll: 1000, phase: 'idle',
      playerDisplay: [], dealerDisplay: [],
    });
    // Build optimal tables: fresh (TC~0), hot (TC>=2), cold (TC<=-2)
    setTimeout(() => {
      optTableRef.current.fresh = buildOptimalTable(0, 0, 0, 6);
      // Hot shoe: simulate ~60 low cards dealt, ~40 high cards dealt (RC ~ +20)
      optTableRef.current.hot = buildOptimalTable(60, 20, 40, 6);
      // Cold shoe: simulate ~40 low cards dealt, ~60 high cards dealt (RC ~ -20)
      optTableRef.current.cold = buildOptimalTable(40, 20, 60, 6);
    }, 100);
  }, []);

  const assignSuit = useCallback(() => {
    return suitCounter.current++;
  }, []);

  const countCard = useCallback((card, st) => {
    st.rc += hiLoTag(card);
    const c = hiLoCat(card);
    if (c === 'L') st.L++;
    else if (c === 'M') st.M++;
    else st.H++;
  }, []);

  const playOneHand = useCallback((strat) => {
    const st = stateRef.current;
    if (!st) return null;

    const cutoff = Math.floor(st.nd * 52 * 0.25);
    if (st.deck.length < cutoff) {
      st.deck = buildDeck(st.nd);
      st.rc = 0; st.L = 0; st.M = 0; st.H = 0;
    }

    const ph = [st.deck.pop(), st.deck.pop()];
    const dh = [st.deck.pop(), st.deck.pop()];
    const phDisplay = ph.map(v => cardToDisplay(v, assignSuit()));
    const dhDisplay = dh.map(v => cardToDisplay(v, assignSuit()));

    // Count visible cards (player hand + dealer upcard)
    for (const c of [...ph, dh[0]]) countCard(c, st);

    const tc = trueCount(st.rc, st.deck.length);
    const bet = strat === 'hilo' ? hiLoBet(tc) : 1;

    const pbj = handValue(ph) === 21;
    const dbj = handValue(dh) === 21;

    if (pbj || dbj) {
      countCard(dh[1], st);
      const pt = handValue(ph), dt = handValue(dh);
      let payout;
      if (pt > 21) payout = -1;
      else if (pbj && dt !== 21) payout = 1.5;
      else if (dt > 21) payout = 1;
      else if (pt > dt) payout = 1;
      else if (pt < dt) payout = -1;
      else payout = 0;
      st.bankroll += payout * bet;

      return {
        playerHand: ph, dealerHand: dh, dealerHidden: false,
        rc: st.rc, tc: trueCount(st.rc, st.deck.length),
        cardsLeft: st.deck.length, bet,
        bankroll: st.bankroll, phase: 'done',
        result: payout > 0 ? 'WIN' : payout < 0 ? 'LOSE' : 'PUSH',
        payout: payout * bet,
        playerDisplay: phDisplay, dealerDisplay: dhDisplay,
        actions: pbj ? ['BLACKJACK!'] : ['Dealer BJ'],
      };
    }

    // Count dealer hole card
    countCard(dh[1], st);

    // Helper: pick the right optimal table based on current TC
    function getOptimalAction(ptotal, soft, dealerUp) {
      const key = `${ptotal},${soft},${dealerUp}`;
      const tables = optTableRef.current;
      const currentTc = trueCount(st.rc, st.deck.length);
      let table;
      if (currentTc >= 2 && tables.hot) table = tables.hot;
      else if (currentTc <= -2 && tables.cold) table = tables.cold;
      else table = tables.fresh;
      if (table) return table[key] || 'hit';
      return basicStrategy(ptotal, dealerUp, soft);
    }

    // Player decisions
    const actions = [];
    let currentPh = [...ph];
    let currentPhDisplay = [...phDisplay];
    while (true) {
      const pt = handValue(currentPh);
      if (pt >= 21) break;
      let action;
      if (strat === 'random') {
        action = Math.random() < 0.5 ? 'hit' : 'stand';
      } else if (strat === 'basic') {
        action = basicStrategy(pt, dh[0], isSoft(currentPh));
      } else if (strat === 'optimal') {
        // Optimal EV with fresh table (no counting), flat bet
        const key = `${pt},${isSoft(currentPh)},${dh[0]}`;
        const table = optTableRef.current.fresh;
        action = table ? (table[key] || 'hit') : basicStrategy(pt, dh[0], isSoft(currentPh));
      } else {
        // Hi-Lo: use TC-dependent optimal table
        action = getOptimalAction(pt, isSoft(currentPh), dh[0]);
      }
      actions.push(action.toUpperCase());
      if (action === 'stand') break;
      const card = st.deck.pop();
      countCard(card, st);
      currentPh.push(card);
      currentPhDisplay.push(cardToDisplay(card, assignSuit()));
    }

    // Dealer play
    let currentDh = [...dh];
    let currentDhDisplay = [...dhDisplay];
    const pt = handValue(currentPh);
    if (pt <= 21) {
      while (handValue(currentDh) < 17) {
        const card = st.deck.pop();
        countCard(card, st);
        currentDh.push(card);
        currentDhDisplay.push(cardToDisplay(card, assignSuit()));
      }
    }

    const dt = handValue(currentDh);
    let payout;
    if (pt > 21) payout = -1;
    else if (dt > 21) payout = 1;
    else if (pt > dt) payout = 1;
    else if (pt < dt) payout = -1;
    else payout = 0;
    st.bankroll += payout * bet;

    return {
      playerHand: currentPh, dealerHand: currentDh, dealerHidden: false,
      rc: st.rc, tc: trueCount(st.rc, st.deck.length),
      cardsLeft: st.deck.length, bet,
      bankroll: st.bankroll, phase: 'done',
      result: payout > 0 ? 'WIN' : payout < 0 ? 'LOSE' : 'PUSH',
      payout: payout * bet,
      playerDisplay: currentPhDisplay, dealerDisplay: currentDhDisplay,
      actions,
    };
  }, [assignSuit, countCard]);

  const runSimulation = useCallback(async () => {
    runRef.current = true;
    setRunning(true);
    const batchSize = speed >= 50 ? 500 : speed >= 10 ? 200 : 1;
    const delay = speed >= 50 ? 30 : speed >= 10 ? 50 : Math.max(800 - speed * 150, 50);
    const maxPoints = 1000;

    while (runRef.current) {
      let lastResult = null;
      const batchBankrolls = [];
      const batchWagers = [];
      let batchHands = 0;
      
      for (let i = 0; i < batchSize; i++) {
        lastResult = playOneHand(strategy);
        if (!lastResult) { runRef.current = false; break; }
        batchHands++;
        batchBankrolls.push(lastResult.bankroll);
        batchWagers.push(lastResult.bet);
      }
      
      if (batchHands > 0) {
        const totalBet = batchWagers.reduce((a, b) => a + b, 0);
        
        // Sample only a few points from the batch for the chart
        const sampleRate = Math.max(1, Math.floor(batchBankrolls.length / 5));
        const sampledBankrolls = [];
        for (let j = 0; j < batchBankrolls.length; j += sampleRate) sampledBankrolls.push(batchBankrolls[j]);
        const finalBankroll = batchBankrolls[batchBankrolls.length - 1];
        if (sampledBankrolls[sampledBankrolls.length - 1] !== finalBankroll) sampledBankrolls.push(finalBankroll);
        
        setTrialHands(prev => prev + batchHands);
        setHandCounts(prev => ({ ...prev, [strategy]: prev[strategy] + batchHands }));
        
        setHistories(prev => {
          const arr = prev[strategy];
          const full = arr.concat(sampledBankrolls);
          if (full.length > maxPoints) {
            const step = Math.ceil(full.length / maxPoints);
            const newArr = [];
            for (let j = 0; j < full.length; j += step) newArr.push(full[j]);
            if (newArr[newArr.length - 1] !== full[full.length - 1]) newArr.push(full[full.length - 1]);
            return { ...prev, [strategy]: newArr };
          }
          return { ...prev, [strategy]: full };
        });
        
        setWagered(prev => {
          const arr = prev[strategy];
          const lastW = arr[arr.length - 1] || 0;
          const newVal = lastW + totalBet;
          const newArr = [...arr, newVal];
          if (newArr.length > maxPoints) {
            const step = Math.ceil(newArr.length / maxPoints);
            const trimmed = [];
            for (let j = 0; j < newArr.length; j += step) trimmed.push(newArr[j]);
            if (trimmed[trimmed.length - 1] !== newArr[newArr.length - 1]) trimmed.push(newArr[newArr.length - 1]);
            return { ...prev, [strategy]: trimmed };
          }
          return { ...prev, [strategy]: newArr };
        });
        
        if (lastResult) {
          setGameState(lastResult);
          setShowResult(lastResult.result);
        }
      }
      
      await new Promise(r => setTimeout(r, delay));
    }
    setRunning(false);
  }, [strategy, speed, playOneHand]);

  const stopSimulation = useCallback(() => {
    runRef.current = false;
    setTrialHands(prev => {
      if (prev > 0) {
        const net = (stateRef.current?.bankroll || 1000) - 1000;
        setRunLog(log => [...log, {
          strategy: STRATEGIES[strategy].label,
          color: STRATEGIES[strategy].color,
          hands: prev,
          net: net,
        }]);
      }
      return prev;
    });
  }, [strategy]);

  const resetAll = useCallback(() => {
    runRef.current = false;
    const deck = buildDeck(6);
    const st = { deck, rc: 0, L: 0, M: 0, H: 0, bankroll: 1000, nd: 6 };
    stateRef.current = st;
    setGameState({
      playerHand: [], dealerHand: [], dealerHidden: true,
      rc: 0, tc: 0, cardsLeft: deck.length, bet: 1,
      bankroll: 1000, phase: 'idle',
      playerDisplay: [], dealerDisplay: [],
    });
    setHistories({ random: [1000], basic: [1000], optimal: [1000], hilo: [1000] });
    setWagered({ random: [0], basic: [0], optimal: [0], hilo: [0] });
    setHandCounts({ random: 0, basic: 0, optimal: 0, hilo: 0 });
    setTrialHands(0);
    setRunLog([]);
    setShowResult(null);
    setRunning(false);
  }, []);

  const stepOne = useCallback(() => {
    const result = playOneHand(strategy);
    if (!result) return;
    setTrialHands(prev => prev + 1);
    setHandCounts(prev => ({ ...prev, [strategy]: prev[strategy] + 1 }));
    setHistories(prev => ({
      ...prev,
      [strategy]: [...prev[strategy], result.bankroll]
    }));
    setWagered(prev => {
      const prevTotal = prev[strategy][prev[strategy].length - 1] || 0;
      return { ...prev, [strategy]: [...prev[strategy], prevTotal + result.bet] };
    });
    setGameState(result);
    setShowResult(result.result);
  }, [strategy, playOneHand]);

  if (!gameState) return null;

  const gs = gameState;
  const shoePercent = gs.cardsLeft / 312 * 100;
  const lowRemain = Math.max(120 - (stateRef.current?.L || 0), 0);
  const midRemain = Math.max(72 - (stateRef.current?.M || 0), 0);
  const highRemain = Math.max(120 - (stateRef.current?.H || 0), 0);
  const totalRemain = lowRemain + midRemain + highRemain;

  return (
    <div style={{
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
      background: '#0a0f0a',
      color: '#e8e4d9',
      minHeight: '100vh',
      padding: '16px',
    }}>
      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <h1 style={{
          fontSize: '18px', fontWeight: 700, letterSpacing: '4px',
          color: '#c4a44e', margin: 0, textTransform: 'uppercase',
        }}>The House Always Loses?</h1>
        <div style={{ fontSize: '11px', color: '#7a756a', marginTop: '4px', letterSpacing: '2px' }}>
          BLACKJACK MARKOV CHAIN SIMULATOR · 6-DECK SHOE · S17
        </div>
      </div>

      {/* Strategy Selector */}
      <div style={{
        display: 'flex', gap: '8px', justifyContent: 'center',
        marginBottom: '16px', flexWrap: 'wrap',
      }}>
        {Object.entries(STRATEGIES).map(([key, { label, color, desc }]) => (
          <button key={key} onClick={() => {
            if (!running && key !== strategy) {
              setTrialHands(0);
              setStrategy(key);
              // Reset shoe and bankroll for the new strategy, but keep chart histories
              const deck = buildDeck(6);
              const st = { deck, rc: 0, L: 0, M: 0, H: 0, bankroll: 1000, nd: 6 };
              stateRef.current = st;
              setGameState({
                playerHand: [], dealerHand: [], dealerHidden: true,
                rc: 0, tc: 0, cardsLeft: deck.length, bet: 1,
                bankroll: 1000, phase: 'idle',
                playerDisplay: [], dealerDisplay: [],
              });
              setShowResult(null);
              // Reset this strategy's history to fresh start (keep others)
              setHistories(prev => ({ ...prev, [key]: [1000] }));
              setWagered(prev => ({ ...prev, [key]: [0] }));
              setHandCounts(prev => ({ ...prev, [key]: 0 }));
            }
          }}
            style={{
              background: strategy === key ? color + '22' : 'transparent',
              border: `1.5px solid ${strategy === key ? color : '#333'}`,
              borderRadius: '6px', padding: '8px 14px',
              color: strategy === key ? color : '#7a756a',
              cursor: running ? 'default' : 'pointer',
              fontSize: '11px', fontFamily: 'inherit',
              transition: 'all 0.2s',
            }}>
            <div style={{ fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: '9px', opacity: 0.7, marginTop: '2px' }}>{desc}</div>
          </button>
        ))}
      </div>

      {/* TABLE */}
      <div style={{
        background: 'radial-gradient(ellipse at 50% 30%, #1b6030 0%, #145224 40%, #0e3e1a 70%, #0a2e12 100%)',
        borderRadius: '20px',
        border: '8px solid #2c1a08',
        boxShadow: 'inset 0 0 60px rgba(0,0,0,0.4), 0 6px 24px rgba(0,0,0,0.7), 0 0 0 2px #4a3218 inset',
        padding: '28px 24px',
        marginBottom: '16px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Felt texture */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.06,
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='6' height='6' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='1' cy='1' r='0.5' fill='white'/%3E%3Ccircle cx='4' cy='4' r='0.3' fill='white'/%3E%3C/svg%3E")`,
          backgroundSize: '6px 6px', pointerEvents: 'none',
        }} />

        {/* Gold line border - casino style */}
        <div style={{
          position: 'absolute', inset: '12px',
          border: '1.5px solid rgba(200, 170, 80, 0.25)',
          borderRadius: '12px', pointerEvents: 'none',
        }} />

        {/* Duke D logos - embossed into felt, all 4 corners */}
        {[
          { pos: { right: '24px', bottom: '22px' }, rot: '' },
          { pos: { left: '24px', bottom: '22px' }, rot: '' },
          { pos: { right: '24px', top: '22px' }, rot: 'rotate(180deg)' },
          { pos: { left: '24px', top: '22px' }, rot: 'rotate(180deg)' },
        ].map((cfg, i) => (
          <svg key={i} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 147.15663 142.61723" style={{
            position: 'absolute', ...cfg.pos,
            width: '44px', height: 'auto',
            opacity: 0.07, pointerEvents: 'none',
            transform: cfg.rot,
          }}>
            <path fill="rgba(150,210,150,0.9)" d="m82.428 1.0965 19.722 32.553v75.279l-19.722 32.651h41.314c15.872-0.0368 28.732-12.768 28.732-29.434v-81.002c0-16.665-12.858-30.049-28.732-30.049h-41.314zm-87.848 0.0028 19.742 32.55v75.279l-19.742 32.632h83.503l-19.75-32.632v-75.279l19.75-32.55h-83.503z"/>
          </svg>
        ))}


        {/* Semicircle text arc - BLACKJACK PAYS 3 TO 2 */}
        <div style={{
          position: 'absolute', top: '18px', left: '50%', transform: 'translateX(-50%)',
          fontSize: '8px', letterSpacing: '4px', color: 'rgba(200, 170, 80, 0.2)',
          fontWeight: 600, textTransform: 'uppercase', pointerEvents: 'none',
        }}>
          BLACKJACK PAYS 3 TO 2
        </div>

        {/* Dealer card box - gold outline */}
        <div style={{ textAlign: 'center', marginBottom: '8px', marginTop: '12px' }}>
          <div style={{
            fontSize: '10px', color: 'rgba(200, 170, 80, 0.4)', letterSpacing: '3px', marginBottom: '8px',
            textTransform: 'uppercase', fontWeight: 500,
          }}>
            Dealer {gs.dealerHand.length > 0 && !gs.dealerHidden ?
              <span style={{ color: '#c8aa50' }}>· {handValue(gs.dealerHand)}</span> : ''}
          </div>
          <div style={{
            display: 'inline-flex', justifyContent: 'center', gap: '6px',
            minHeight: '84px', alignItems: 'center',
            padding: '8px 16px',
            border: '1px solid rgba(200, 170, 80, 0.15)',
            borderRadius: '6px',
            minWidth: '120px',
          }}>
            {gs.dealerDisplay?.length > 0 ? gs.dealerDisplay.map((card, i) => (
              <Card key={i} card={card} hidden={false} />
            )) : <EmptySlot />}
          </div>
        </div>

        {/* Result */}
        <div style={{ textAlign: 'center', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {showResult && (
            <div style={{
              fontSize: '15px', fontWeight: 700, letterSpacing: '4px',
              color: showResult === 'WIN' ? '#4ade80' : showResult === 'LOSE' ? '#f87171' : '#fbbf24',
              textShadow: `0 0 24px ${showResult === 'WIN' ? '#4ade8055' : showResult === 'LOSE' ? '#f8717155' : '#fbbf2455'}`,
            }}>
              {showResult} {gs.payout !== undefined && `(${gs.payout > 0 ? '+' : ''}${gs.payout})`}
            </div>
          )}
        </div>

        {/* Player area with card box and chips */}
        <div style={{ textAlign: 'center', marginTop: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: '20px' }}>
            {/* Chip stack */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '44px' }}>
              <ChipStack bet={gs.bet || 1} />
              <div style={{ fontSize: '9px', color: 'rgba(200, 170, 80, 0.5)', marginTop: '4px', letterSpacing: '1px' }}>
                {gs.bet || 1}u
              </div>
            </div>

            {/* Player cards in gold box */}
            <div style={{
              display: 'inline-flex', justifyContent: 'center', gap: '6px',
              minHeight: '84px', alignItems: 'center',
              padding: '8px 16px',
              border: '1px solid rgba(200, 170, 80, 0.15)',
              borderRadius: '6px',
              minWidth: '120px',
            }}>
              {gs.playerDisplay?.length > 0 ? gs.playerDisplay.map((card, i) => (
                <Card key={i} card={card} />
              )) : <EmptySlot />}
            </div>
          </div>

          <div style={{
            fontSize: '10px', color: 'rgba(200, 170, 80, 0.4)', letterSpacing: '3px', marginTop: '8px',
            textTransform: 'uppercase', fontWeight: 500,
          }}>
            Player {gs.playerHand.length > 0 ?
              <span style={{ color: '#c8aa50' }}>· {handValue(gs.playerHand)}{isSoft(gs.playerHand) ? ' soft' : ''}</span> : ''}
          </div>
          {gs.actions && (
            <div style={{ fontSize: '9px', color: 'rgba(200, 170, 80, 0.25)', marginTop: '4px', letterSpacing: '1px' }}>
              {gs.actions.join(' → ')}
            </div>
          )}
        </div>
      </div>

      {/* Dashboard Row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '8px', marginBottom: '16px',
      }}>
        <StatBox label="BANKROLL" value={`${gs.bankroll.toFixed(1)}`}
          color={gs.bankroll >= 1000 ? '#4ade80' : '#f87171'} />
        <StatBox label="HANDS (TRIAL)" value={trialHands} color="#c4a44e" />
        <StatBox label="SHOE" value={`${Math.round(shoePercent)}%`}
          sub={`${gs.cardsLeft} cards`} color="#6a9ada" />
        <StatBox label="TRUE COUNT" value={gs.tc?.toFixed(1) || '0.0'}
          color={gs.tc > 1 ? '#4ade80' : gs.tc < -1 ? '#f87171' : '#7a756a'} />
        <StatBox label="RC" value={gs.rc || 0} color="#a78bfa" />
        <StatBox label="BET SIZE" value={gs.bet || 1} color="#fbbf24" />
      </div>

      {/* Shoe Composition */}
      <div style={{
        background: '#111',
        borderRadius: '8px', padding: '10px 14px',
        marginBottom: '16px', border: '1px solid #222',
      }}>
        <div style={{ fontSize: '10px', color: '#7a756a', letterSpacing: '2px', marginBottom: '8px' }}>
          SHOE COMPOSITION
        </div>
        <div style={{ display: 'flex', height: '14px', borderRadius: '4px', overflow: 'hidden', gap: '1px' }}>
          {totalRemain > 0 && <>
            <div style={{
              width: `${lowRemain/totalRemain*100}%`, background: '#4a7cdc',
              transition: 'width 0.3s',
            }} />
            <div style={{
              width: `${midRemain/totalRemain*100}%`, background: '#7a756a',
              transition: 'width 0.3s',
            }} />
            <div style={{
              width: `${highRemain/totalRemain*100}%`, background: '#c4a44e',
              transition: 'width 0.3s',
            }} />
          </>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '9px' }}>
          <span style={{ color: '#4a7cdc' }}>Low (2-6): {lowRemain}</span>
          <span style={{ color: '#7a756a' }}>Mid (7-9): {midRemain}</span>
          <span style={{ color: '#c4a44e' }}>High (10,A): {highRemain}</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex', gap: '8px', justifyContent: 'center',
        marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center',
      }}>
        <button onClick={stepOne} disabled={running}
          style={btnStyle('#333', running)}>
          Deal 1
        </button>
        {!running ? (
          <button onClick={runSimulation} style={btnStyle('#1a5c2e', false)}>
            ▶ Run
          </button>
        ) : (
          <button onClick={stopSimulation} style={btnStyle('#7c2d2d', false)}>
            ■ Stop
          </button>
        )}
        <button onClick={resetAll} disabled={running}
          style={btnStyle('#333', running)}>
          Reset
        </button>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: '#111', borderRadius: '6px', padding: '6px 12px',
          border: '1px solid #222',
        }}>
          <span style={{ fontSize: '10px', color: '#7a756a' }}>SPEED</span>
          <input type="range" min="1" max="100" value={speed}
            onChange={e => setSpeed(parseInt(e.target.value))}
            style={{ width: '80px', accentColor: '#c4a44e' }} />
          <span style={{ fontSize: '10px', color: '#c4a44e', minWidth: '24px' }}>
            {speed >= 50 ? '50x' : speed >= 10 ? '10x' : '1x'}
          </span>
        </div>
      </div>

      {/* Bankroll Chart */}
      <div style={{
        background: '#111', borderRadius: '8px',
        padding: '14px', border: '1px solid #222',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div style={{ fontSize: '10px', color: '#7a756a', letterSpacing: '2px' }}>
            {chartMode === 'bankroll' ? 'BANKROLL OVER TIME' : 'RETURN PER UNIT WAGERED (%)'}
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button onClick={() => setChartMode('bankroll')}
              style={{
                background: chartMode === 'bankroll' ? '#2a2a2a' : 'transparent',
                border: `1px solid ${chartMode === 'bankroll' ? '#555' : '#333'}`,
                borderRadius: '4px', padding: '3px 10px',
                color: chartMode === 'bankroll' ? '#e8e4d9' : '#555',
                cursor: 'pointer', fontSize: '9px', fontFamily: 'inherit',
                letterSpacing: '1px',
              }}>RAW</button>
            <button onClick={() => setChartMode('edge')}
              style={{
                background: chartMode === 'edge' ? '#2a2a2a' : 'transparent',
                border: `1px solid ${chartMode === 'edge' ? '#555' : '#333'}`,
                borderRadius: '4px', padding: '3px 10px',
                color: chartMode === 'edge' ? '#e8e4d9' : '#555',
                cursor: 'pointer', fontSize: '9px', fontFamily: 'inherit',
                letterSpacing: '1px',
              }}>PER UNIT</button>
          </div>
        </div>
        <BankrollChart histories={histories} wagered={wagered} handCounts={handCounts} strategies={STRATEGIES} mode={chartMode} />
        {/* Chart Legend */}
        <div style={{
          display: 'flex', gap: '16px', justifyContent: 'center',
          marginTop: '8px', flexWrap: 'wrap',
        }}>
          {Object.entries(STRATEGIES).map(([key, { label, color }]) => {
            const hasData = histories[key].length > 1;
            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                opacity: hasData ? 1 : 0.3,
              }}>
                <div style={{
                  width: '16px', height: '3px', borderRadius: '2px',
                  background: color,
                }} />
                <span style={{ fontSize: '10px', color: '#7a756a' }}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Run Log */}
      {runLog.length > 0 && (
        <div style={{
          background: '#111', borderRadius: '8px', padding: '10px 14px',
          marginTop: '8px', border: '1px solid #222',
        }}>
          <div style={{ fontSize: '10px', color: '#7a756a', letterSpacing: '2px', marginBottom: '8px' }}>
            RUN LOG
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {runLog.map((run, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: '11px', padding: '4px 8px', borderRadius: '4px',
                background: '#1a1a1a',
              }}>
                <span style={{ color: run.color, fontWeight: 600 }}>{run.strategy}</span>
                <span style={{ color: '#7a756a' }}>{run.hands.toLocaleString()} hands</span>
                <span style={{ color: run.net >= 0 ? '#4ade80' : '#f87171', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {run.net >= 0 ? '+' : ''}{run.net.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{
        textAlign: 'center', marginTop: '12px',
        fontSize: '9px', color: '#4a4a3a', letterSpacing: '1px',
      }}>
        MATH 242 · DISCRETE MATH & PROOFS · SPRING 2026
      </div>
    </div>
  );
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function Card({ card, hidden }) {
  if (hidden) {
    return (
      <div style={{
        width: '52px', height: '76px', borderRadius: '6px',
        background: 'repeating-linear-gradient(45deg, #1a2a8a, #1a2a8a 4px, #1e3090 4px, #1e3090 8px)',
        border: '2px solid #2a3a9a',
        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
      }} />
    );
  }
  return (
    <div style={{
      width: '52px', height: '76px', borderRadius: '6px',
      background: '#f5f0e8',
      border: '1px solid #ccc',
      display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', padding: '4px 6px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      color: card.red ? '#b91c1c' : '#1a1a1a',
      fontSize: '14px', fontWeight: 700,
      fontFamily: "'Georgia', serif",
      position: 'relative',
    }}>
      <div style={{ fontSize: '13px', lineHeight: 1 }}>{card.rank}</div>
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        fontSize: '22px', opacity: 0.3,
      }}>{card.suit}</div>
      <div style={{ fontSize: '10px', alignSelf: 'flex-end', lineHeight: 1 }}>{card.suit}</div>
    </div>
  );
}

function ChipStack({ bet }) {
  const chipColors = ['#c83232', '#2a8c3a', '#2a5aaa', '#c8aa50', '#1a1a1a'];
  const count = Math.min(Math.max(bet, 1), 12);
  const chips = [];
  for (let i = 0; i < count; i++) {
    chips.push(chipColors[i % chipColors.length]);
  }
  const size = 32;
  return (
    <div style={{ position: 'relative', width: `${size}px`, height: `${size + chips.length * 3}px` }}>
      {chips.map((color, i) => (
        <div key={i} style={{
          position: 'absolute',
          bottom: i * 3,
          left: 0,
          width: `${size}px`, height: `${size}px`,
          borderRadius: '50%',
          background: `radial-gradient(circle at 40% 38%, ${color}ee 0%, ${color} 50%, ${color}99 100%)`,
          border: `2px solid rgba(255,255,255,0.15)`,
          boxShadow: `inset 0 -2px 4px rgba(0,0,0,0.4), ${i === chips.length - 1 ? '0 2px 6px rgba(0,0,0,0.5)' : 'none'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {/* Dashed ring on each chip */}
          <div style={{
            width: `${size - 10}px`, height: `${size - 10}px`,
            borderRadius: '50%',
            border: `1.5px dashed rgba(255,255,255,${i === chips.length - 1 ? 0.35 : 0.15})`,
          }} />
        </div>
      ))}
    </div>
  );
}

function EmptySlot() {
  return (
    <div style={{
      width: '52px', height: '76px', borderRadius: '6px',
      border: '1.5px dashed #2a5a2a',
      opacity: 0.4,
    }} />
  );
}

function StatBox({ label, value, sub, color }) {
  return (
    <div style={{
      background: '#111', borderRadius: '8px', padding: '10px 12px',
      border: '1px solid #222', textAlign: 'center',
    }}>
      <div style={{ fontSize: '9px', color: '#7a756a', letterSpacing: '1.5px', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: '18px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '9px', color: '#555', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

function BankrollChart({ histories, wagered, handCounts, strategies, mode }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth * 2;
    const H = canvas.height = 320 * 2;
    canvas.style.height = '320px';
    ctx.clearRect(0, 0, W, H);

    // Build plot data per strategy based on mode
    const plotData = {};
    for (const key of Object.keys(strategies)) {
      const hist = histories[key];
      const wag = wagered[key];
      if (mode === 'bankroll') {
        plotData[key] = hist;
      } else {
        // Return per unit wagered: (bankroll - 1000) / totalWagered * 100
        const data = hist.map((b, i) => {
          const w = wag[i] || 0;
          if (w < 20) return null; // skip early noise (< 20 units wagered)
          return ((b - 1000) / w) * 100;
        });
        plotData[key] = data;
      }
    }

    // Find global bounds — for edge mode, only use non-null values
    let allVals = [];
    for (const key of Object.keys(strategies)) {
      const d = plotData[key];
      if (mode === 'edge') {
        // Use only the back half of data for bounds (where it's converged)
        const stable = d.filter(v => v !== null);
        const backHalf = stable.slice(Math.floor(stable.length * 0.3));
        allVals.push(...(backHalf.length > 0 ? backHalf : stable));
      } else {
        allVals.push(...d);
      }
    }
    if (allVals.length < 2) return;

    let minV = Math.min(...allVals);
    let maxV = Math.max(...allVals);

    if (mode === 'edge') {
      // Tight window around converged data with small padding
      const pad_y = Math.max((maxV - minV) * 0.3, 0.5);
      minV = minV - pad_y;
      maxV = maxV + pad_y;
    } else {
      minV -= 10;
      maxV += 10;
    }

    const range = maxV - minV || 1;
    // Use actual hand counts for x-axis, not array lengths
    const maxHands = Math.max(1, ...Object.keys(strategies).map(k => handCounts[k] || 0));

    const pad = { t: 20, b: 30, l: 70, r: 30 };
    const cW = W - pad.l - pad.r;
    const cH = H - pad.t - pad.b;

    // Grid
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    const ySteps = 5;
    ctx.font = `${18}px JetBrains Mono, monospace`;
    ctx.fillStyle = '#555';
    ctx.textAlign = 'right';
    for (let i = 0; i <= ySteps; i++) {
      const y = pad.t + (cH / ySteps) * i;
      const val = maxV - (range / ySteps) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(W - pad.r, y);
      ctx.stroke();
      if (mode === 'edge') {
        ctx.fillText(val.toFixed(1) + '%', pad.l - 8, y + 5);
      } else {
        ctx.fillText(Math.round(val).toString(), pad.l - 8, y + 5);
      }
    }

    // Zero / starting line
    const zeroVal = mode === 'bankroll' ? 1000 : 0;
    const zeroY = pad.t + cH * (1 - (zeroVal - minV) / range);
    ctx.strokeStyle = '#444';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, zeroY);
    ctx.lineTo(W - pad.r, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Plot each strategy
    for (const [key, { color }] of Object.entries(strategies)) {
      const data = plotData[key];
      const totalHands = handCounts[key] || 0;
      if (data.length < 2 || totalHands === 0) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();

      // Each data point i maps to hand number: i * (totalHands / (data.length - 1))
      const step = Math.max(1, Math.floor(data.length / (cW / 2)));
      let started = false;
      for (let i = 0; i < data.length; i += step) {
        if (data[i] === null) continue;
        const val = Math.max(minV, Math.min(maxV, data[i]));
        const handNum = i * (totalHands / Math.max(data.length - 1, 1));
        const x = pad.l + (handNum / maxHands) * cW;
        const y = pad.t + cH * (1 - (val - minV) / range);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // End label
      let labelI = data.length - 1;
      while (labelI >= 0 && data[labelI] === null) labelI--;
      if (labelI >= 0 && data.length > 1) {
        const labelHandNum = labelI * (totalHands / Math.max(data.length - 1, 1));
        const labelX = pad.l + (labelHandNum / maxHands) * cW;
        const labelVal = Math.max(minV, Math.min(maxV, data[labelI]));
        const labelY = pad.t + cH * (1 - (labelVal - minV) / range);
        ctx.fillStyle = color;
        ctx.font = `bold ${18}px JetBrains Mono, monospace`;
        ctx.textAlign = 'left';
        if (mode === 'edge') {
          ctx.fillText((data[labelI] >= 0 ? '+' : '') + data[labelI].toFixed(1) + '%', labelX + 6, labelY + 5);
        } else {
          ctx.fillText(Math.round(data[labelI]).toString(), labelX + 6, labelY + 5);
        }
      }
    }

    // X axis label
    ctx.fillStyle = '#555';
    ctx.font = `${16}px JetBrains Mono, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('Hands played', W / 2, H - 4);
  }, [histories, wagered, handCounts, strategies, mode]);

  return <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }} />;
}

function btnStyle(bg, disabled) {
  return {
    background: bg,
    border: '1px solid #444',
    borderRadius: '6px',
    padding: '8px 18px',
    color: disabled ? '#555' : '#e8e4d9',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: '11px',
    fontFamily: 'inherit',
    fontWeight: 600,
    letterSpacing: '1px',
    opacity: disabled ? 0.5 : 1,
  };
}
