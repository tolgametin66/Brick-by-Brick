import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// PASTE YOUR FIREBASE CONFIG HERE (from Firebase Console)
const firebaseConfig = {
  apiKey: "AIzaSyAtNLsokzaWbHFaMmvAIgKXOR7dqxlVUsk",
  authDomain: "brick-by-brick-4bacd.firebaseapp.com",
  projectId: "brick-by-brick-4bacd",
  storageBucket: "brick-by-brick-4bacd.firebasestorage.app",
  messagingSenderId: "750680102076",
  appId: "1:750680102076:web:87c600027d0edc9809ecb9"

};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);