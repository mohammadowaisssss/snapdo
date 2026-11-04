/* =====================================================================
   FIREBASE AUTH & FIRESTORE INTEGRATION
   Provides real Google Sign-In (signInWithPopup) and Firestore profile sync
   ===================================================================== */
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo:
        auth.currentUser?.providerData?.map(provider => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// Defensive payload truncation to match firebase-blueprint.json & firestore.rules
function sanitizeUserProfile(user) {
  const uid = String(user.uid || '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
  const rawName = user.displayName || (user.email ? user.email.split('@')[0] : 'Snapsec User');
  const name = String(rawName).trim().slice(0, 120) || 'Snapsec User';
  const email = String(user.email || '').trim().slice(0, 254);
  const photoURL = String(user.photoURL || '').trim().slice(0, 1024);
  return { uid, name, email, photoURL };
}

export async function syncUserToFirestore(user) {
  if (!user || !user.uid || !user.email) return null;
  const { uid, name, email, photoURL } = sanitizeUserProfile(user);
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid,
        name,
        email,
        photoURL,
        role: 'Owner',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        name,
        photoURL,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }
  }

  return { uid, name, email, photoURL };
}

export async function signInWithGooglePopup() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  const u = result.user;
  const profile = sanitizeUserProfile(u);
  syncUserToFirestore(u).catch(() => {});
  return profile;
}

export async function signOutFromFirebase() {
  try {
    await signOut(auth);
  } catch {
    /* ignore sign-out errors */
  }
}

export function onFirebaseUserChanged(callback) {
  return onAuthStateChanged(auth, user => {
    if (user && user.email) {
      const profile = sanitizeUserProfile(user);
      syncUserToFirestore(user).catch(() => {});
      callback(profile);
    } else {
      callback(null);
    }
  });
}
