import React, { useState, useEffect } from 'react';
import {
  FaPlus,
  FaMinus,
  FaCrosshairs,
  FaListUl,
  FaSearch,
  FaRedo,
  FaTrash,
} from 'react-icons/fa';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  increment,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';
import customIcon from './assets/trophy.png';
import './App.css';

const DUMMY_NAMES = new Set(['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Nikola Tesla', 'Marie Curie']);
const MAX_VOTES = 100;
const MIN_VOTES = -100;

const loadSavedPeople = () => {
  try {
    const saved = localStorage.getItem('ranking_people');
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => !DUMMY_NAMES.has(p.name) && (typeof p.id === 'string' || p.id > 100));
  } catch {
    return [];
  }
};

export default function App() {
  const [people, setPeople] = useState(loadSavedPeople);
  const [activeTab, setActiveTab] = useState('leaderboard'); // 'leaderboard' | 'versus'
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [condomBurst, setCondomBurst] = useState(0);
  const [versusPairIds, setVersusPairIds] = useState(() => {
    const list = loadSavedPeople();
    if (list.length >= 2) return [list[0].id, list[1].id];
    return [];
  });

  // Real-time Firebase Sync when configured
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return;

    const unsubscribe = onSnapshot(
      collection(db, 'people'),
      (snapshot) => {
        const cloudPeople = [];
        snapshot.forEach((docSnap) => {
          cloudPeople.push({ id: docSnap.id, ...docSnap.data() });
        });
        setPeople(cloudPeople);
        setVersusPairIds((prevPair) => {
          const valid = prevPair.filter((id) => cloudPeople.some((p) => String(p.id) === String(id)));
          if (valid.length === 2) return valid;
          if (cloudPeople.length >= 2) return [cloudPeople[0].id, cloudPeople[1].id];
          return [];
        });
      },
      (error) => {
        console.error('Firebase real-time sync error:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  // Save to localStorage as local cache / fallback
  useEffect(() => {
    if (!isFirebaseConfigured) {
      localStorage.setItem('ranking_people', JSON.stringify(people));
    }
  }, [people]);

  useEffect(() => {
    if (!condomBurst) return undefined;
    const timeout = window.setTimeout(() => setCondomBurst(0), 1200);
    return () => window.clearTimeout(timeout);
  }, [condomBurst]);

  // Pick 2 random people for Head-to-Head mode
  const pickVersusPair = (pool = people) => {
    if (pool.length < 2) {
      setVersusPairIds([]);
      return;
    }
    const idx1 = Math.floor(Math.random() * pool.length);
    let idx2 = Math.floor(Math.random() * pool.length);
    while (idx2 === idx1) {
      idx2 = Math.floor(Math.random() * pool.length);
    }
    setVersusPairIds([pool[idx1].id, pool[idx2].id]);
  };

  const handleVote = async (id, delta) => {
    const person = people.find((candidate) => String(candidate.id) === String(id));
    const currentVotes = person?.votes || 0;
    const nextVotes = Math.min(MAX_VOTES, Math.max(MIN_VOTES, currentVotes + delta));
    const appliedDelta = nextVotes - currentVotes;
    if (appliedDelta === 0) return;

    // Optimistic UI update
    setPeople((prev) =>
      prev.map((person) => {
        if (String(person.id) === String(id)) {
          return { ...person, votes: (person.votes || 0) + appliedDelta };
        }
        return person;
      })
    );

    if (isFirebaseConfigured && db) {
      try {
        await updateDoc(doc(db, 'people', String(id)), {
          votes: increment(appliedDelta),
        });
      } catch (err) {
        console.error('Firebase vote update failed:', err);
      }
    }
  };

  const handleVersusSelect = (winnerId) => {
    const person = people.find((candidate) => String(candidate.id) === String(winnerId));
    if ((person?.votes || 0) >= MAX_VOTES) return;
    handleVote(winnerId, 1);
    setCondomBurst((burst) => burst + 1);
    pickVersusPair();
  };

  const handleAddPerson = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const nominee = {
      name: newName.trim(),
      role: newRole.trim() || '',
      votes: 0,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(newName.trim())}`,
      createdAt: Date.now(),
    };

    if (isFirebaseConfigured && db) {
      try {
        await addDoc(collection(db, 'people'), nominee);
      } catch (err) {
        console.error('Firebase add nominee error:', err);
        alert('Firebase error: ' + err.message);
      }
    } else {
      const newPerson = { id: Date.now(), ...nominee };
      setPeople((prev) => [...prev, newPerson]);
    }

    setNewName('');
    setNewRole('');
    setIsModalOpen(false);
  };

  const handleDeletePerson = async (id, name) => {
    if (window.confirm(`დარწმუნებული ხარ რო ${name} ის წაშლა გინდა?`)) {
      if (isFirebaseConfigured && db) {
        try {
          await deleteDoc(doc(db, 'people', String(id)));
        } catch (err) {
          console.error('Firebase delete error:', err);
          alert('Firebase error: ' + err.message);
        }
      } else {
        setPeople((prev) => prev.filter((p) => String(p.id) !== String(id)));
      }
    }
  };

  const handleReset = async () => {
    if (window.confirm('გსურს სიის გასუფთავება?')) {
      if (isFirebaseConfigured && db) {
        try {
          await Promise.all(people.map((p) => deleteDoc(doc(db, 'people', String(p.id)))));
        } catch (err) {
          console.error('Clear error:', err);
        }
      } else {
        setPeople([]);
        setVersusPairIds([]);
        localStorage.removeItem('ranking_people');
      }
    }
  };

  // Sort people by votes (descending)
  const sortedPeople = [...people].sort((a, b) => (b.votes || 0) - (a.votes || 0));
  const filteredPeople = sortedPeople.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.role && p.role.toLowerCase().includes(search.toLowerCase()))
  );

  const top3 = sortedPeople.slice(0, 3);
  const versusPair = versusPairIds
    .map((id) => people.find((p) => String(p.id) === String(id)))
    .filter(Boolean);

  return (
    <div className="app-container">
      {condomBurst > 0 && (
        <div className="condom-burst" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => (
            <span
              key={`${condomBurst}-${index}`}
              className="condom-particle"
              style={{
                '--x': `${(index - 8.5) * 28}px`,
                '--y': `${-180 - (index % 4) * 30}px`,
                '--rotate': `${(index - 8.5) * 16}deg`,
                '--delay': `${(index % 5) * 0.03}s`,
              }}
            />
          ))}
        </div>
      )}
      {/* Header */}
      <header className="header">
        <div>
          <h1>
            <img
              src={customIcon}
              alt="Icon"
              style={{ width: '36px', height: '36px', marginRight: '0.6rem', objectFit: 'contain' }}
            />
            <span className="header-title-text">ყლეთა ლიგა</span>
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.3rem' }}>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: '999px',
                backgroundColor: isFirebaseConfigured ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                color: isFirebaseConfigured ? 'var(--green)' : 'var(--text-muted)',
                border: `1px solid ${isFirebaseConfigured ? 'var(--green)' : 'var(--border-color)'}`,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
              title={
                isFirebaseConfigured
                  ? 'Connected to Firebase Cloud Database (multi-user sync)'
                  : 'Running locally on this device. Add Firebase keys to .env to sync between all users.'
              }
            >
             
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className={`btn ${activeTab === 'leaderboard' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('leaderboard')}
          >
            <FaListUl size={18} /> დაყლეებულები
          </button>
          <button
            className={`btn ${activeTab === 'versus' ? 'btn-primary' : ''}`}
            onClick={() => {
              setActiveTab('versus');
              if (versusPair.length < 2) pickVersusPair();
            }}
          >
            <FaCrosshairs size={18} /> ყლეთა ჯახი
          </button>
        </div>
      </header>

      {/* Main Tab: Leaderboard */}
      {activeTab === 'leaderboard' && (
        <>
          {/* Controls */}
          <div className="toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
              <FaSearch size={18} color="var(--text-muted)" />
              <input
                className="search-input"
                type="text"
                placeholder="მოძებნე ყლეები..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
                <FaPlus size={18} /> დაამატე ყლე
              </button>
              {people.length > 0 && (
                <button className="btn" onClick={handleReset} title="სიის გასუფთავება">
                  <FaRedo size={18} />
                </button>
              )}
            </div>
          </div>

          {/* Top 3 Podium (Only when not searching and at least 3 people) */}
          {!search && top3.length >= 3 && (
            <div className="podium-section">
              {top3.map((person, index) => (
                <div key={person.id} className={`podium-card rank-${index + 1}`}>
                  <button
                    className="btn-podium-delete"
                    onClick={() => handleDeletePerson(person.id, person.name)}
                    title={`Delete ${person.name}`}
                  >
                    <FaTrash size={12} />
                  </button>
                  <span className={`rank-badge badge-${index + 1}`}>
                    {index === 0 ? (
                      <img
                        src={customIcon}
                        alt="1st"
                        style={{ width: '18px', height: '18px', objectFit: 'contain' }}
                      />
                    ) : (
                      `#${index + 1}`
                    )}
                  </span>
                  <img className="avatar-large" src={person.avatar} alt={person.name} />
                  <h3 style={{ margin: '0.4rem 0 0.2rem' }}>{person.name}</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                    {person.role}
                  </p>
                  <div style={{ marginTop: '1rem', fontWeight: 'bold', fontSize: '1.2rem' }}>
                    {person.votes || 0} ყლეციბელი
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Full Ranked List */}
          <div className="leaderboard-list">
            {filteredPeople.map((person, index) => (
              <div key={person.id} className="list-item">
                <div className="list-item-left">
                  <span className="rank-num">#{index + 1}</span>
                  <img className="avatar-small" src={person.avatar} alt={person.name} />
                  <div className="person-info">
                    <h3>{person.name}</h3>
                    <p>{person.role}</p>
                  </div>
                </div>

                <div className="vote-controls">
                  <button className="btn-vote upvote" onClick={() => handleVote(person.id, 1)} title="Add vote">
                    <FaPlus size={16} />
                  </button>
                  <span className="score">{person.votes || 0}</span>
                  <button className="btn-vote downvote" onClick={() => handleVote(person.id, -1)} title="Remove vote">
                    <FaMinus size={16} />
                  </button>
                  <button
                    className="btn-vote delete"
                    onClick={() => handleDeletePerson(person.id, person.name)}
                    title={`Delete ${person.name}`}
                  >
                    <FaTrash size={14} />
                  </button>
                </div>
              </div>
            ))}

            {people.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
                <p style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>სია ჯერ ცარიელია</p>
                <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
                  <FaPlus size={16} /> დაამატე ყლე
                </button>
              </div>
            ) : filteredPeople.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                <p>ვერაფერი მოიძებნა</p>
              </div>
            ) : null}
          </div>
        </>
      )}

      {/* Main Tab: Versus Mode */}
      {activeTab === 'versus' && (
        <div style={{ textAlign: 'center' }}>
          <h2>ყლეთა ჯახი</h2>
          <p style={{ color: 'var(--text-muted)' }}>დააჭირე ყლეს რომელიც უფრო გეყლევება</p>

          {versusPair.length === 2 ? (
            <div className="versus-container">
              <div className="versus-card" onClick={() => handleVersusSelect(versusPair[0].id)}>
                <img className="avatar-large" src={versusPair[0].avatar} alt={versusPair[0].name} />
                <h3>{versusPair[0].name}</h3>
                <p style={{ color: 'var(--text-muted)' }}>{versusPair[0].role}</p>
                <div style={{ marginTop: '1rem', fontWeight: 'bold' }}>
                  {versusPair[0].votes || 0} ყლეციბელი
                </div>
              </div>

              <div className="vs-badge">VS</div>

              <div className="versus-card" onClick={() => handleVersusSelect(versusPair[1].id)}>
                <img className="avatar-large" src={versusPair[1].avatar} alt={versusPair[1].name} />
                <h3>{versusPair[1].name}</h3>
                <p style={{ color: 'var(--text-muted)' }}>{versusPair[1].role}</p>
                <div style={{ marginTop: '1rem', fontWeight: 'bold' }}>
                  {versusPair[1].votes || 0} ყლეციბელი
                </div>
              </div>
            </div>
          ) : (
            <div style={{ margin: '3rem 0', color: 'var(--text-muted)' }}>
              <p style={{ marginBottom: '1rem' }}>ჯახისთვის საჭიროა მინიმუმ 2 პერსონა</p>
              <button
                className="btn btn-primary"
                onClick={() => setIsModalOpen(true)}
              >
                <FaPlus size={16} /> დაამატე ყლე
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add Nominee Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>დაამატე</h2>
            <form onSubmit={handleAddPerson}>
              <div className="form-group">
                <label>სახელი</label>
                <input
                  className="form-input"
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="სახელი"
                />
              </div>
              <div className="form-group">
                <label>აღწერა</label>
                <input
                  className="form-input"
                  type="text"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  placeholder="აღწერა"
                />
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem' }}>
                <button type="button" className="btn" onClick={() => setIsModalOpen(false)}>
                  დაზადვნა
                </button>
                <button type="submit" className="btn btn-primary">
                  ვსიო
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}