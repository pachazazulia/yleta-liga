import React, { useState, useEffect, useRef } from 'react';
import {
  FaPlus,
  FaMinus,
  FaCrosshairs,
  FaListUl,
  FaSearch,
  FaRedo,
  FaTrash,
  FaEdit,
} from 'react-icons/fa';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  increment,
  deleteField,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';
import customIcon from './assets/trophy.png';
import './App.css';

const DUMMY_NAMES = new Set(['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Nikola Tesla', 'Marie Curie']);
const MAX_VOTES = 100;
const MIN_VOTES = -100;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const LOCKED_SCORE_NAME = 'ბარნოვსკი';
const LOCKED_SCORE = 100;

const hasLockedScore = (person) => person.name?.trim() === LOCKED_SCORE_NAME;

const resizeImage = (file) =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('აირჩიე სურათის ფაილი'));
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      reject(new Error('სურათი 10 მბ-ზე პატარა უნდა იყოს'));
      return;
    }

    const imageUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 512 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(imageUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error('სურათის წაკითხვა ვერ მოხერხდა'));
    };
    image.src = imageUrl;
  });

function PersonPicture({ person, className, onUpload, onPreview }) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const hasPicture = person.avatar?.startsWith('data:image/');

  const handleChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsUploading(true);
    setError('');
    try {
      await onUpload(person.id, file);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setIsUploading(false);
    }
  };

  if (hasPicture) {
    return (
      <button
        type="button"
        className={`picture-uploader picture-preview-button ${className}`}
        title="სურათის ნახვა"
        aria-label={`${person.name}-ის სურათის ნახვა`}
        onClick={(event) => {
          event.stopPropagation();
          onPreview(person.id);
        }}
      >
        <img className="picture-image" src={person.avatar} alt={person.name} />
      </button>
    );
  }

  return (
    <label
      className={`picture-uploader ${className}`}
      title={error || 'სურათის დამატება'}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        className="picture-file-input"
        type="file"
        accept="image/*"
        aria-label={`${person.name}-ისთვის სურათის დამატება`}
        disabled={isUploading}
        onChange={handleChange}
      />
      <span className="picture-placeholder">
        <FaPlus />
        <span>სურათი</span>
      </span>
      {isUploading && <span className="picture-uploading">...</span>}
    </label>
  );
}

const loadSavedPeople = () => {
  try {
    const saved = localStorage.getItem('ranking_people');
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => !DUMMY_NAMES.has(p.name) && (typeof p.id === 'string' || p.id > 100))
      .map((person) => hasLockedScore(person) ? { ...person, votes: LOCKED_SCORE } : person);
  } catch {
    return [];
  }
};

const getRosterKey = (pool) => pool.map((person) => String(person.id)).sort().join('|');

const loadVersusState = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('versus_round_state') || 'null');
    if (
      saved &&
      typeof saved.rosterKey === 'string' &&
      Array.isArray(saved.remainingIds) &&
      Array.isArray(saved.pairIds)
    ) {
      return saved;
    }
  } catch {
    // Start a fresh round if the saved state is unreadable.
  }
  return { rosterKey: '', remainingIds: [], pairIds: [] };
};

const shuffle = (values) => {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
};

const drawVersusPair = (pool, currentState) => {
  const personIds = pool.map((person) => String(person.id));
  const rosterKey = getRosterKey(pool);
  if (personIds.length < 2) {
    return { rosterKey, remainingIds: [], pairIds: [] };
  }

  const sameRoster = currentState.rosterKey === rosterKey;
  let remainingIds = sameRoster
    ? currentState.remainingIds.filter((id) => personIds.includes(id))
    : shuffle(personIds);

  if (remainingIds.length === 1) {
    const lastId = remainingIds[0];
    const opponents = personIds.filter((id) => id !== lastId);
    const opponentId = opponents[Math.floor(Math.random() * opponents.length)];
    return { rosterKey, remainingIds: [], pairIds: [lastId, opponentId] };
  }

  if (remainingIds.length < 2) remainingIds = shuffle(personIds);
  const firstIndex = Math.floor(Math.random() * remainingIds.length);
  const [firstId] = remainingIds.splice(firstIndex, 1);
  const secondIndex = Math.floor(Math.random() * remainingIds.length);
  const [secondId] = remainingIds.splice(secondIndex, 1);
  return { rosterKey, remainingIds, pairIds: [firstId, secondId] };
};

