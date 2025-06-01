// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const axios = require('axios');
admin.initializeApp();
const db = admin.firestore();
const OPENAI_API_KEY = functions.config().openai.key;

exports.onAudioUpload = functions.storage.object().onFinalize(async (object) => {
  if (!object.name.startsWith('uploads/')) return;
  const [_, userId, filename] = object.name.split('/');
  const bucket = admin.storage().bucket(object.bucket);
  const file = bucket.file(object.name);
  const [buffer] = await file.download();
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  // Deduplication
  const docRef = db.collection('transcripts').doc(hash);
  if ((await docRef.get()).exists) return;

  // Transcribe
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('file', buffer, filename);
  const resp = await axios.post('https://api.openai.com/v1/audio/transcriptions',form,{ headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, ...form.getHeaders() } });
  if (resp.status !== 200) throw new Error('Whisper error');

  await docRef.set({
    hash,
    userId,
    text: resp.data.text,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
});
exports.onTranscriptCreate = functions.firestore.document('transcripts/{hash}').onCreate(async (snap, context) => {
  const { hash, userId, text } = snap.data();
  const userRef = db.collection('users').doc(userId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) return;

  const user = userDoc.data();
  const prompt = `Summarize the following text:\n\n${text}`;
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
    },
    { headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` } }
  );

  if (response.status !== 200) throw new Error('ChatGPT error');

  await userRef.update({
    summary: response.data.choices[0].message.content,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
});
exports.onTranscriptDelete = functions.firestore.document('transcripts/{hash}').onDelete(async (snap, context) => {
  const { hash, userId } = snap.data();
  const userRef = db.collection('users').doc(userId);
  await userRef.update({
    summary: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
});
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
  const { uid, email } = user;
  await db.collection('users').doc(uid).set({
    email,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
});
exports.onUserDelete = functions.auth.user().onDelete(async (user) => {
  const { uid } = user;
  await db.collection('users').doc(uid).delete();
});
exports.onUserUpdate = functions.auth.user().onUpdate(async (change) => {
  const { uid, email } = change.after.data();
  await db.collection('users').doc(uid).update({
    email,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
});