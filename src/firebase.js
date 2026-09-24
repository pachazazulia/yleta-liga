import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDQ9PveZVD8DJRr69WQM26vlYuO8Qwr7eg",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "yletaliga.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "yletaliga",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "yletaliga.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "455671861165",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:455671861165:web:a0228564e64a3e73971b24",
};

export const isFirebaseConfigured = true;

let db = null;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (err) {
  console.error('Failed to initialize Firebase:', err);
}

export { db };

