import { useState, useEffect, useMemo } from 'react';
import {
  Sun,
  Moon,
  Globe,
  Coins,
  Trophy,
  Award,
  X,
  Plus,
  TrendingUp,
  Flame,
  Check
} from 'lucide-react';
import { Fighter, WeightClass } from './types';
import { LANG, P4P_LIST, WEIGHT_CLASSES, PHOTOS } from './data';

// Custom declaration for Pi Network SDK global
declare global {
  interface Window {
    Pi?: {
      init: (args: { version: string; sandbox: boolean }) => void;
      authenticate: (
        scopes: string[],
        onIncompletePaymentFound: (payment: any) => void
      ) => Promise<{ accessToken: string; user: { username: string } }>;
      createPayment: (paymentData: any, callbacks: any) => void;
    };
  }
}

// Destination organizer wallet address
const WALLET_ADDRESS = 'GCXCW4REFA6PMYKOOI5N7F53P4HJR2SETBIOVTVH3ZAFFG35G47OMTWG';
const API_BASE = 'https://fa3c9610-5060-4f7b-9fc8-a149996ba327-00-1rsocrq601kmg.sisko.replit.dev/api';

// Generate initials fallback for avatar backgrounds
function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}

// Generate an attractive gradients based on a string seed
function getStringGradient(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffff;
  }
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue}, 60%, 25%) 0%, hsl(${(hue + 45) % 360}, 65%, 40%) 100%)`;
}

// Helper to get P4P score key by matching fighter name
function getP4PKey(name: string): string {
  const pIdx = P4P_LIST.findIndex((f) => f.name.toLowerCase() === name.toLowerCase());
  if (pIdx !== -1) {
    return `p4p_${pIdx}`;
  }
  return `p4p_notlist_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
}

