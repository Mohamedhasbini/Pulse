// Router (layer 07): instant answers per language, model size choice, answer cache. No AI, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fastPath, pickSize, cache, detectLang, isGreeting } from '../router.js';

const biz = {
  id: 1, name: 'Beauty S1', assistant_name: 'Nora', address: 'Hamra Street, Beirut', maps_url: 'https://maps.example/x',
  hours: { 0: [], 1: [['10:00', '19:00']], 2: [['10:00', '19:00']], 3: [['10:00', '19:00']], 4: [['10:00', '19:00']], 5: [['10:00', '19:00']], 6: [['09:00', '18:00']] },
  faqs: [{ q: 'Is there parking nearby?', a: 'Free parking behind the building.' }],
  services: [{ name: 'Haircut', price: 30, minutes: 45 }],
};
const fp = (text, extra = {}) => fastPath({ biz, audience: 'customer', text, history: [], ...extra });

test('greetings answer in the customer language', () => {
  assert.match(fp('Hi').reply, /I'm Nora, the assistant of Beauty S1/);
  assert.match(fp('hello there!').reply, /Nora/);
  assert.match(fp('مرحبا').reply, /أنا Nora/);
  assert.match(fp('السلام عليكم').reply, /أهلاً/);
  assert.match(fp('¡Hola!').reply, /Soy Nora/);
  assert.match(fp('Buenos días').reply, /Hola/);
  assert.match(fp('Bonjour').reply, /Je suis Nora/);
  assert.match(fp('salut nora').reply, /Bonjour/);
  assert.equal(fp('Hi').options.length, 3);
  assert.match(fp('hi', { history: [{ role: 'assistant', content: 'x' }] }).reply, /again/);
});

test('a greeting with a real question goes to the AI', () => {
  assert.equal(fp('hi, can I book a haircut on Friday?'), null);
  assert.equal(fp('hola quiero una cita mañana'), null);
  assert.equal(isGreeting('hi i want to cancel'), false);
});

test('thanks and bye in four languages', () => {
  assert.match(fp('thanks!').reply, /welcome/);
  assert.match(fp('ok thank you so much').reply, /welcome/);
  assert.match(fp('bye').reply, /Bye/);
  assert.match(fp('شكرا').reply, /العفو/);
  assert.match(fp('muchas gracias').reply, /De nada/);
  assert.match(fp('adiós').reply, /Hasta pronto/);
  assert.match(fp('merci beaucoup').reply, /Avec plaisir/);
  assert.match(fp('au revoir').reply, /Au revoir/);
  assert.equal(fp('👍').reply, '😊');
});

test('hours and location from the setup', () => {
  assert.match(fp('what are your opening hours?').reply, /^Our opening hours: Mon: 10:00-19:00/);
  assert.match(fp('بتفتحو شي؟ شو الدوام').reply, /^أوقات العمل/);
  assert.match(fp('¿Cuál es el horario?').reply, /^Nuestro horario/);
  assert.match(fp('Quels sont vos horaires ?').reply, /^Nos horaires/);
  assert.match(fp('where are you located?').reply, /Hamra Street, Beirut \(https:\/\/maps/);
  assert.match(fp('وين عنوانكن').reply, /عنواننا: Hamra/);
  assert.match(fp('¿Dónde están?').reply, /^Estamos en Hamra/);
  assert.match(fp('Où êtes-vous ?').reply, /^Nous sommes au Hamra/);
  assert.equal(fastPath({ biz: { ...biz, address: null }, text: 'where are you?' }), null);
});

test('FAQ written by the owner, but never for booking questions', () => {
  assert.equal(fp('is there parking nearby').reply, 'Free parking behind the building.');
  assert.equal(fp('are you open tomorrow for an appointment?'), null);
  assert.equal(fp('can I reschedule my booking'), null);
  assert.equal(fp('how much is a haircut'), null); // prices: the AI answers with the catalog
});

test('owners only get small talk instantly', () => {
  assert.match(fastPath({ biz, audience: 'owner', text: 'hi' }).reply, /What would you like/);
  assert.equal(fastPath({ biz, audience: 'owner', text: 'what are our opening hours' }), null);
  assert.match(fastPath({ biz, audience: 'owner', text: 'thanks' }).reply, /welcome/);
});

test('language detection', () => {
  assert.equal(detectLang('مرحبا'), 'ar');
  assert.equal(detectLang('hola, ¿qué tal?'), 'es');
  assert.equal(detectLang('bonjour'), 'fr');
  assert.equal(detectLang('hello'), 'en');
});

test('pickSize', () => {
  assert.equal(pickSize({ text: 'hi', role: 'receptionist', audience: 'customer' }), 'small');
  assert.equal(pickSize({ text: 'how much is a haircut?', role: 'receptionist', audience: 'customer' }), 'small');
  assert.equal(pickSize({ text: 'can I book a facial friday at 5', role: 'receptionist', audience: 'customer' }), 'small');
  assert.equal(pickSize({ text: 'I need to reschedule my appointment', role: 'receptionist', audience: 'customer' }), 'large');
  assert.equal(pickSize({ text: 'quiero cancelar mi cita', role: 'receptionist', audience: 'customer' }), 'large');
  assert.equal(pickSize({ text: 'je veux annuler', role: 'receptionist', audience: 'customer' }), 'large');
  assert.equal(pickSize({ text: 'بدي الغي الموعد', role: 'receptionist', audience: 'customer' }), 'large');
  assert.equal(pickSize({ text: 'the stylist was rude and I am very disappointed', role: 'support', audience: 'customer' }), 'large');
  assert.equal(pickSize({ text: 'how much is colour? and do you do nails?', role: 'receptionist', audience: 'customer' }), 'large');
  assert.equal(pickSize({ text: 'hi', role: 'mxai', audience: 'owner' }), 'large');
});

test('cache is per business, expires, and clears', () => {
  cache.clear();
  cache.set(1, 'What are your HOURS?', 'A');
  assert.equal(cache.get(1, 'what are your hours'), 'A');
  assert.equal(cache.get(2, 'what are your hours'), undefined);
  cache.set(2, 'x', 'B');
  cache.clear(1);
  assert.equal(cache.get(1, 'what are your hours'), undefined);
  assert.equal(cache.get(2, 'x'), 'B');
  const real = Date.now;
  try { Date.now = () => real() + cache._ttl + 1000; assert.equal(cache.get(2, 'x'), undefined); } finally { Date.now = real; }
});