const createInitialVersusState = () => {
  const pool = loadSavedPeople();
  const savedState = loadVersusState();
  const rosterKey = getRosterKey(pool);
  const hasValidPair = savedState.pairIds.length === 2 && savedState.pairIds.every(
    (id) => pool.some((person) => String(person.id) === id)
  );

  if (savedState.rosterKey === rosterKey && (pool.length < 2 || hasValidPair)) return savedState;
  return drawVersusPair(pool, { rosterKey: '', remainingIds: [], pairIds: [] });
};

export default function App() {
  const [people, setPeople] = useState(loadSavedPeople);
  const [activeTab, setActiveTab] = useState('leaderboard'); // 'leaderboard' | 'versus'
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState(null);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [condomBurst, setCondomBurst] = useState(0);
  const [picturePreviewId, setPicturePreviewId] = useState(null);
  const [pictureRemoveError, setPictureRemoveError] = useState('');
  const [isRemovingPicture, setIsRemovingPicture] = useState(false);
  const [versusState, setVersusState] = useState(createInitialVersusState);
  const rosterKeyRef = useRef(getRosterKey(people));

  // Real-time Firebase Sync when configured
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return;

    const unsubscribe = onSnapshot(
      collection(db, 'people'),
      (snapshot) => {
        const cloudPeople = [];
        snapshot.forEach((docSnap) => {
          const person = { id: docSnap.id, ...docSnap.data() };
          if (hasLockedScore(person) && person.votes !== LOCKED_SCORE) {
            updateDoc(doc(db, 'people', docSnap.id), { votes: LOCKED_SCORE }).catch((err) => {
              console.error('Failed to enforce locked score:', err);
            });
          }
          cloudPeople.push(hasLockedScore(person) ? { ...person, votes: LOCKED_SCORE } : person);
        });
        const cloudRosterKey = getRosterKey(cloudPeople);
        if (cloudRosterKey !== rosterKeyRef.current) {
          rosterKeyRef.current = cloudRosterKey;
          setVersusState(drawVersusPair(cloudPeople, { rosterKey: '', remainingIds: [], pairIds: [] }));
        }
        setPeople(cloudPeople);
      },
      (error) => {
        console.error('Firebase real-time sync error:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    localStorage.setItem('versus_round_state', JSON.stringify(versusState));
  }, [versusState]);

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

  // Draw the next pair from the current shuffled round.
  const pickVersusPair = (pool = people) => {
    setVersusState((currentState) => drawVersusPair(pool, currentState));
  };

  const handleVote = async (id, delta) => {
    const person = people.find((candidate) => String(candidate.id) === String(id));
    if (person && hasLockedScore(person)) return;
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

  const handleVersusSelect = async (winnerId) => {
    const person = people.find((candidate) => String(candidate.id) === String(winnerId));
    if (!person) return;

    setPeople((prev) => prev.map((candidate) => (
      String(candidate.id) === String(winnerId)
        ? { ...candidate, versusPoints: (candidate.versusPoints || 0) + 1 }
        : candidate
    )));

    if (isFirebaseConfigured && db) {
      try {
        await updateDoc(doc(db, 'people', String(winnerId)), {
          versusPoints: increment(1),
        });
      } catch (err) {
        console.error('Firebase versus point update failed:', err);
      }
    }

    setCondomBurst((burst) => burst + 1);
    pickVersusPair();
  };

  const handleAddPerson = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const nominee = {
      name: newName.trim(),
      role: newRole.trim() || '',
      votes: newName.trim() === LOCKED_SCORE_NAME ? LOCKED_SCORE : 0,
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
      const updatedPeople = [...people, newPerson];
      setPeople(updatedPeople);
      rosterKeyRef.current = getRosterKey(updatedPeople);
      setVersusState(drawVersusPair(updatedPeople, { rosterKey: '', remainingIds: [], pairIds: [] }));
    }

    setNewName('');
    setNewRole('');
    setIsModalOpen(false);
  };

  const handleEditPerson = (person) => {
    setEditingPersonId(person.id);
    setNewName(person.name);
    setNewRole(person.role || '');
    setIsModalOpen(true);
  };

  const handleUpdatePerson = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const person = people.find((candidate) => String(candidate.id) === String(editingPersonId));
    if (!person) return;

    const updates = {
      name: newName.trim(),
      role: newRole.trim(),
    };
    if (updates.name === LOCKED_SCORE_NAME) updates.votes = LOCKED_SCORE;

    setPeople((prev) => prev.map((candidate) => (
      String(candidate.id) === String(editingPersonId)
        ? { ...candidate, ...updates }
        : candidate
    )));

    if (isFirebaseConfigured && db) {
      try {
        await updateDoc(doc(db, 'people', String(editingPersonId)), updates);
      } catch (err) {
        console.error('Firebase edit nominee error:', err);
        alert('Firebase error: ' + err.message);
      }
    }

    setNewName('');
    setNewRole('');
    setEditingPersonId(null);
    setIsModalOpen(false);
  };

  const closePersonForm = () => {
    setIsModalOpen(false);
    setEditingPersonId(null);
    setNewName('');
    setNewRole('');
  };

  const handlePictureUpload = async (id, file) => {
    const avatar = await resizeImage(file);
    setPeople((prev) => prev.map((person) => (
      String(person.id) === String(id) ? { ...person, avatar } : person
    )));

    if (isFirebaseConfigured && db) {
      await updateDoc(doc(db, 'people', String(id)), { avatar });
    }
  };

  const handlePictureRemove = async () => {
    if (!picturePreviewId) return;
    setIsRemovingPicture(true);
    setPictureRemoveError('');
    try {
      if (isFirebaseConfigured && db) {
        await updateDoc(doc(db, 'people', String(picturePreviewId)), { avatar: deleteField() });
      }
      setPeople((prev) => prev.map((person) => (
        String(person.id) === String(picturePreviewId)
          ? { ...person, avatar: '' }
          : person
      )));
      setPicturePreviewId(null);
    } catch (error) {
      console.error('Picture removal failed:', error);
      setPictureRemoveError('სურათის წაშლა ვერ მოხერხდა');
    } finally {
      setIsRemovingPicture(false);
    }
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
        const updatedPeople = people.filter((person) => String(person.id) !== String(id));
        setPeople(updatedPeople);
        rosterKeyRef.current = getRosterKey(updatedPeople);
        setVersusState(drawVersusPair(updatedPeople, { rosterKey: '', remainingIds: [], pairIds: [] }));
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
        rosterKeyRef.current = '';
        setVersusState(drawVersusPair([], { rosterKey: '', remainingIds: [], pairIds: [] }));
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
  const sortedVersusPeople = [...people].sort(
    (a, b) => (b.versusPoints || 0) - (a.versusPoints || 0)
  );
  const versusPair = versusState.pairIds
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
                <div key={person.id} className={`podium-card rank-${index + 1}${hasLockedScore(person) ? ' person-locked' : ''}`}>
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
                  <PersonPicture
                    className={`avatar-large${hasLockedScore(person) ? ' person-picture-locked' : ''}`}
                    person={person}
                    onUpload={handlePictureUpload}
                    onPreview={setPicturePreviewId}
                  />
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
              <div key={person.id} className={`list-item${hasLockedScore(person) ? ' person-locked' : ''}`}>
                <div className="list-item-left">
                  <span className="rank-num">#{index + 1}</span>
                  <PersonPicture
                    className={`avatar-small${hasLockedScore(person) ? ' person-picture-locked' : ''}`}
                    person={person}
                    onUpload={handlePictureUpload}
                    onPreview={setPicturePreviewId}
                  />
                  <div className="person-info">
                    <h3>{person.name}</h3>
                    <p>{person.role}</p>
                  </div>
                </div>

                <div className="vote-controls">
                  {!hasLockedScore(person) && (
                    <>
                      <button className="btn-vote upvote" onClick={() => handleVote(person.id, 1)} title="Add vote">
                        <FaPlus size={16} />
                      </button>
                      <button className="btn-vote downvote" onClick={() => handleVote(person.id, -1)} title="Remove vote">
                        <FaMinus size={16} />
                      </button>
                    </>
                  )}
                  <span className="score">{hasLockedScore(person) ? LOCKED_SCORE : person.votes || 0}</span>
                  <button
                    className="btn-vote edit"
                    onClick={() => handleEditPerson(person)}
                    title={`${person.name}-ის რედაქტირება`}
                    aria-label={`${person.name}-ის რედაქტირება`}
                  >
                    <FaEdit size={14} />
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
              <div className={`versus-card${hasLockedScore(versusPair[0]) ? ' person-locked' : ''}`} onClick={() => handleVersusSelect(versusPair[0].id)}>
                <PersonPicture
                  className={`avatar-large${hasLockedScore(versusPair[0]) ? ' person-picture-locked' : ''}`}
                  person={versusPair[0]}
                  onUpload={handlePictureUpload}
                  onPreview={setPicturePreviewId}
                />
                <h3>{versusPair[0].name}</h3>
                <p style={{ color: 'var(--text-muted)' }}>{versusPair[0].role}</p>
                <div style={{ marginTop: '1rem', fontWeight: 'bold' }}>
                  {versusPair[0].versusPoints || 0} ყლეობაიტი
                </div>
              </div>

              <div className="vs-badge">VS</div>

              <div className={`versus-card${hasLockedScore(versusPair[1]) ? ' person-locked' : ''}`} onClick={() => handleVersusSelect(versusPair[1].id)}>
                <PersonPicture
                  className={`avatar-large${hasLockedScore(versusPair[1]) ? ' person-picture-locked' : ''}`}
                  person={versusPair[1]}
                  onUpload={handlePictureUpload}
                  onPreview={setPicturePreviewId}
                />
                <h3>{versusPair[1].name}</h3>
                <p style={{ color: 'var(--text-muted)' }}>{versusPair[1].role}</p>
                <div style={{ marginTop: '1rem', fontWeight: 'bold' }}>
                  {versusPair[1].versusPoints || 0} ყლეობაიტი
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
          {people.length > 0 && (
            <section className="versus-leaderboard" aria-label="ყლეობაიტის ლიდერბორდი">
              <h3>ყლეობაიტი</h3>
              <ol>
                {sortedVersusPeople.map((person, index) => (
                  <li key={person.id}>
                    <span className="versus-rank">{index + 1}</span>
                    <span className="versus-person-name">{person.name}</span>
                    <strong>{person.versusPoints || 0}</strong>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}

      {/* Add Nominee Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={closePersonForm}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>{editingPersonId ? 'რედაქტირება' : 'დაამატე'}</h2>
            <form onSubmit={editingPersonId ? handleUpdatePerson : handleAddPerson}>
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
                <button type="button" className="btn" onClick={closePersonForm}>
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
      {picturePreviewId && (() => {
        const person = people.find((candidate) => String(candidate.id) === String(picturePreviewId));
        if (!person?.avatar?.startsWith('data:image/')) return null;
        return (
          <div className="modal-overlay picture-modal-overlay" onClick={() => setPicturePreviewId(null)}>
            <div className="picture-modal-content" onClick={(event) => event.stopPropagation()}>
              <h2>{person.name}</h2>
              <img className="picture-modal-image" src={person.avatar} alt={person.name} />
              {pictureRemoveError && <p className="picture-remove-error" role="alert">{pictureRemoveError}</p>}
              <div className="picture-modal-actions">
                <button className="btn" onClick={() => setPicturePreviewId(null)}>დახურვა</button>
                <button className="btn btn-remove-picture" onClick={handlePictureRemove} disabled={isRemovingPicture}>
                  <FaTrash size={14} /> {isRemovingPicture ? 'იშლება...' : 'სურათის წაშლა'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      <footer className="app-footer">© {new Date().getFullYear()} Pacha Zazulia</footer>
    </div>
  );
}