export default function App() {
  // UI states
  const [lang, setLang] = useState<string>(() => {
    return localStorage.getItem('p4p_lang') || 'en';
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('p4p_theme') as 'dark' | 'light') || 'dark';
  });
  const [activeTab, setActiveTab] = useState<string>('p4p');
  
  // Game scores states
  const [scores, setScores] = useState<Record<string, number>>({});
  const [piCollected, setPiCollected] = useState<number>(0);
  const [totalVotes, setTotalVotes] = useState<number>(0);
  
  // Voting status and modal states
  const [pendingVote, setPendingVote] = useState<{
    scoreKey: string;
    name: string;
    flag: string;
    division: string;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  
  // Toast notifications states
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' }[]>([]);

  // Pi Network configuration status
  const [piStatus, setPiStatus] = useState<'initializing' | 'ready' | 'offline'>('initializing');

  // Trigger custom notification
  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now().toString() + Math.random().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Setup initial scoreboard locally and try to load global Replit values
  useEffect(() => {
    // 1. Generate starting points locally so the UI feels alive
    const initialScores: Record<string, number> = {};
    
    // Assign starting votes to Top-15
    P4P_LIST.forEach((_, idx) => {
      initialScores[`p4p_${idx}`] = 2000 - idx * 100;
    });

    // Assign starting values to Weight Classes
    WEIGHT_CLASSES.forEach((wc) => {
      const champKey = getP4PKey(wc.champ.name);
      if (initialScores[champKey] === undefined) {
        initialScores[champKey] = 1200;
      }
      wc.fighters.forEach((f, idx) => {
        const key = getP4PKey(f.name);
        if (initialScores[key] === undefined) {
          initialScores[key] = (15 - idx) * 100 + 100;
        }
      });
    });

    // Check if user has values stored from prior visits
    const localS = localStorage.getItem('p4p_scores_v2');
    let loadedScores = { ...initialScores };
    if (localS) {
      try {
        const parsed = JSON.parse(localS);
        const normalizedParsed: Record<string, number> = {};
        Object.keys(parsed).forEach((key) => {
          normalizedParsed[key] = Math.round((Number(parsed[key]) || 0) / 100) * 100;
        });
        loadedScores = { ...loadedScores, ...normalizedParsed };
      } catch (e) {
        console.error('Failed parsing localStorage scores', e);
      }
    }

    setScores(loadedScores);

    // Calculate sum of votes from values
    let sumVal = 0;
    Object.keys(loadedScores).forEach((k) => {
      sumVal += loadedScores[k];
    });
    setTotalVotes(Math.floor(sumVal / 100));
    setPiCollected(sumVal / 100);

    // Save as local base
    localStorage.setItem('p4p_scores_v2', JSON.stringify(loadedScores));

    // 2. Fetch live data from remote server if possible
    fetch(`${API_BASE}/votes`)
      .then((res) => {
        if (!res.ok) throw new Error('Query error');
        return res.json();
      })
      .then((data) => {
        if (data && Array.isArray(data.votes)) {
          const remoteScores: Record<string, number> = {};
          let remotePiTotal = 0;
          let remoteVotesTotal = 0;
          
          data.votes.forEach((v: any) => {
            if (v.fighter_key) {
              remoteScores[v.fighter_key] = Math.round((Number(v.points) || 0) / 100) * 100;
              remoteVotesTotal += Number(v.vote_count) || 0;
              remotePiTotal += Number(v.pi_amount) || 0;
            }
          });

          setScores((prev) => {
            const merged = { ...prev, ...remoteScores };
            localStorage.setItem('p4p_scores_v2', JSON.stringify(merged));
            return merged;
          });
          
          if (remoteVotesTotal > 0) {
            setTotalVotes(remoteVotesTotal);
            setPiCollected(remotePiTotal);
          }
          console.log('[API] Synced votes successfully from remote.');
        }
      })
      .catch((err) => {
        console.warn('[API] Unreachable, relying on offline local simulation:', err.message);
      });
  }, []);

  // Initialize Pi Network SDK
  useEffect(() => {
    if (typeof window.Pi !== 'undefined') {
      try {
        window.Pi.init({ version: '2.0', sandbox: true });
        window.Pi.authenticate(['username', 'payments'], (incompletePayment) => {
          console.log('[Pi SDK] Unfinished payment caught:', incompletePayment?.identifier);
        })
          .then((auth) => {
            setPiStatus('ready');
            console.log('[Pi SDK] Connected. Active username:', auth.user.username);
          })
          .catch((err) => {
            setPiStatus('offline');
            console.warn('[Pi SDK] Authentication blocked:', err);
          });
      } catch (e) {
        setPiStatus('offline');
        console.error('[Pi SDK] Failed init:', e);
      }
    } else {
      setPiStatus('offline');
      console.warn('[Pi SDK] Not detected (running outside Pi browser). Demo simulated.');
    }
  }, []);

  // Track state changes to HTML attributes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('p4p_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('p4p_lang', lang);
    const bodyDir = ['ar'].includes(lang) ? 'rtl' : 'ltr';
    document.documentElement.dir = bodyDir;
  }, [lang]);

  // Translate label key with current language selection
  const translate = (key: string): string => {
    return (LANG[lang] || LANG.en)[key] || key;
  };

  // Translate nested/slashed division strings
  const translateDivision = (divStr: string): string => {
    if (!divStr) return '';
    return divStr
      .split('/')
      .map((part) => {
        const trimmed = part.trim().toLowerCase().replace(/\s+/g, '');
        return translate(trimmed);
      })
      .join(' / ');
  };

  // Convert tab options to array
  const currentTabName = useMemo(() => {
    if (activeTab === 'p4p') return translate('tabP4P');
    const matched = WEIGHT_CLASSES.find((w) => w.id === activeTab);
    return matched ? `${matched.icon} ${translate(matched.id).toUpperCase()}` : '';
  }, [activeTab, lang]);

  // Max score for bar chart relative distribution percentage inside P4P
  const maxP4PScore = useMemo(() => {
    let max = 1;
    P4P_LIST.forEach((_, i) => {
      const v = scores[`p4p_${i}`] || 0;
      if (v > max) max = v;
    });
    return max;
  }, [scores]);

  // Handle triggering vote modal
  const handleOpenVote = (name: string, flag: string, division: string, keyId: string) => {
    setPendingVote({
      scoreKey: keyId,
      name,
      flag,
      division
    });
  };

  const handleCloseVote = () => {
    if (isProcessing) return;
    setPendingVote(null);
  };

  // Confirm and Execute Pi Network SDK payment or fallback Sandbox Simulator
  const handleConfirmVote = async () => {
    if (!pendingVote) return;
    setIsProcessing(true);

    const { scoreKey, name, division } = pendingVote;

    if (typeof window.Pi !== 'undefined' && piStatus === 'ready') {
      // Execute official Sandbox Pi Payment integration flow
      window.Pi.createPayment({
        amount: 1,
        memo: `P4P Fan Vote: ${name}`.substring(0, 60),
        metadata: { fighter: name, scope: division }
      }, {
        onReadyForServerApproval: (paymentId: string) => {
          console.log('[Pi SDK] Payment approval request received:', paymentId);
          fetch(`${API_BASE}/votes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fighter_key: scoreKey,
              fighter_name: name,
              division: division,
              points: 0, // setup placeholder on approval
              pi_amount: 0
            })
          }).catch(err => console.error('Approval sync log error', err));
        },
        onReadyForServerCompletion: (paymentId: string, txid: string) => {
          console.log('[Pi SDK] Payment success. ID:', paymentId, 'Tx:', txid);
          // Commit finalized score
          processSuccessVote(scoreKey, name, division);
        },
        onCancel: (paymentId: string) => {
          console.warn('[Pi SDK] Transaction voided by user:', paymentId);
          addToast(translate('toastError'), 'error');
          setIsProcessing(false);
          setPendingVote(null);
        },
        onError: (err: any) => {
          console.error('[Pi SDK] Payment execution fault:', err);
          addToast(translate('toastError'), 'error');
          setIsProcessing(false);
          setPendingVote(null);
        }
      });
    } else {
      // Demo fallback simulation for non-Pi browsers
      await new Promise((resolve) => setTimeout(resolve, 1500));
      processSuccessVote(scoreKey, name, division);
    }
  };

  // Process local and remote score commit on success
  const processSuccessVote = (scoreKey: string, name: string, division: string) => {
    // 1. Update local client state immediately
    const pointsAwarded = 100;
    const nextScores = { ...scores };
    nextScores[scoreKey] = (nextScores[scoreKey] || 0) + pointsAwarded;
    
    setScores(nextScores);
    localStorage.setItem('p4p_scores_v2', JSON.stringify(nextScores));
    
    // Increment telemetry counters
    setTotalVotes((prev) => prev + 1);
    setPiCollected((prev) => prev + 1.0);

    // 2. Transmit persistence data payload asynchronously to remote Replit server
    fetch(`${API_BASE}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fighter_key: scoreKey,
        fighter_name: name,
        division: division,
        points: pointsAwarded,
        pi_amount: 1
      })
    })
      .then((res) => {
        if (!res.ok) console.warn('Persistence report returned code:', res.status);
      })
      .catch((e) => {
        console.warn('Network timeout during remote state record.', e);
      });

    // Provide premium responsive UI feedback
    addToast(`${translate('toastSuccess')} ${name} (${translate('toastPts')})`, 'success');
    setIsProcessing(false);
    setPendingVote(null);
  };

  // Sort P4P dynamically based on interactive votes state
  const sortedP4P = useMemo(() => {
    return P4P_LIST.map((f, i) => ({
      ...f,
      originalIndex: i,
      fansPoints: scores[`p4p_${i}`] || 0
    })).sort((a, b) => b.fansPoints - a.fansPoints || a.originalIndex - b.originalIndex);
  }, [scores]);

  return (
    <div className={`transition-colors duration-200 min-h-screen relative flex flex-col font-sans select-none ${
      theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'
    }`} dir={['ar'].includes(lang) ? 'rtl' : 'ltr'}>
      
      {/* Background ambient lighting effects */}
      <div className="absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-indigo-500/10 via-transparent to-transparent pointer-events-none z-0" />
      <div className="absolute inset-x-0 top-1/4 h-96 bg-gradient-to-r from-yellow-500/5 via-violet-500/5 to-transparent pointer-events-none z-0" />

      {/* Header section with live stats and options */}
      <header className={`relative z-10 border-b transition-colors ${
        theme === 'dark' ? 'bg-slate-900/60 border-slate-800/80' : 'bg-white/80 border-slate-200'
      } backdrop-blur-md`}>
        <div className="max-w-4xl mx-auto px-4 py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          
          <div>
            <div className="flex items-center gap-2 mb-1">
              {piStatus === 'ready' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase tracking-wider bg-violet-500/10 text-violet-400 border border-violet-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                  {translate('piBrowser')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold uppercase tracking-wider bg-slate-500/15 text-slate-400 border border-slate-500/10">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  {translate('sandboxDemo')}
                </span>
              )}
            </div>
            <h1 className="text-4xl md:text-5xl font-black font-condensed uppercase tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-yellow-200 to-yellow-600">
              {translate('title').toUpperCase()}
            </h1>
            <p className={`text-xs md:text-sm font-medium tracking-wide ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
              Pound for Pound · Fan Rankings
            </p>
          </div>

          {/* Quick interactive user toggle buttons */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className={`appearance-none bg-transparent hover:bg-slate-500/10 border font-semibold text-xs rounded-lg pl-3 pr-8 py-1.5 cursor-pointer outline-none transition-all ${
                  theme === 'dark' ? 'text-slate-200 border-slate-700' : 'text-slate-700 border-slate-300'
                }`}
                aria-label="Language selection"
              >
                <option value="en">🇬🇧 EN</option>
                <option value="ru">🇷🇺 RU</option>
                <option value="ar">🇸🇦 AR</option>
                <option value="fr">🇫🇷 FR</option>
                <option value="de">🇩🇪 DE</option>
                <option value="it">🇮🇹 IT</option>
                <option value="fil">🇵🇭 FIL</option>
                <option value="id">🇮🇩 ID</option>
                <option value="zh">🇨🇳 ZH</option>
                <option value="ja">🇯🇵 JA</option>
                <option value="ko">🇰🇷 KO</option>
              </select>
              <span className={`pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                ▼
              </span>
            </div>

            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className={`p-2 rounded-lg border hover:bg-slate-500/10 transition-all ${
                theme === 'dark' ? 'border-slate-800 text-yellow-400' : 'border-slate-200 text-slate-700'
              }`}
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Global telemetry aggregated statistics banner */}
        <div className={`border-t ${theme === 'dark' ? 'border-slate-800/40 bg-slate-900/20' : 'border-slate-200/50 bg-slate-100/50'}`}>
          <div className="max-w-4xl mx-auto px-4 py-3 grid grid-cols-3 gap-2 text-center text-xs md:text-sm">
            <div className="border-r border-slate-800/20">
              <span className={`block text-[10px] md:text-xs font-semibold tracking-wider uppercase ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                {translate('statVotes')}
              </span>
              <span className="font-extrabold font-condensed text-lg md:text-xl text-yellow-500 mt-0.5 block">
                {totalVotes.toLocaleString()}
              </span>
            </div>
            <div className="border-r border-slate-800/20">
              <span className={`block text-[10px] md:text-xs font-semibold tracking-wider uppercase ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                {translate('statPi')}
              </span>
              <span className="font-extrabold font-condensed text-lg md:text-xl text-violet-500 mt-0.5 block">
                {piCollected.toFixed(1)} π
              </span>
            </div>
            <div>
              <span className={`block text-[10px] md:text-xs font-semibold tracking-wider uppercase ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                {translate('statPts')}
              </span>
              <span className={`font-mono text-xs md:text-sm font-bold mt-1 block ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                +100 {translate('pts')}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation divisions ribbon list */}
      <nav className={`sticky top-0 z-30 border-b backdrop-blur-md transition-colors shadow-sm overflow-x-auto ${
        theme === 'dark' ? 'bg-slate-950/85 border-slate-800/80' : 'bg-slate-50/90 border-slate-200'
      }`}>
        <div className="max-w-4xl mx-auto px-2 flex whitespace-nowrap scrollbar-none items-center">
          <button
            onClick={() => setActiveTab('p4p')}
            className={`py-3 px-4 font-condensed font-extrabold text-sm uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
              activeTab === 'p4p'
                ? 'text-yellow-500 border-yellow-500'
                : theme === 'dark'
                ? 'text-slate-400 border-transparent hover:text-slate-200'
                : 'text-slate-600 border-transparent hover:text-slate-900'
            }`}
          >
            {translate('tabP4P')}
          </button>
          
          {WEIGHT_CLASSES.map((wc) => (
            <button
              key={wc.id}
              onClick={() => setActiveTab(wc.id)}
              className={`py-3 px-4 font-condensed font-extrabold text-sm uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === wc.id
                  ? 'text-yellow-500 border-yellow-500'
                  : theme === 'dark'
                  ? 'text-slate-400 border-transparent hover:text-slate-200'
                  : 'text-slate-600 border-transparent hover:text-slate-900'
              }`}
            >
              <span>{wc.icon}</span>
              <span>{translate(wc.id).toUpperCase()}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Primary Application List Body content */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6 relative z-10">
        
        {/* Dynamic header label describing currently shown tab */}
        <div className="flex items-center justify-between mb-4 border-b pb-2 border-slate-800/10">
          <h2 className="font-condensed font-extrabold uppercase tracking-wide text-sm text-slate-400 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
            {currentTabName}
          </h2>
          <span className="text-[10px] uppercase font-mono tracking-widest text-slate-500">
            {translate('votesPrefix')} {translate('piExclusive').toUpperCase()}
          </span>
        </div>

        {/* 🏆 P4P Top 15 Render Column Block */}
        {activeTab === 'p4p' && (
          <div className="flex flex-col gap-3">
            {sortedP4P.map((fighter, i) => {
              const fanRank = i + 1;
              const hasPhoto = PHOTOS[fighter.name];
              const scoreKey = `p4p_${fighter.originalIndex}`;
              const relativePct = Math.min(100, Math.max(1, (fighter.fansPoints / maxP4PScore) * 100));

              return (
                <div
                  key={fighter.name}
                  className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${
                    theme === 'dark'
                      ? 'bg-slate-900/40 hover:bg-slate-900/70 border-slate-800/80 hover:border-slate-700/60'
                      : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300/80 shadow-sm'
                  } group`}
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    {/* Position circle */}
                    <div className="w-8 flex-shrink-0 text-center">
                      <span className={`font-condensed font-black text-2xl ${
                        fanRank === 1 ? 'text-yellow-500' : fanRank === 2 ? 'text-slate-400' : fanRank === 3 ? 'text-amber-600' : 'text-slate-500'
                      }`}>
                        #{fanRank}
                      </span>
                    </div>

                    {/* Fighter dynamic information text */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base text-xs sm:text-sm">{fighter.flag}</span>
                        <h3 className={`font-condensed font-bold text-base md:text-lg tracking-wide truncate ${
                          theme === 'dark' ? 'text-white' : 'text-slate-900'
                        }`}>
                          {fighter.name}
                        </h3>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400 mt-0.5">
                        <span className="truncate">{translateDivision(fighter.div)}</span>
                        <span className="text-slate-700/50">•</span>
                        <span className="font-mono text-[10px] bg-slate-500/10 px-1 py-0.2 rounded">{fighter.record}</span>
                        <span className="text-slate-700/50">•</span>
                        <span className="italic">{translate('p4pOfficialRank')} #{fighter.originalIndex + 1}</span>
                      </div>

                      {/* Distribution level statistics gauge indicator */}
                      <div className="w-full max-w-xs mt-2 relative">
                        <div className="flex md:hidden items-center justify-between text-[10px] text-yellow-500 font-mono mb-1">
                          <span>{fighter.fansPoints > 0 ? `${fighter.fansPoints.toLocaleString()} ${translate('pts')}` : '0 pts'}</span>
                        </div>
                        <div className={`h-1.5 w-full rounded-full overflow-hidden relative ${theme === 'dark' ? 'bg-slate-950' : 'bg-slate-100'}`}>
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-600 to-yellow-500 transition-all duration-300"
                            style={{ width: `${relativePct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Rating values alongside the Vote Button tool */}
                  <div className="flex items-center gap-4 ml-3">
                    <div className="hidden md:block text-right">
                      <span className="font-mono font-bold text-sm text-yellow-400 block tracking-tight">
                        {fighter.fansPoints > 0 ? fighter.fansPoints.toLocaleString() : '0'}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 block">
                        {translate('pts')}
                      </span>
                    </div>

                    <button
                      onClick={() => handleOpenVote(fighter.name, fighter.flag, translateDivision(fighter.div) || translate('poundforpound'), scoreKey)}
                      className="px-3 py-1.5 md:px-4 md:py-2 rounded-lg font-condensed font-black tracking-widest text-sm text-white bg-gradient-to-br from-violet-600 to-indigo-800 hover:from-violet-500 hover:to-indigo-700 active:scale-95 cursor-pointer shadow-lg shadow-indigo-950/40 inline-flex items-center gap-1 transition-all"
                    >
                      <span>1</span>
                      <span className="font-mono">π</span>
                    </button>
                  </div>

                </div>
              );
            })}
          </div>
        )}

        {/* ⚡ Weight Class Divisions render blocks */}
        {activeTab !== 'p4p' && (() => {
          const wc = WEIGHT_CLASSES.find((w) => w.id === activeTab);
          if (!wc) return null;

          const limitLabel = wc.limit;
          const champ = wc.champ;
          const champPhoto = PHOTOS[champ.name];
          const champKey = getP4PKey(champ.name);
          const champVotes = scores[champKey] || 0;

          return (
            <div className="flex flex-col gap-6">
              
              {/* Champion Card container display */}
              <div className={`p-5 rounded-2xl border relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-5 transition-all ${
                theme === 'dark'
                  ? 'bg-gradient-to-br from-slate-900/90 via-slate-900/60 to-indigo-950/15 border-yellow-500/25'
                  : 'bg-gradient-to-br from-yellow-50/70 via-white to-indigo-50/20 border-yellow-400/50 shadow-md shadow-yellow-100/35'
              } ring-1 ring-yellow-500/10 animate-pulse-glow`}>
                
                {/* Crown glow embellishment */}
                <div className="absolute top-2 right-2 opacity-5 pointer-events-none text-9xl">👑</div>

                <div className="flex items-center gap-4 min-w-0">
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest bg-yellow-500 text-slate-950 font-condensed">
                      🏆 {translate('champion')}
                    </span>
                    <h3 className={`font-condensed font-black text-2xl md:text-3xl uppercase tracking-wide mt-1 truncate ${
                      theme === 'dark' ? 'text-white' : 'text-slate-900'
                    }`}>
                      <span className="mr-2 text-lg inline-block">{champ.flag}</span>
                      {champ.name}
                    </h3>
                    <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                      <span className="font-mono bg-slate-500/10 px-1.5 py-0.5 rounded text-[10px]">{champ.record}</span>
                      <span>•</span>
                      <span>{translate(wc.id)} {translate('limit')}: <span className="font-mono text-[10px]">{limitLabel}</span></span>
                    </div>
                  </div>
                </div>

                {/* Score and vote action interface inside the Champ card header */}
                <div className="flex items-center gap-4 sm:border-l sm:pl-5 sm:border-slate-700/30 flex-shrink-0 self-end sm:self-center w-full sm:w-auto justify-between sm:justify-start">
                  <div className="text-left sm:text-right">
                    <span className="font-mono font-bold text-base text-yellow-500 block">
                      {champVotes.toLocaleString()}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                      {translate('pts')}
                    </span>
                  </div>

                  <button
                    onClick={() => handleOpenVote(champ.name, champ.flag, `${translate(wc.id)} ${translate('champion')}`, champKey)}
                    className="px-4 py-2 text-sm rounded-lg font-condensed font-bold uppercase tracking-wider text-slate-950 bg-gradient-to-r from-yellow-500 to-yellow-300 hover:from-yellow-400 hover:to-yellow-200 active:scale-95 cursor-pointer shadow-md inline-flex items-center gap-1.5 transition-all"
                  >
                    <span>{translate('vote').toUpperCase()}</span>
                    <span className="font-black text-xs">1π</span>
                  </button>
                </div>

              </div>

              {/* Ranks 1 to 15 Division Fighters interactive row list */}
              <div className="flex flex-col gap-2">
                {wc.fighters.map((fighter) => {
                  const hasPhoto = PHOTOS[fighter.name];
                  const scoreKey = getP4PKey(fighter.name);
                  const fVotes = scores[scoreKey] || 0;

                  return (
                    <div
                      key={fighter.name}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                        theme === 'dark'
                          ? 'bg-slate-900/25 border-slate-900 hover:border-violet-500/10 hover:bg-slate-900/50'
                          : 'bg-white border-slate-200 hover:border-violet-500/20 hover:bg-slate-50 shadow-sm'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        <span className="w-6 text-center font-condensed font-black text-slate-500 text-lg">
                          {fighter.rank}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs sm:text-sm">{fighter.flag}</span>
                            <h4 className={`font-condensed font-bold text-base tracking-wide truncate ${
                              theme === 'dark' ? 'text-slate-100' : 'text-slate-850'
                            }`}>
                              {fighter.name}
                            </h4>
                            {fighter.note && (
                              <span className="bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 text-[9px] px-1 py-0.1 rounded font-bold uppercase font-condensed">
                                {translate(fighter.note.toLowerCase().replace(/\s+/g, ''))}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                            <span className="font-mono bg-slate-500/5 px-1 rounded">{fighter.record}</span>
                            <span>•</span>
                            <span>{translate(wc.id)} {translate('contender')}</span>
                          </div>
                        </div>
                      </div>

                      {/* Vote with 1Pi capability next to EACH contender row */}
                      <div className="flex items-center gap-3 ml-2">
                        <div className="text-right">
                          <span className="font-mono text-xs font-semibold text-slate-400 block tracking-tight">
                            {fVotes > 0 ? fVotes.toLocaleString() : '0'}
                          </span>
                          <span className="text-[8px] uppercase tracking-widest text-slate-550 block">
                            {translate('pts')}
                          </span>
                        </div>

                        <button
                          onClick={() => handleOpenVote(fighter.name, fighter.flag, `${translate(wc.id)} ${translate('ranking')} #${fighter.rank}`, scoreKey)}
                          className="px-2.5 py-1 md:px-3 md:py-1.5 rounded-lg font-condensed font-bold text-xs text-white bg-gradient-to-br from-indigo-700 to-slate-900 border border-indigo-600/30 hover:border-indigo-500/50 hover:from-indigo-600 hover:to-slate-800 active:scale-95 cursor-pointer shadow-sm flex items-center gap-1 transition-all"
                        >
                          <span>{translate('vote').toUpperCase()}</span>
                          <span className="font-mono text-[10px] font-black text-indigo-300">1π</span>
                        </button>
                      </div>

                    </div>
                  );
                })}
              </div>

            </div>
          );
        })()}

      </main>

      {/* Interactive Floating Pi Payment Dialog Overlay Modal */}
      {pendingVote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div
            className={`w-full max-w-sm rounded-2xl border p-6 relative transition-all shadow-2xl ${
              theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-800'
            }`}
          >
            <button
              onClick={handleCloseVote}
              disabled={isProcessing}
              className={`absolute top-4 right-4 p-1.5 rounded-lg border transition-all cursor-pointer ${
                theme === 'dark' ? 'border-amber-500/10 text-slate-400 hover:text-white hover:bg-slate-800/80' : 'border-slate-350 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
              aria-label="Dismiss payment popup"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="mb-5">
              <span className="text-[10px] font-bold tracking-widest uppercase text-violet-400 block mb-1">
                {translate('voteFor')}
              </span>
              <h3 className="text-2xl font-black font-condensed uppercase tracking-normal">
                <span className="mr-1.5">{pendingVote.flag}</span>
                {pendingVote.name}
              </h3>
              <p className="text-xs text-slate-400 mt-1 font-medium italic">{pendingVote.division}</p>
            </div>

            {/* Price values and allocation details of selection */}
            <div className={`p-4 rounded-xl border flex justify-between items-center mb-5 ${
              theme === 'dark' ? 'bg-slate-950/60 border-violet-500/20' : 'bg-white border-violet-500/15'
            }`}>
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block">
                  {translate('voteCost')}
                </span>
                <span className="text-3xl font-extrabold font-condensed text-violet-400 block mt-0.5">
                  1.0 π
                </span>
              </div>
              <div className="text-right border-l pl-4 border-slate-800/20">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block">
                  {translate('toFighter')}
                </span>
                <span className="text-2xl font-black font-condensed text-yellow-500 block mt-1">
                  +100 {translate('pts')}
                </span>
              </div>
            </div>

            {/* Technical wallet information container details */}
            <div className={`p-3.5 rounded-lg text-xs leading-relaxed border mb-6 ${
              theme === 'dark' ? 'bg-slate-950/20 border-slate-800/50 text-slate-400' : 'bg-slate-100 text-slate-600 border-slate-200/50'
            }`}>
              <p>{translate('walletNote')}</p>
              <p className="font-mono text-[10px] break-all select-all font-bold text-violet-400 bg-slate-500/5 p-1 rounded mt-1 text-center">
                {WALLET_ADDRESS}
              </p>
            </div>

            {/* Primary vote dispatch execution trigger button */}
            <button
              onClick={handleConfirmVote}
              disabled={isProcessing}
              className={`w-full py-4 text-center rounded-xl font-bold font-condensed text-lg tracking-wider text-white uppercase bg-gradient-to-r from-violet-600 to-indigo-800 hover:from-violet-500 hover:to-indigo-700 active:scale-[0.98] transition-all cursor-pointer shadow-lg shadow-indigo-950/40 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full border-2 border-slate-100/30 border-t-white animate-spin" />
                  {translate('loading')}
                </span>
              ) : (
                <span>{translate('confirmVote')}</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Dynamic absolute bottom Floating screen alerts toasts zone */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 max-w-sm w-full px-4 text-center pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-3 rounded-xl shadow-xl transition-all duration-300 transform translate-y-0 text-sm font-semibold pointer-events-auto flex items-center justify-center gap-2 ${
              t.type === 'success'
                ? 'bg-emerald-950/90 border border-emerald-500/30 text-emerald-300'
                : 'bg-rose-950/95 border border-rose-500/30 text-rose-300'
            }`}
          >
            {t.type === 'success' && <Check className="w-4 h-4 flex-shrink-0" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Footer disclaimer area */}
      <footer className={`relative z-10 text-center py-8 px-4 border-t mt-auto ${
        theme === 'dark' ? 'bg-slate-950 border-slate-900/40 text-slate-500' : 'bg-slate-100 border-slate-200 text-slate-500'
      }`}>
        <p className="text-xs max-w-xl mx-auto italic font-medium">
          {translate('disclaimer')}
        </p>
        <p className="font-mono text-[10px] uppercase font-bold tracking-widest text-slate-600 mt-4">
          P4P Fan Rankings · Pi Network Sandbox · © 2026
        </p>
      </footer>

    </div>
  );
}
