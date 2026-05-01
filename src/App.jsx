import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Plus, Trash2, ChevronRight, Search, GripVertical, X, AlertTriangle,
  LogOut, Loader2, Mail, Lock,
} from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db as firestore } from './firebase';

/* =============================================================================
 * BRICK BY BRICK — Production version with Firebase Auth + Firestore
 * ============================================================================= */

let _idCounter = 0;
const generateId = () =>
  `n_${Date.now().toString(36)}_${(_idCounter++).toString(36)}`;

const createNode = (overrides = {}) => ({
  id: generateId(),
  text: '',
  category: '',
  stars: 0,
  collapsed: false,
  children: [],
  ...overrides,
});

/* =============================================================================
 * PURE TREE OPERATIONS
 * ============================================================================= */
const mapNode = (nodes, targetId, transform) =>
  nodes.map(n => {
    if (n.id === targetId) return transform(n);
    return n.children.length
      ? { ...n, children: mapNode(n.children, targetId, transform) }
      : n;
  });

const extractNode = (nodes, targetId) => {
  let extracted = null;
  const walk = arr => {
    const out = [];
    for (const n of arr) {
      if (n.id === targetId) { extracted = n; continue; }
      out.push({ ...n, children: walk(n.children) });
    }
    return out;
  };
  return [walk(nodes), extracted];
};

const insertRelative = (nodes, targetId, position, newNode) => {
  if (position === 'inside') {
    return mapNode(nodes, targetId, n => ({
      ...n,
      collapsed: false,
      children: [...n.children, newNode],
    }));
  }
  const out = [];
  for (const n of nodes) {
    if (n.id === targetId) {
      if (position === 'before') out.push(newNode, n);
      else out.push(n, newNode);
    } else {
      out.push({ ...n, children: insertRelative(n.children, targetId, position, newNode) });
    }
  }
  return out;
};

const findNodeById = (nodes, id) => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const sub = findNodeById(n.children, id);
    if (sub) return sub;
  }
  return null;
};

const isInSubtree = (nodes, ancestorId, targetId) => {
  const ancestor = findNodeById(nodes, ancestorId);
  if (!ancestor) return false;
  if (ancestor.id === targetId) return true;
  return findNodeById(ancestor.children, targetId) !== null;
};

const countDescendants = node => {
  let c = 0;
  for (const child of node.children) c += 1 + countDescendants(child);
  return c;
};

const computeVisibility = (nodes, query) => {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const visible = new Set();
  const walk = (arr, ancestorMatched) => {
    let descendantMatched = false;
    for (const n of arr) {
      const selfMatched = !!n.category && n.category.toLowerCase().includes(q);
      const childHasMatch = walk(n.children, ancestorMatched || selfMatched);
      if (selfMatched || ancestorMatched || childHasMatch) visible.add(n.id);
      if (selfMatched || childHasMatch) descendantMatched = true;
    }
    return descendantMatched;
  };
  walk(nodes, false);
  return visible;
};

const seedTree = () => [
  createNode({
    text: 'Welcome to Brick by Brick.',
    category: 'GETTING STARTED',
    stars: 2,
    children: [
      createNode({ text: 'Drag the grip handle to rearrange bricks.', stars: 0 }),
      createNode({ text: 'Drop any brick on the trash icon (bottom-left) to delete it.', stars: 0 }),
      createNode({ text: 'Click ☆ to fill it crimson — wraps after 5 per row.', stars: 5 }),
      createNode({ text: 'Add a CATEGORY to filter by tag.', category: 'TAG ME', stars: 0 }),
    ],
  }),
];

/* =============================================================================
 * useIsMobile
 * ============================================================================= */
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(`(max-width: ${breakpoint}px)`).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = e => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

/* =============================================================================
 * GLOBAL STYLES
 * ============================================================================= */
const GLOBAL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=JetBrains+Mono:wght@300;400;500;600&display=swap');

  body { background: #0a0a0a; }
  .font-serif-display { font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; letter-spacing: -0.01em; }
  .font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

  .dot-grid {
    background-color: #0a0a0a;
    background-image: radial-gradient(circle, rgba(220,220,220,0.07) 1px, transparent 1px);
    background-size: 22px 22px;
  }
  .crimson    { color: #DC143C; }
  .crimson-bg { background-color: #DC143C; }

  .editable[contenteditable="true"]:empty:before {
    content: attr(data-placeholder);
    color: #3f3f3f;
    pointer-events: none;
  }
  .editable:focus { outline: none; }
  ::selection { background: rgba(220,20,60,0.45); color: #fff; }

  .drop-before { box-shadow: inset 0 2px 0 0 #DC143C; }
  .drop-after  { box-shadow: inset 0 -2px 0 0 #DC143C; }
  .drop-inside { background: rgba(220,20,60,0.10); }

  @media (hover: hover) and (pointer: fine) {
    .actions, .actions-inline { opacity: 0; transition: opacity 120ms ease; }
    .row:hover > .actions,
    .row:focus-within > .actions,
    .row:hover .actions-inline,
    .row:focus-within .actions-inline { opacity: 1; }
  }
  @media (hover: none) {
    .actions, .actions-inline { opacity: 1; }
  }

  .dragging-active { touch-action: none; }
  .drag-grip { touch-action: none; }
  .touch-target { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes scaleIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  @media (max-width: 640px) {
    .dot-grid { background-size: 18px 18px; }
  }
`;

function Logo({ size = 'md' }) {
  const sizeClass = {
    sm: 'text-xl',
    md: 'text-2xl sm:text-3xl',
    lg: 'text-4xl sm:text-6xl',
  }[size];
  return (
    <span className={`font-serif-display font-semibold leading-none ${sizeClass}`}>
      <span style={{ color: '#FFFFFF' }}>Brick by Brick</span>
      <span style={{ color: '#DC143C' }}>.</span>
    </span>
  );
}

/* =============================================================================
 * APP — auth gate
 * ============================================================================= */
export default function App() {
  const [user, setUser] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setBootstrapping(false);
    });
    return unsubscribe;
  }, []);

  return (
    <div className="min-h-screen w-full bg-[#0a0a0a] text-stone-200">
      <style>{GLOBAL_STYLES}</style>

      {bootstrapping ? (
        <div className="dot-grid min-h-screen flex items-center justify-center">
          <Loader2 className="w-5 h-5 crimson animate-spin" />
        </div>
      ) : user ? (
        <NotesApp user={user} onSignOut={() => firebaseSignOut(auth)} />
      ) : (
        <AuthScreen />
      )}
    </div>
  );
}

/* =============================================================================
 * AUTH SCREEN
 * ============================================================================= */
function AuthScreen() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        // Seed initial tree for new users
        await setDoc(doc(firestore, 'notes', userCredential.user.uid), {
          tree: seedTree(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      const msg = err.code === 'auth/email-already-in-use'
        ? 'An account with that email already exists.'
        : err.code === 'auth/weak-password'
        ? 'Password must be at least 6 characters.'
        : err.code === 'auth/user-not-found'
        ? 'No account found for that email.'
        : err.code === 'auth/wrong-password'
        ? 'Wrong password.'
        : err.code === 'auth/invalid-email'
        ? 'Please enter a valid email.'
        : err.message || 'Something went wrong.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dot-grid min-h-screen flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm" style={{ animation: 'slideUp 280ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
        <div className="flex justify-center mb-12">
          <Logo size="lg" />
        </div>

        <div className="flex justify-center gap-6 mb-8 font-mono text-[10px] uppercase tracking-[0.25em]">
          <button
            onClick={() => { setMode('signin'); setError(''); }}
            className={`pb-1 border-b transition-colors ${mode === 'signin'
              ? 'crimson border-[#DC143C]'
              : 'text-stone-500 border-transparent hover:text-stone-300'}`}
          >Sign in</button>
          <button
            onClick={() => { setMode('signup'); setError(''); }}
            className={`pb-1 border-b transition-colors ${mode === 'signup'
              ? 'crimson border-[#DC143C]'
              : 'text-stone-500 border-transparent hover:text-stone-300'}`}
          >Create account</button>
        </div>

        <form onSubmit={submit} className="space-y-3 font-mono">
          <FieldWithIcon icon={Mail}>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email address"
              className="w-full bg-transparent pl-9 pr-3 py-3 text-sm text-stone-100 placeholder:text-stone-600 focus:outline-none"
            />
          </FieldWithIcon>
          <FieldWithIcon icon={Lock}>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="password"
              className="w-full bg-transparent pl-9 pr-3 py-3 text-sm text-stone-100 placeholder:text-stone-600 focus:outline-none"
            />
          </FieldWithIcon>

          {error && (
            <div className="text-[11px] crimson font-mono pt-1 pl-1" style={{ animation: 'fadeIn 200ms ease' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 bg-[#DC143C] hover:bg-[#b81038] disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 text-[11px] uppercase tracking-[0.25em] rounded transition-colors flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            {mode === 'signin' ? 'enter' : 'create account'}
          </button>
        </form>
      </div>
    </div>
  );
}

function FieldWithIcon({ icon: Icon, children }) {
  return (
    <div className="relative border border-white/10 hover:border-white/20 focus-within:border-[#DC143C] rounded-md bg-white/[0.02] transition-colors">
      <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-600 pointer-events-none" />
      {children}
    </div>
  );
}

/* =============================================================================
 * NOTES APP
 * ============================================================================= */
function NotesApp({ user, onSignOut }) {
  const isMobile = useIsMobile();
  const [tree, setTree] = useState([]);
  const [treeLoaded, setTreeLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpenMobile, setSearchOpenMobile] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [autoFocusId, setAutoFocusId] = useState(null);

  // Real-time Firestore subscription
  const isLocalUpdate = useRef(false);
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(firestore, 'notes', user.uid),
      (snap) => {
        // Only update from remote if we're not in the middle of a local edit
        if (!isLocalUpdate.current) {
          if (snap.exists()) {
            setTree(snap.data().tree || seedTree());
          } else {
            setTree(seedTree());
          }
          setTreeLoaded(true);
        }
      },
      (error) => {
        console.error('Firestore error:', error);
        setTree(seedTree());
        setTreeLoaded(true);
      }
    );
    return unsubscribe;
  }, [user.uid]);

  // Debounced save
  const saveTimeoutRef = useRef(null);
  useEffect(() => {
    if (!treeLoaded) return;
    
    // Mark that we're making a local update
    isLocalUpdate.current = true;
    
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setDoc(doc(firestore, 'notes', user.uid), {
        tree,
        updatedAt: serverTimestamp(),
      }).then(() => {
        // Allow remote updates again after save completes
        setTimeout(() => {
          isLocalUpdate.current = false;
        }, 100);
      }).catch(err => {
        console.error('Save failed:', err);
        isLocalUpdate.current = false;
      });
    }, 400);
    return () => { 
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); 
    };
  }, [tree, treeLoaded, user.uid]);

  const visible = useMemo(() => computeVisibility(tree, search), [tree, search]);

  const updateText = (id, text) =>
    setTree(t => mapNode(t, id, n => ({ ...n, text })));
  const updateCategory = (id, category) =>
    setTree(t => mapNode(t, id, n => ({ ...n, category: category.trim().toUpperCase() })));
  const toggleCollapse = id =>
    setTree(t => mapNode(t, id, n => ({ ...n, collapsed: !n.collapsed })));
  const incrementStars = id =>
    setTree(t => mapNode(t, id, n => ({ ...n, stars: n.stars + 1 })));
  const decrementStars = id =>
    setTree(t => mapNode(t, id, n => ({ ...n, stars: Math.max(0, n.stars - 1) })));

  const addChild = id => {
    const newNode = createNode();
    setTree(t => mapNode(t, id, n => ({ ...n, collapsed: false, children: [...n.children, newNode] })));
    setAutoFocusId(newNode.id);
  };
  const addSibling = afterId => {
    const newNode = createNode();
    setTree(t => insertRelative(t, afterId, 'after', newNode));
    setAutoFocusId(newNode.id);
  };
  const addRootBullet = () => {
    const newNode = createNode();
    setTree(t => [...t, newNode]);
    setAutoFocusId(newNode.id);
  };

  const requestDelete = id => {
    const node = findNodeById(tree, id);
    if (node) setPendingDelete(node);
  };
  const confirmDelete = id => {
    setTree(t => {
      const [next] = extractNode(t, id);
      const result = next.length === 0 ? [createNode()] : next;
      // Force an immediate save after deletion
      setDoc(doc(firestore, 'notes', user.uid), {
        tree: result,
        updatedAt: serverTimestamp(),
      }).catch(err => console.error('Delete save failed:', err));
      return result;
    });
    setPendingDelete(null);
  };

  const [draggingId, setDraggingId] = useState(null);
  const [dropTarget, setDropTarget] = useState({ id: null, position: null });
  const [overTrash, setOverTrash] = useState(false);

  const draggingIdRef = useRef(null);
  const dropTargetRef = useRef({ id: null, position: null });
  const overTrashRef  = useRef(false);

  const setDraggingIdSafe = v => { draggingIdRef.current = v; setDraggingId(v); };
  const setDropTargetSafe = v => { dropTargetRef.current = v; setDropTarget(v); };
  const setOverTrashSafe  = v => { overTrashRef.current = v; setOverTrash(v); };

  const performDrop = useCallback((sourceId, targetId, position) => {
    if (sourceId === targetId) return;
    setTree(currentTree => {
      if (isInSubtree(currentTree, sourceId, targetId)) return currentTree;
      const [withoutSource, extracted] = extractNode(currentTree, sourceId);
      if (!extracted) return currentTree;
      return insertRelative(withoutSource, targetId, position, extracted);
    });
  }, []);

  const endDrag = useCallback(() => {
    const sourceId = draggingIdRef.current;
    const target   = dropTargetRef.current;
    const onTrash  = overTrashRef.current;
    if (sourceId) {
      if (onTrash) {
        requestDelete(sourceId);
      } else if (target.id && target.position) {
        performDrop(sourceId, target.id, target.position);
      }
    }
    setDraggingIdSafe(null);
    setDropTargetSafe({ id: null, position: null });
    setOverTrashSafe(false);
    document.body.classList.remove('dragging-active');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performDrop]);

  const beginTouchDrag = useCallback((id) => {
    setDraggingIdSafe(id);
    document.body.classList.add('dragging-active');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draggingId) return;
    const onTouchMove = e => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (!el) return;
      if (el.closest('[data-trash-zone]')) {
        setOverTrashSafe(true);
        setDropTargetSafe({ id: null, position: null });
        return;
      }
      setOverTrashSafe(false);
      const rowEl = el.closest('[data-node-id]');
      if (!rowEl) {
        setDropTargetSafe({ id: null, position: null });
        return;
      }
      const targetId = rowEl.getAttribute('data-node-id');
      if (targetId === draggingIdRef.current) {
        setDropTargetSafe({ id: null, position: null });
        return;
      }
      const rect = rowEl.getBoundingClientRect();
      const y = t.clientY - rect.top;
      const h = rect.height;
      const position = y < h * 0.30 ? 'before' : y > h * 0.70 ? 'after' : 'inside';
      setDropTargetSafe({ id: targetId, position });
    };
    const onTouchEnd = () => endDrag();
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [draggingId, endDrag]);

  const allHidden = visible && tree.every(n => !visible.has(n.id));

  if (!treeLoaded) {
    return (
      <div className="dot-grid min-h-screen flex items-center justify-center">
        <Loader2 className="w-5 h-5 crimson animate-spin" />
      </div>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-30 backdrop-blur-md bg-black/70 border-b border-white/[0.06]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <Logo size={isMobile ? 'sm' : 'md'} />
          <div className="flex items-center gap-1 sm:gap-2">
            {isMobile ? (
              searchOpenMobile ? (
                <div className="relative w-44" style={{ animation: 'fadeIn 160ms ease' }}>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-600 pointer-events-none" />
                  <input
                    type="text"
                    autoFocus
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onBlur={() => { if (!search) setSearchOpenMobile(false); }}
                    placeholder="filter…"
                    className="font-mono w-full bg-transparent border border-white/10 focus:border-[#DC143C]/70 rounded-md pl-9 pr-7 py-2 text-[11px] uppercase tracking-[0.18em] text-stone-200 placeholder:text-stone-600 placeholder:normal-case placeholder:tracking-normal focus:outline-none transition-colors"
                  />
                  {search && (
                    <button
                      onClick={() => { setSearch(''); setSearchOpenMobile(false); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-500 touch-target"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setSearchOpenMobile(true)}
                  className="touch-target text-stone-400 hover:text-[#DC143C]"
                  aria-label="Search"
                >
                  <Search className="w-4 h-4" />
                </button>
              )
            ) : (
              <div className="relative w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-600 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="filter by category…"
                  className="font-mono w-full bg-transparent border border-white/10 hover:border-white/20 focus:border-[#DC143C]/70 rounded-md pl-9 pr-8 py-2 text-[11px] uppercase tracking-[0.18em] text-stone-200 placeholder:text-stone-600 placeholder:normal-case placeholder:tracking-normal focus:outline-none transition-colors"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-500 hover:text-[#DC143C] transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            <button
              onClick={onSignOut}
              className="touch-target text-stone-500 hover:text-[#DC143C] transition-colors"
              title={`Sign out (${user.email})`}
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="dot-grid min-h-[calc(100vh-65px)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 font-mono pb-32">
          <div className="space-y-0.5">
            {tree.map(node => (
              <BulletNode
                key={node.id}
                node={node}
                isMobile={isMobile}
                visible={visible}
                draggingId={draggingId}
                dropTarget={dropTarget}
                autoFocusId={autoFocusId}
                clearAutoFocus={() => setAutoFocusId(null)}
                onUpdateText={updateText}
                onUpdateCategory={updateCategory}
                onToggleCollapse={toggleCollapse}
                onAddChild={addChild}
                onAddSibling={addSibling}
                onIncrementStars={incrementStars}
                onDecrementStars={decrementStars}
                onBeginTouchDrag={beginTouchDrag}
                onSetDraggingId={setDraggingIdSafe}
                onSetDropTarget={setDropTargetSafe}
                onEndDrag={endDrag}
                onSetOverTrash={setOverTrashSafe}
              />
            ))}
          </div>

          {allHidden && (
            <div className="mt-12 sm:mt-16 flex flex-col items-center text-center text-stone-500">
              <div className="font-serif-display text-xl mb-2">Nothing matched.</div>
              <div className="text-[10px] uppercase tracking-[0.25em]">
                try another category or clear the filter
              </div>
            </div>
          )}

          <button
            onClick={addRootBullet}
            className="mt-8 sm:mt-10 ml-4 sm:ml-7 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-stone-600 hover:text-[#DC143C] transition-colors touch-target"
          >
            <Plus className="w-3 h-3" /> add root brick
          </button>

          {!isMobile && (
            <div className="mt-12 ml-7 text-[9px] uppercase tracking-[0.3em] text-stone-700 select-none">
              <span className="crimson">↵</span> sibling &nbsp; · &nbsp;
              <span className="crimson">⇥</span> child &nbsp; · &nbsp;
              <span className="crimson">⇧↵</span> newline &nbsp; · &nbsp;
              drag a brick onto the trash to delete
            </div>
          )}
        </div>
      </main>

      <TrashZone active={!!draggingId} hovering={overTrash} />

      {pendingDelete && (
        <DeleteModal
          node={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => confirmDelete(pendingDelete.id)}
        />
      )}
    </>
  );
}

/* BulletNode, TrashZone, DeleteModal — same as before, copying below */

function BulletNode({
  node, isMobile, visible,
  draggingId, dropTarget, autoFocusId, clearAutoFocus,
  onUpdateText, onUpdateCategory, onToggleCollapse,
  onAddChild, onAddSibling, onIncrementStars, onDecrementStars,
  onBeginTouchDrag, onSetDraggingId, onSetDropTarget, onEndDrag, onSetOverTrash,
}) {
  const [editingCategory, setEditingCategory] = useState(false);
  const textRef = useRef(null);
  const categoryRef = useRef(null);

  const isVisible = visible === null || visible.has(node.id);

  useEffect(() => {
    if (!textRef.current || !isVisible) return;
    // Only update if the element is not currently focused (prevents clearing while typing)
    if (document.activeElement !== textRef.current && textRef.current.innerText !== (node.text || '')) {
      textRef.current.innerText = node.text || '';
    }
    if (autoFocusId === node.id) {
      textRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(textRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      clearAutoFocus();
    }
  }, [node.id, autoFocusId, isVisible, clearAutoFocus, node.text]);

  useEffect(() => {
    if (editingCategory && categoryRef.current) {
      categoryRef.current.focus();
      categoryRef.current.select();
    }
  }, [editingCategory]);

  if (!isVisible) return null;

  const hasChildren = node.children.length > 0;
  const isDragging = draggingId === node.id;
  const isDropTarget = dropTarget.id === node.id;
  const dropClass = !isDropTarget ? '' :
    dropTarget.position === 'before' ? 'drop-before' :
    dropTarget.position === 'after'  ? 'drop-after'  :
    dropTarget.position === 'inside' ? 'drop-inside' : '';

  const handleKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onUpdateText(node.id, textRef.current.innerText);
      onAddSibling(node.id);
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      onUpdateText(node.id, textRef.current.innerText);
      onAddChild(node.id);
    }
  };
  const handleBlur = () => onUpdateText(node.id, textRef.current.innerText);

  const handleDragStart = e => {
    e.stopPropagation();
    onSetDraggingId(node.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.id);
  };
  const handleDragEnd = () => onEndDrag();

  const handleDragOver = e => {
    if (!draggingId || draggingId === node.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    const position = y < h * 0.30 ? 'before' : y > h * 0.70 ? 'after' : 'inside';
    onSetDropTarget({ id: node.id, position });
    onSetOverTrash(false);
  };
  const handleDragLeave = e => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      onSetDropTarget({ id: null, position: null });
    }
  };
  const handleDropEvent = e => {
    e.preventDefault();
    e.stopPropagation();
    onEndDrag();
  };

  const renderStars = () => {
    const items = [];
    for (let i = 0; i < node.stars; i++) {
      items.push(
        <button
          key={`f-${i}`}
          onClick={() => onDecrementStars(node.id)}
          className="w-5 h-5 sm:w-3 sm:h-3 flex items-center justify-center text-base sm:text-[10px] leading-none crimson hover:opacity-50 active:opacity-50 transition-opacity"
          title="Click to remove"
        >★</button>
      );
    }
    items.push(
      <button
        key="grey"
        onClick={() => onIncrementStars(node.id)}
        className="w-5 h-5 sm:w-3 sm:h-3 flex items-center justify-center text-base sm:text-[10px] leading-none text-stone-700 hover:text-stone-500 active:text-stone-400 transition-colors"
        title="Click to fill"
      >☆</button>
    );
    return (
      <div className="flex flex-wrap gap-1 sm:gap-0.5" style={{ width: isMobile ? '116px' : '68px' }}>
        {items}
      </div>
    );
  };

  const childIndent = isMobile ? 'ml-3 pl-2' : 'ml-[18px] pl-2.5';

  return (
    <div className={isDragging ? 'opacity-40' : ''}>
      <div
        data-node-id={node.id}
        className={`row group flex items-start gap-1 sm:gap-1.5 py-1.5 sm:py-1 pr-1 sm:pr-2 rounded transition-colors ${dropClass}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDropEvent}
      >
        <button
          draggable={!isMobile}
          onDragStart={!isMobile ? handleDragStart : undefined}
          onDragEnd={!isMobile ? handleDragEnd : undefined}
          onTouchStart={isMobile ? () => onBeginTouchDrag(node.id) : undefined}
          className={`drag-grip ${isMobile
            ? 'touch-target text-stone-500 active:text-[#DC143C]'
            : 'actions mt-1.5 cursor-grab active:cursor-grabbing text-stone-700 hover:text-[#DC143C]'
          }`}
          title="Drag to reorder"
          aria-label="Drag handle"
        >
          <GripVertical className={isMobile ? 'w-4 h-4' : 'w-3 h-3'} />
        </button>

        <button
          onClick={() => hasChildren && onToggleCollapse(node.id)}
          className={`mt-1.5 w-3 h-3 flex items-center justify-center flex-shrink-0 ${
            hasChildren ? 'text-stone-500 hover:text-[#DC143C] cursor-pointer' : 'cursor-default'
          }`}
          aria-label={hasChildren ? (node.collapsed ? 'Expand' : 'Collapse') : ''}
        >
          {hasChildren && (
            <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${node.collapsed ? '' : 'rotate-90'}`} />
          )}
        </button>

        <div className={`mt-2 w-1 h-1 rounded-full flex-shrink-0 transition-colors ${
          node.stars > 0 ? 'bg-[#DC143C]' : 'bg-stone-500'
        }`} />

        <div className="flex-1 min-w-0">
          {editingCategory ? (
            <input
              ref={categoryRef}
              type="text"
              defaultValue={node.category}
              onBlur={e => { onUpdateCategory(node.id, e.target.value); setEditingCategory(false); }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.target.blur();
                if (e.key === 'Escape') setEditingCategory(false);
              }}
              maxLength={24}
              placeholder="CATEGORY"
              className="block bg-transparent border-b border-[#DC143C]/40 focus:border-[#DC143C] outline-none text-[10px] uppercase tracking-[0.22em] crimson py-0.5 mb-0.5 w-32"
            />
          ) : node.category ? (
            <button
              onClick={() => setEditingCategory(true)}
              className="block text-[10px] uppercase tracking-[0.22em] crimson hover:opacity-70 transition-opacity mb-0.5"
            >
              {node.category}
            </button>
          ) : (
            <button
              onClick={() => setEditingCategory(true)}
              className="actions-inline block text-[10px] uppercase tracking-[0.22em] text-stone-700 hover:text-[#DC143C] transition-colors mb-0.5"
            >
              + tag
            </button>
          )}

          <div className="flex items-start gap-2">
            <div
              ref={textRef}
              contentEditable
              suppressContentEditableWarning
              data-placeholder="empty brick…"
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              className="editable flex-1 min-w-0 text-[13px] sm:text-sm leading-relaxed py-0.5"
              style={{ wordBreak: 'break-word' }}
            />

            <div className="actions-inline flex items-center mt-0 sm:mt-1 flex-shrink-0">
              <button
                onClick={() => onAddChild(node.id)}
                className={isMobile
                  ? 'touch-target text-stone-400 active:text-[#DC143C] transition-colors'
                  : 'text-stone-500 hover:text-[#DC143C] transition-colors'
                }
                title="Add child (Tab)"
                aria-label="Add child"
              >
                <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              </button>
            </div>

            <div className="flex-shrink-0 mt-0.5 sm:mt-1">
              {renderStars()}
            </div>
          </div>
        </div>
      </div>

      {hasChildren && !node.collapsed && (
        <div className={`${childIndent} border-l border-white/[0.05]`}>
          {node.children.map(child => (
            <BulletNode
              key={child.id}
              node={child}
              isMobile={isMobile}
              visible={visible}
              draggingId={draggingId}
              dropTarget={dropTarget}
              autoFocusId={autoFocusId}
              clearAutoFocus={clearAutoFocus}
              onUpdateText={onUpdateText}
              onUpdateCategory={onUpdateCategory}
              onToggleCollapse={onToggleCollapse}
              onAddChild={onAddChild}
              onAddSibling={onAddSibling}
              onIncrementStars={onIncrementStars}
              onDecrementStars={onDecrementStars}
              onBeginTouchDrag={onBeginTouchDrag}
              onSetDraggingId={onSetDraggingId}
              onSetDropTarget={onSetDropTarget}
              onEndDrag={onEndDrag}
              onSetOverTrash={onSetOverTrash}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TrashZone({ active, hovering }) {
  const handleDragOver = e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  return (
    <div
      data-trash-zone
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      className={`fixed bottom-4 sm:bottom-6 left-4 sm:left-6 z-40 transition-all duration-200 select-none ${
        active ? 'opacity-100 scale-100' : 'opacity-40 scale-90'
      }`}
      style={{ pointerEvents: active ? 'auto' : 'none' }}
    >
      <div className={`flex items-center gap-2.5 px-3.5 py-3 rounded-xl border backdrop-blur-md transition-all duration-150 ${
        hovering
          ? 'bg-[#DC143C] border-[#DC143C] shadow-[0_0_24px_rgba(220,20,60,0.6)]'
          : active
            ? 'bg-black/70 border-[#DC143C]/40'
            : 'bg-black/50 border-white/10'
      }`}>
        <Trash2 className={`w-4 h-4 transition-colors ${hovering ? 'text-white' : 'text-stone-300'}`} />
        {active && (
          <span className={`font-mono text-[9px] uppercase tracking-[0.25em] hidden sm:inline ${
            hovering ? 'text-white' : 'text-stone-400'
          }`}>
            {hovering ? 'release to delete' : 'drag here'}
          </span>
        )}
      </div>
    </div>
  );
}

function DeleteModal({ node, onCancel, onConfirm }) {
  const childCount = countDescendants(node);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      style={{ animation: 'fadeIn 120ms ease' }}
      onClick={onCancel}
    >
      <div
        className="relative bg-[#111] border border-white/10 rounded-lg max-w-md w-full p-6 sm:p-7 shadow-2xl font-mono"
        style={{ animation: 'scaleIn 160ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 mb-6">
          <div className="mt-1 p-2 rounded-full bg-[#DC143C]/10 border border-[#DC143C]/30">
            <AlertTriangle className="w-4 h-4 crimson" />
          </div>
          <div className="flex-1">
            <h2 className="font-serif-display text-xl mb-2 text-stone-100">Are you sure?</h2>
            <p className="text-xs text-stone-400 leading-relaxed">
              {childCount > 0 ? (
                <>
                  Deleting this will also delete all of its child bullet points
                  (<span className="crimson font-semibold">{childCount}</span> nested {childCount === 1 ? 'item' : 'items'}).
                  This cannot be undone.
                </>
              ) : (
                <>This brick will be permanently deleted. This cannot be undone.</>
              )}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-stone-400 hover:text-white transition-colors touch-target"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className="px-4 py-2 bg-[#DC143C] hover:bg-[#b81038] text-white text-[10px] uppercase tracking-[0.2em] rounded transition-colors touch-target"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
